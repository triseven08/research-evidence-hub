"""Available-model subset of paper v2, with explicit exclusions."""
from common import read_json, write_json

PAPER_MODELS = {
    "sonnet4": ("Claude-Sonnet-4-20250514", "claude-sonnet-4-20250514", "ANTHROPIC_COMPAT", 78.95),
    "opus4": ("Claude-Opus-4-20250514", "claude-opus-4-20250514", "ANTHROPIC_COMPAT", 70.53),
    "gpt5": ("GPT-5", "openai/gpt-5", "OPENROUTER", 52.63),
    "qwen235": ("Qwen3-235B-A22B", "qwen/qwen3-235b-a22b", "OPENROUTER", 48.42),
    "r1": ("DeepSeek-R1-0528", "deepseek/deepseek-r1-0528", "OPENROUTER", 48.42),
    "gpt5mini": ("GPT-5-Mini", "openai/gpt-5-mini", "OPENROUTER", 45.26),
    "gpt41mini": ("GPT-4.1-Mini", "openai/gpt-4.1-mini", "OPENROUTER", 44.21),
    "qwen72": ("Qwen2.5-72B-Instruct", "qwen25_72b_int4_instruct", "QWEN72", 43.16),
    "v3": ("DeepSeek-V3-0324", "deepseek/deepseek-chat-v3-0324", "OPENROUTER", 42.11),
    "gemini": ("Gemini-2.5-Pro", "models/gemini-2.5-pro", "GOOGLE_COMPAT", 41.05),
    "gpt41": ("GPT-4.1", "openai/gpt-4.1", "OPENROUTER", 38.95),
    "qwen32": ("Qwen3-32B", "qwen/qwen3-32b", "OPENROUTER", 30.53),
}
EXCLUDED_MODELS = {
    "sonnet4": "Anthropic API retired; OpenRouter endpoint list empty (checked 2026-11-03)",
    "opus4": "Anthropic API retired; OpenRouter endpoint list empty (checked 2026-11-03)",
    "qwen235": "Original Qwen3-235B-A22B OpenRouter endpoint list empty (checked 2026-11-03)",
}
MODELS = {key: value for key, value in PAPER_MODELS.items() if key not in EXCLUDED_MODELS}
JUDGES = [m for m in MODELS if m not in ("gpt5", "gpt5mini")]
SCOPE = "paper-v2-available9"


def scope_metadata():
    return {"scope": SCOPE, "reproduction_type": "partial_reproduction",
            "included_models": list(MODELS), "full_paper_complete": False,
            "excluded_models": [{"id": key, "paper_model": PAPER_MODELS[key][0], "reason": reason}
                                for key, reason in EXCLUDED_MODELS.items()],
            "excluded_experiments": [
                "Main/crossjudge jobs for the three excluded models",
                "Sonnet 4 retrieval ablations (top-1, top-10, BGE-M3)",
                "Three excluded judges in human/auto key-point agreement and voting",
                "Fresh Claude human labels, error attribution and hallucination analysis"],
            "note": "Listed API endpoints are candidates, not authenticated/parameter-verified services. "
                    "Published Sonnet trajectories are reused without calling Claude."}


def model_template():
    result = {}
    for name, (paper, request, prefix, _) in MODELS.items():
        # All included candidates have listed OpenRouter endpoints. These mappings
        # still require account, identity, quantization and parameter verification.
        if name in ("qwen72", "gemini"):
            request = {"qwen72": "qwen/qwen-2.5-72b-instruct", "gemini": "google/gemini-2.5-pro"}[name]
            prefix = "OPENROUTER"
        key_prefix = {"ANTHROPIC_COMPAT": "ANTHROPIC", "GOOGLE_COMPAT": "GOOGLE"}.get(prefix, prefix)
        result[name] = {"paper_model": paper, "request_model": request,
                        "base_url_env": prefix + "_BASE_URL", "api_key_env": key_prefix + "_API_KEY",
                        "allowed_response_models": [], "version_evidence": "",
                        "provider_evidence": ""}
    return result


