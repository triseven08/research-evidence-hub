"""Published agent/judge functions with additional audit telemetry only."""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from common import now, parse_verdict, read_json, write_json


def copilot_environment(env):
    # MCP stdio inherits only a small default environment. Explicitly pass the
    # router settings, never the generation provider's credentials.
    names = ("PATH", "HOME", "PYTHONPATH", "npm_config_yes", "UV_CACHE_DIR",
             "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
             "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
             "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL",
             "EMBEDDING_DIMENSIONS", "TOP_SERVERS", "TOP_TOOLS", "MCP_DATA_PATH", "ABSTRACT_MODEL")
    return {key: env[key] for key in names if key in env}


async def connect_copilot(client):
    if "mcp-copilot" not in client.sessions:
        await client.config_connect(config={"mcpServers": {"mcp-copilot": {
            "command": sys.executable, "args": ["-m", "baseline.mcp_copilot"],
            "env": copilot_environment(os.environ)}}})
    if "mcp-copilot" not in client.sessions:
        raise RuntimeError("MCP Copilot failed to initialize")


def validate_judgment(result, raw_text):
    verdict = parse_verdict(raw_text)
    if parse_verdict("Status: " + str(result["judge"])) != verdict or result["reward"] != int(verdict == "success"):
        raise ValueError("Inconsistent original judge verdict")
    return verdict


async def generate(args):
    import baseline.run_conversation as upstream
    original_model = upstream.ChatModel
    class MeasuredModel(original_model):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.usage, self.returned_models = [], []
            self.failed_request = False
            original_chat = self.chat
            def measured(**kwargs):
                try:
                    response = original_chat(**kwargs)
                except Exception:
                    self.failed_request = True
                    raise
                self.usage.append(response.usage.model_dump() if response.usage else None)
                self.returned_models.append(response.model)
                if getattr(response, "error", None) or not response.choices:
                    self.failed_request = True
                    raise ValueError("Invalid model API response")
                self.failed_request = False
                write_json(args.output / "partial.json", {
                    "messages": kwargs.get("messages", []) + [response.choices[0].message.model_dump()],
                    "usage": self.usage, "returned_models": self.returned_models})
                return response
            self.chat = measured
    upstream.ChatModel = MeasuredModel
    # Preserve the original agent loop, prompts and retries; correct only the
    # process boundary that otherwise drops our embedding/top-k configuration.
    upstream.LoggingMCPClient.connect_copilot = connect_copilot
    task = read_json(args.task)
    client = upstream.LoggingMCPClient()
    result = {"task_id": task["task_id"], "status": "infra_error",
              "error_type": "worker_error", "started_at": now()}
    try:
        await client.connect_copilot()
        answer, messages = await client.process_query(task["Question"])
        write_json(args.output / "trajectory.json", [{**task, "response": answer, "messages": messages}])
        result.update(usage=client.chat_model.usage, returned_models=client.chat_model.returned_models,
                      status="infra_error" if client.chat_model.failed_request else "generated",
                      error_type="model_api_error" if client.chat_model.failed_request else None)
    finally:
        result["finished_at"] = now()
        write_json(args.output / "generation.json", result)
        await client.cleanup()


def judge(args):
    import runpy
    import utils.llm_api as api
    original = api.ChatModel
    telemetry = []
    raw_responses = []
    class MeasuredJudge(original):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            original_chat = self.chat
            def measured(**kwargs):
                response = original_chat(**kwargs)
                telemetry.append({"model": response.model,
                                  "usage": response.usage.model_dump() if response.usage else None})
                raw_responses.append(response.choices[0].message.content)
                write_json(args.output / "judge-usage.json", telemetry)
                write_json(args.output / "judge-responses.json", raw_responses)
                return response
            self.chat = measured
    api.ChatModel = MeasuredJudge
    sys.argv = ["llm_as_judge_baseline", "--trajectory_path", str(args.task),
                "--output_dir", str(args.output / "official"), "--model_name", os.environ["MODEL"]]
    if args.auto_key_points:
        sys.argv.append("--auto_key_points")
    runpy.run_module("evaluator.llm_as_judge_baseline", run_name="__main__")
    files = list((args.output / "official").glob("*/*.json"))
    if len(files) != 1:
        raise ValueError("Expected one original scorer output")
    results, expected = read_json(files[0]), read_json(args.task)
    if len(results) != 1 or results[0]["task_id"] != expected[0]["task_id"]:
        raise ValueError("Original scorer omitted task or emitted wrong ID")
    result = results[0]
    if not raw_responses or not isinstance(raw_responses[-1], str):
        raise ValueError("Missing raw judge response")
    verdict = validate_judgment(result, raw_responses[-1])
    write_json(args.output / "judgment.json", {"status": "succeeded" if verdict == "success" else "failed",
               "score": result["reward"], "error_type": None,
               "scoring_evidence": str(files[0].relative_to(args.output)), "usage": telemetry})