def matrix():
    jobs = []
    for model in MODELS:
        jobs.append({"id": f"main-{model}", "kind": "generate", "model": model,
                     "judge": "v3", "embedding": "qwen", "top_tools": 5})
    for model in MODELS:
        jobs.append({"id": f"crossjudge-{model}", "kind": "judge", "judge": "qwen72",
                     "source": f"main-{model}", "auto_key_points": False})
    for judge in JUDGES:
        for auto in (False, True):
            jobs.append({"id": f"agreement-{'auto' if auto else 'human'}-{judge}", "kind": "judge",
                         "judge": judge, "source": "published-sonnet", "auto_key_points": auto})
    return jobs


def validate_models(models, env):
    errors = []
    if not isinstance(models, dict):
        return ["Model configuration must be a JSON object"]
    if not models:
        return ["Missing model configuration; run init and configure paper-models.json"]
    if set(models) != set(MODELS):
        errors.append("Model map must contain exactly the 9 included models; run init to remove excluded entries")
    for key in MODELS:
        entry = models.get(key, {})
        for field in ("request_model", "base_url_env", "api_key_env", "version_evidence", "provider_evidence"):
            if not entry.get(field):
                errors.append(f"{key}: missing {field}")
        allowed = entry.get("allowed_response_models")
        if not isinstance(allowed, list) or not allowed or not all(isinstance(v, str) and v for v in allowed):
            errors.append(f"{key}: allowed_response_models must explicitly identify the endpoint's model")
        for field in ("base_url_env", "api_key_env"):
            if not env.get(entry.get(field, "")):
                errors.append(f"{key}: missing value for {field}")
        if entry.get("paper_model") != MODELS[key][0]:
            errors.append(f"{key}: paper model identity changed")
    return errors


def restore_originals(upstream):
    """Restore released snapshots; remove only the index-only, non-executable alias."""
    config_dir = upstream / "baseline/mcp_copilot/config"
    config = read_json(config_dir / "original_clean_config.json")
    tools = read_json(upstream / "tools/LiveMCPTool/original_tools.json")
    index = read_json(config_dir / "original_mcp_arg_Qwen3-Embedding-0.6B_qwen25_72b_int4_instruct copy.json")
    expected = {}
    for group in tools:
        for server, value in group["tools"].items():
            expected[server] = {t["name"] for t in value["tools"]}
    executable = set(config["mcpServers"])
    if set(expected) != executable or len(executable) != 70 or sum(map(len, expected.values())) != 527:
        raise ValueError("Original execution inventory does not match paper's 70/527")
    filtered = [s for s in index if s["server_name"] in executable]
    if len(filtered) != 70 or {s["server_name"] for s in filtered} != executable:
        raise ValueError("Index/server alignment failed")
    for server in filtered:
        if {t["name"] for t in server["tools"]} != expected[server["server_name"]]:
            raise ValueError("Index tool names differ from original tool metadata")
    write_json(config_dir / "clean_config.json", config)
    write_json(upstream / "tools/LiveMCPTool/tools.json", tools)
    write_json(config_dir / "paper-index.json", filtered)
    # The server otherwise invokes the generator and can silently add a fresh index.
    server_file = upstream / "baseline/mcp_copilot/server.py"
    source = server_file.read_text()
    needle = "    asyncio.run(run_generation())"
    if source.count(needle) != 1:
        raise ValueError("Unexpected upstream server.py: refusing an unverified patch")
    server_file.write_text(source.replace(needle, "    # Frozen paper index supplied via MCP_DATA_PATH."))
    return {"servers": 70, "tools": 527,
            "removed_index_only_aliases": [s["server_name"] for s in index if s["server_name"] not in executable],
            "index": str(config_dir / "paper-index.json")}