async def health(args):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    config = read_json("baseline/mcp_copilot/config/clean_config.json")["mcpServers"][args.server]
    params = StdioServerParameters(command=config["command"], args=config.get("args", []),
                                  env={**copilot_environment(os.environ), **config.get("env", {})})
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            response = await session.list_tools()
            write_json(args.output, {"ok": True, "tools": [t.name for t in response.tools],
                                    "schemas": {t.name: t.inputSchema for t in response.tools}, "checked_at": now()})


async def index(args):
    from openai import AsyncOpenAI
    import math
    servers = read_json(args.task)
    client = AsyncOpenAI(base_url=os.environ["EMBEDDING_BASE_URL"],
                         api_key=os.environ["EMBEDDING_API_KEY"], timeout=120, max_retries=2)
    dimensions, similarities = set(), []
    async def embed(text, original):
        response = await client.embeddings.create(model=os.environ["EMBEDDING_MODEL"],
                                                  input=[text], encoding_format="float")
        vec = response.data[0].embedding
        if not vec or any(not math.isfinite(v) for v in vec):
            raise ValueError("Invalid embedding")
        dimensions.add(len(vec))
        if not args.rebuild:
            if len(original) != len(vec):
                raise ValueError("Published index and query model dimensions differ")
            denom = math.sqrt(sum(x*x for x in vec) * sum(x*x for x in original))
            sim = sum(a*b for a,b in zip(vec, original)) / denom if denom else 0
            similarities.append(sim)
            if sim < 0.999:
                raise ValueError("Published index/query embedding mismatch; no automatic replacement")
            return original
        return vec
    for server in servers:
        server["description_embedding"] = await embed(server["server_description"], server["description_embedding"])
        if args.rebuild:
            server["summary_embedding"] = await embed(server["server_summary"], server["summary_embedding"])
            for tool in server["tools"]:
                tool["description_embedding"] = await embed(tool["description"], tool["description_embedding"])
    if len(dimensions) != 1:
        raise ValueError("Inconsistent embedding dimensions")
    write_json(args.output, servers)
    write_json(args.output.with_suffix(".meta.json"), {
        "servers": len(servers), "tools": sum(len(s["tools"]) for s in servers),
        "dimensions": dimensions.pop(), "minimum_calibration_cosine": min(similarities) if similarities else None,
        "embedding_model": os.environ["EMBEDDING_MODEL"], "rebuilt": args.rebuild})


def probe(args):
    from utils.llm_api import ChatModel
    model = ChatModel(model_name=os.environ["MODEL"], model_url=os.environ["BASE_URL"],
                      api_key=os.environ["OPENAI_API_KEY"])
    response = model.complete_with_retry(messages=[{"role": "user", "content": "Call echo with text hello."}],
        tools=[{"type": "function", "function": {"name": "echo", "description": "Echo text",
              "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}}],
        tool_choice="auto")
    calls = response.choices[0].message.tool_calls
    if (not calls or any(c.function.name != "echo" or json.loads(c.function.arguments) != {"text": "hello"}
                         for c in calls)):
        raise ValueError("Endpoint did not return the expected tool call/arguments")
    write_json(args.output, {"returned_model": response.model, "checked_at": now()})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["generate", "judge", "health", "index", "probe"])
    p.add_argument("--upstream", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--task", type=Path)
    p.add_argument("--server")
    p.add_argument("--auto-key-points", action="store_true")
    p.add_argument("--rebuild", action="store_true")
    args = p.parse_args()
    sys.path.insert(0, str(args.upstream))
    os.chdir(args.upstream)
    if args.mode in ("generate", "judge"):
        args.output.mkdir(parents=True, exist_ok=True)
    if args.mode in ("judge", "probe"):
        globals()[args.mode](args)
    else:
        asyncio.run(globals()[args.mode](args))


if __name__ == "__main__":
    main()
