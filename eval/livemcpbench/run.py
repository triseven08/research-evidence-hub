#!/usr/bin/env python3
"""Container-native launcher for the 9-model partial reproduction of LiveMCPBench."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from common import UPSTREAM_COMMIT, UPSTREAM_URL, digest, initial_rows, load_env, now, read_json, report, write_json, validate_task_ids
from protocol import MODELS, EXCLUDED_MODELS, SCOPE, matrix, model_template, restore_originals, validate_models, scope_metadata

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
VLLM_VERSION = "0.11.0"


def say(message):
    print(message, flush=True)


def stop_process(proc):
    # Children such as MCP servers must not survive task timeouts or Ctrl-C.
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait()


def command(argv, log, env=None, cwd=None, timeout=3600):
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as output:
        proc = subprocess.Popen([str(a) for a in argv], stdout=output, stderr=subprocess.STDOUT,
                                env=env, cwd=cwd, start_new_session=True)
        try:
            return proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return 124
        finally:
            stop_process(proc)


def require_command(argv, log, **kwargs):
    if command(argv, log, **kwargs):
        raise RuntimeError(f"Command failed; inspect private log: {log}")


def adapter_hash():
    return digest({p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.glob("*.py"))})


def environment(args):
    env = {**load_env(HERE / "benchmark.env.example"), **os.environ, **load_env(args.env_file)}
    # The orchestrator's assigned GPU mask takes priority over the template.
    if "CUDA_VISIBLE_DEVICES" in os.environ and "CUDA_VISIBLE_DEVICES" not in load_env(args.env_file):
        env["CUDA_VISIBLE_DEVICES"] = os.environ["CUDA_VISIBLE_DEVICES"]
    return env


def check(env, models):
    errors = validate_models(models, env)
    if sys.version_info < (3, 11):
        errors.append("Python >=3.11 required")
    for executable in ("git", "nvidia-smi"):
        if not shutil.which(executable):
            errors.append(f"Missing {executable}")
    if sys.platform != "linux":
        errors.append("Linux container required")
    if not os.access("/root", os.W_OK):
        errors.append("The original tasks require writable /root inside the dedicated container")
    for key in ("QWEN_EMBEDDING_REVISION",):
        if not re.fullmatch(r"[a-f0-9]{40}", env.get(key, "")):
            errors.append(f"{key}: a pinned Hugging Face commit SHA is required")
    for key in ("TASK_TIMEOUT", "JUDGE_TIMEOUT", "TOOL_CHECK_TIMEOUT", "STARTUP_TIMEOUT", "INDEX_TIMEOUT", "EMBEDDING_MAX_MODEL_LEN"):
        try:
            if int(env[key]) <= 0:
                raise ValueError()
        except (KeyError, ValueError):
            errors.append(f"{key}: positive integer required")
    try:
        if not 0 < float(env["EMBEDDING_GPU_MEMORY"]) < 1:
            raise ValueError()
        if not 1024 <= int(env["EMBEDDING_PORT"]) <= 65535:
            raise ValueError()
    except (KeyError, ValueError):
        errors.append("Invalid embedding port or GPU memory fraction")
    return errors


def bootstrap(state, log, env):
    uv = shutil.which("uv")
    if not uv:
        boot = state / "bootstrap"
        require_command([sys.executable, "-m", "venv", boot], log, env=env)
        require_command([boot / "bin/python", "-m", "pip", "install", "uv==0.9.5"], log, env=env)
        uv = str(boot / "bin/uv")
    env["PATH"] = str(Path(uv).parent) + os.pathsep + env["PATH"]
    if not shutil.which("npx", path=env["PATH"]):
        node = state / "node"
        if not (node / "bin/npx").exists():
            require_command([uv, "tool", "run", "--from", "nodeenv==1.9.1", "nodeenv",
                             "--node=22.14.0", "--prebuilt", node], log, env=env)
        env["PATH"] = str(node / "bin") + os.pathsep + env["PATH"]
    # npx otherwise waits for a terminal when installing a previously unseen package.
    env["npm_config_yes"] = "true"
    return uv


def prepare_upstream(state, uv, env, logs):
    upstream = state / "upstream"
    if not upstream.exists():
        require_command(["git", "clone", UPSTREAM_URL, upstream], logs / "clone.log", env=env)
    # This directory is owned by the launcher; refuse to reuse unrelated repositories.
    actual = subprocess.check_output(["git", "-C", str(upstream), "remote", "get-url", "origin"], text=True).strip()
    if actual != UPSTREAM_URL:
        raise ValueError("Unexpected repository in managed upstream directory")
    require_command(["git", "-C", upstream, "checkout", "--detach", UPSTREAM_COMMIT], logs / "checkout.log", env=env)
    actual = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    if actual != UPSTREAM_COMMIT:
        raise ValueError("Upstream commit mismatch")
    require_command([uv, "sync", "--frozen", "--python", "3.11", "--project", upstream], logs / "dependencies.log", env=env)
    return upstream, upstream / ".venv/bin/python"


def fixture_links(source, destination, owned_root, home=Path("/root")):
    """Do not run the upstream reset script, which deletes arbitrary /root paths."""
    if not destination.exists():
        shutil.copytree(source, destination)
    for item in destination.iterdir():
        if not item.is_dir():
            continue
        link = home / item.name
        if link.is_symlink():
            if not link.resolve().is_relative_to(owned_root.resolve()):
                raise ValueError(f"Refusing to replace unrelated fixture link: {link}")
            link.unlink()
        elif link.exists():
            raise ValueError(f"Existing fixture path would be overwritten: {link}")
        link.symlink_to(item.resolve(), target_is_directory=True)


class Suite:
    def __init__(self, args, env, models):
        self.args, self.env, self.models = args, env, models
        self.state = ROOT / ".benchmark"
        self.run = ROOT / "private-results" / args.run_id
        self.logs = self.run / "logs"
        self.run.mkdir(parents=True, exist_ok=True)
        self.logs.mkdir(exist_ok=True)
        self.jobs = matrix()
        self.work = self.run / "upstream"
        self.python = None
        self.embedding = None

    def worker(self, mode, output, extra=(), env=None, timeout=3600):
        return command([self.python, HERE / "worker.py", mode, "--upstream", self.work,
                        "--output", output, *extra], self.logs / f"{mode}-{digest(str(output))[:12]}.log",
                       env=env or self.env, cwd=self.work, timeout=timeout)

    def model_env(self, key):
        m = self.models[key]
        return {**self.env, "BASE_URL": self.env[m["base_url_env"]],
                "OPENAI_API_KEY": self.env[m["api_key_env"]], "MODEL": m["request_model"]}

    def identity_ok(self, key, values):
        return bool(values) and all(v in self.models[key]["allowed_response_models"] for v in values)

    def initialize(self):
        uv = bootstrap(self.state, self.logs / "bootstrap.log", self.env)
        source, self.python = prepare_upstream(self.state, uv, self.env, self.logs)
        self.env["PATH"] = str(self.python.parent) + os.pathsep + self.env["PATH"]
        self.env["PYTHONPATH"] = str(self.work)
        tasks = read_json(source / "annotated_data/all_annotations.json")
        validate_task_ids([t["task_id"] for t in tasks])
        semantic = {**scope_metadata(), "models": self.models, "upstream_commit": UPSTREAM_COMMIT,
                    "task_digest": digest(tasks), "adapter_hash": adapter_hash(),
                    "settings": {k: v for k, v in self.env.items() if k in load_env(HERE / "benchmark.env.example") and not k.endswith(("_API_KEY", "_BASE_URL"))},
                    "endpoint_hashes": {k: digest(self.env[m["base_url_env"]]) for k, m in self.models.items()}}
        path = self.run / "config.json"
        if path.exists():
            previous = read_json(path)
            if not self.args.resume or previous["fingerprint"] != digest(semantic):
                raise ValueError("Existing run requires --resume with exactly the same model/settings/task/code fingerprint")
        else:
            if self.args.resume:
                raise ValueError("Cannot resume a run without a manifest")
            write_json(path, {"run_id": self.args.run_id, "source_type": "local_run", "benchmark": "LiveMCPBench",
                             "paper": "2508.01780v2", "started_at": now(), "finished_at": None,
                             "fingerprint": digest(semantic), **semantic})
        self.tasks = tasks
        write_json(self.run / "task_ids.json", [t["task_id"] for t in tasks])
        write_json(self.run / "matrix.json", self.jobs)
        write_json(self.run / "scope.json", scope_metadata())
        for job in self.jobs:
            directory = self.run / job["id"]
            directory.mkdir(exist_ok=True)
            if not (directory / "tasks.json").exists():
                report(directory, initial_rows(tasks))
        if not self.work.exists():
            shutil.copytree(source, self.work, ignore=shutil.ignore_patterns(".git", ".venv"))
            inventory = restore_originals(self.work)
            write_json(self.run / "inventory.json", inventory)
        # Verify the fixed working source has not changed since setup/resume.
        protected = [p for p in self.work.rglob("*.py") if "annotated_data" not in p.parts]
        hashes = {str(p.relative_to(self.work)): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
        hashes_path = self.run / "upstream-code-hashes.json"
        if hashes_path.exists() and hashes != read_json(hashes_path):
            raise ValueError("Working upstream code changed; cannot resume comparable run")
        write_json(hashes_path, hashes)
        gpu = subprocess.check_output(["nvidia-smi", "--query-gpu=name,uuid,memory.total,driver_version", "--format=csv,noheader"], text=True)
        if (self.run / "gpu.txt").exists() and (self.run / "gpu.txt").read_text() != gpu:
            raise ValueError("GPU/driver environment changed; use a new run ID")
        (self.run / "gpu.txt").write_text(gpu)
        require_command([uv, "pip", "freeze", "--python", self.python], self.run / "benchmark-packages.txt", env=self.env)
        # Analysis dependency only; the original agent environment remains frozen.
        analysis = self.state / "analysis"
        if not (analysis / "bin/python").exists():
            require_command([uv, "venv", "--python", "3.11", analysis], self.logs / "analysis-install.log", env=self.env)
        require_command([uv, "pip", "install", "--python", analysis / "bin/python", "scipy==1.16.2"],
                        self.logs / "analysis-install.log", env=self.env)
        self.analysis_python = analysis / "bin/python"
        # Isolated inference environment: never replace torch in the provided container.
        inference = self.state / "inference"
        if not (inference / "bin/vllm").exists():
            require_command([uv, "venv", "--python", "3.11", inference], self.logs / "inference-install.log", env=self.env)
            require_command([uv, "pip", "install", "--python", inference / "bin/python", f"vllm=={VLLM_VERSION}"],
                            self.logs / "inference-install.log", env=self.env, timeout=7200)
        self.vllm = inference / "bin/vllm"
        installed = subprocess.check_output([str(inference / "bin/python"), "-c",
            "import importlib.metadata; print(importlib.metadata.version('vllm'))"], text=True).strip()
        if installed != VLLM_VERSION:
            raise ValueError("Managed vLLM version changed")
        require_command([uv, "pip", "freeze", "--python", inference / "bin/python"], self.run / "inference-packages.txt", env=self.env)
        # Preserve published trajectories/human labels; never label them fresh measurements.
        original = read_json(source / "baseline/annotation/claude-sonnet-4-20250514_Qwen3-Embedding-0.6B.json")
        if {t["task_id"] for t in original} != {t["task_id"] for t in tasks}:
            raise ValueError("Published annotation coverage mismatch")
        for task in original:
            write_json(self.run / "published-sonnet" / task["task_id"] / "trajectory.json", [task])

    def preflight(self):
        # Restore fixture paths before checking servers that refer to them.
        self.fixtures("preflight")
        configs = read_json(self.work / "baseline/mcp_copilot/config/clean_config.json")["mcpServers"]
        expected = {s["server_name"]: {t["name"] for t in s["tools"]}
                    for s in read_json(self.work / "baseline/mcp_copilot/config/paper-index.json")}
        expected_schemas = {}
        for group in read_json(self.work / "tools/LiveMCPTool/tools.json"):
            for name, value in group["tools"].items():
                expected_schemas[name] = {t["name"]: t["inputSchema"] for t in value["tools"]}
        health = {}
        for i, name in enumerate(configs, 1):
            say(f"Checking MCP server {i}/70: {name}")
            path = self.run / "health" / f"{i}.json"
            path.unlink(missing_ok=True)
            code = self.worker("health", path, ["--server", name], timeout=int(self.env["TOOL_CHECK_TIMEOUT"]))
            item = read_json(path) if code == 0 and path.exists() else {"ok": False, "exit_code": code}
            item["matches_paper_tools"] = item.get("ok", False) and set(item.get("tools", [])) == expected[name]
            item["matches_paper_schemas"] = item.get("schemas") == expected_schemas[name]
            health[name] = item
            write_json(self.run / "tool-health.json", health)
        if not all(v["matches_paper_tools"] and v["matches_paper_schemas"] for v in health.values()):
            raise ValueError("Tool availability/schema-name drift: run stopped; see tool-health.json")
        for key in MODELS:
            say(f"Checking exact model endpoint: {key}")
            path = self.run / "probes" / f"{key}.json"
            path.unlink(missing_ok=True)
            code = self.worker("probe", path, env=self.model_env(key), timeout=int(self.env["JUDGE_TIMEOUT"]))
            if code or not path.exists() or not self.identity_ok(key, [read_json(path)["returned_model"]]):
                raise ValueError(f"{key}: model/parameter/tool-calling probe failed; no model substitution")

    def fixtures(self, job_id):
        target = self.run / job_id / "fixtures"
        fixture_links(self.work / "annotated_data", target, self.run.parent)
        if not (target / "git").exists():
            require_command(["git", "clone", target / "git.bundle", target / "git"], self.logs / "fixtures.log", env=self.env)
            fixture_links(self.work / "annotated_data", target, self.run.parent)

    @contextlib.contextmanager
    def serve_embedding(self, kind):
        model = "Qwen/Qwen3-Embedding-0.6B" if kind == "qwen" else "BAAI/bge-m3"
        revision = self.env["QWEN_EMBEDDING_REVISION" if kind == "qwen" else "BGE_EMBEDDING_REVISION"]
        port = int(self.env["EMBEDDING_PORT"])
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))  # Never reuse an unrelated process on the port.
        logfile = (self.logs / f"embedding-{kind}.log").open("ab")
        argv = [str(self.vllm), "serve", model, "--revision", revision, "--runner", "pooling",
                "--served-model-name", kind + "-embedding", "--host", "127.0.0.1", "--port", str(port),
                "--gpu-memory-utilization", self.env["EMBEDDING_GPU_MEMORY"], "--max-num-seqs", "1",
                "--max-model-len", self.env["EMBEDDING_MAX_MODEL_LEN"], "--enforce-eager"]
        proc = subprocess.Popen(argv, env=self.env, stdout=logfile, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + int(self.env["STARTUP_TIMEOUT"])
            while True:
                if proc.poll() is not None:
                    raise RuntimeError(f"GPU embedding service exited; inspect embedding-{kind}.log")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError("GPU embedding service startup timeout")
                    time.sleep(2)
            self.env.update(EMBEDDING_BASE_URL=f"http://127.0.0.1:{port}/v1", EMBEDDING_API_KEY="local",
                            EMBEDDING_MODEL=kind + "-embedding", ABSTRACT_MODEL="qwen25_72b_int4_instruct",
                            TOP_SERVERS="5", EMBEDDING_DIMENSIONS="1024")
            index = self.run / "indexes" / f"{kind}.json"
            if not index.exists():
                say(f"Preparing {kind} index (published summaries; no replacement LLM)")
                extra = ["--task", self.work / "baseline/mcp_copilot/config/paper-index.json"]
                if kind == "bge":
                    extra += ["--rebuild"]
                code = self.worker("index", index, extra, timeout=int(self.env["INDEX_TIMEOUT"]))
                if code or not index.exists():
                    raise ValueError("Embedding/index compatibility check failed")
            self.env["MCP_DATA_PATH"] = str(index)
            yield
        finally:
            stop_process(proc)
            logfile.close()

    def run_job(self, job):
        directory = self.run / job["id"]
        rows = read_json(directory / "tasks.json")
        if [row["task_id"] for row in rows] != [task["task_id"] for task in self.tasks]:
            raise ValueError("Saved task order/coverage differs from the dataset; refusing to resume")
        if job["kind"] == "generate":
            self.fixtures(job["id"])
        for i, (task, row) in enumerate(zip(self.tasks, rows), 1):
            if row["status"] != "not_run":
                continue  # No retry until a success; preserve the first formal outcome.
            say(f"{job['id']}: task {i}/95")
            output = directory / task["task_id"]
            output.mkdir(exist_ok=True)
            started = time.monotonic()
            # Persist in-flight state before calling any paid model. If interrupted, resume
            # leaves this attempt incomplete rather than rerunning it invisibly.
            row.update(status="infra_error" if job["kind"] == "generate" else "judge_error",
                       error_type="interrupted", started_at=now())
            report(directory, rows)
            if job["kind"] == "generate":
                task_path = output / "input.json"
                write_json(task_path, task)
                env = self.model_env(job["model"])
                env["TOP_TOOLS"] = str(job["top_tools"])
                code = self.worker("generate", output, ["--task", task_path], env, int(self.env["TASK_TIMEOUT"]))
                generation = output / "generation.json"
                if code or not generation.exists():
                    row.update(error_type="task_timeout" if code == 124 else "generation_error")
                    report(directory, rows)
                    continue
                data = read_json(generation)
                if data["status"] != "generated" or not self.identity_ok(job["model"], data.get("returned_models", [])):
                    row.update(error_type="model_api_or_identity_error")
                    report(directory, rows)
                    continue
                trajectory = output / "trajectory.json"
            else:
                trajectory = self.run / job["source"] / task["task_id"] / "trajectory.json"
                if job["source"] != "published-sonnet":
                    source_rows = read_json(self.run / job["source"] / "tasks.json")
                    source = next(r for r in source_rows if r["task_id"] == task["task_id"])
                    if source["status"] not in ("succeeded", "failed", "judge_error"):
                        row.update(error_type="source_generation_incomplete")
                        report(directory, rows)
                        continue
                if not trajectory.exists():
                    row.update(error_type="missing_source_trajectory")
                    report(directory, rows)
                    continue
            row.update(status="judge_error", error_type="interrupted_judging",
                       trace_path=str(trajectory.relative_to(self.run)))
            report(directory, rows)
            extra = ["--task", trajectory]
            if job.get("auto_key_points"):
                extra += ["--auto-key-points"]
            code = self.worker("judge", output, extra, self.model_env(job["judge"]), int(self.env["JUDGE_TIMEOUT"]))
            verdict_path = output / "judgment.json"
            if code or not verdict_path.exists():
                row.update(error_type="judge_timeout" if code == 124 else "judge_error")
            else:
                verdict = read_json(verdict_path)
                if self.identity_ok(job["judge"], [u["model"] for u in verdict["usage"]]):
                    row.update(verdict)
                    row["scoring_evidence"] = str((output / verdict["scoring_evidence"]).relative_to(self.run))
                else:
                    row.update(error_type="judge_identity_error")
            row.update(duration_ms=round((time.monotonic() - started) * 1000), finished_at=now())
            report(directory, rows)

    def execute(self):
        self.initialize()
        self.preflight()
        for kind in sorted({j["embedding"] for j in self.jobs if j["kind"] == "generate"}):
            jobs = [j for j in self.jobs if j["kind"] == "generate" and j["embedding"] == kind]
            if any(any(r["status"] == "not_run" for r in read_json(self.run / j["id"] / "tasks.json")) for j in jobs):
                with self.serve_embedding(kind):
                    for job in jobs:
                        self.run_job(job)
        for job in self.jobs:
            if job["kind"] == "judge":
                self.run_job(job)
        require_command([self.analysis_python, HERE / "analyze.py", self.run], self.logs / "analysis.log", env=self.env)
        config = read_json(self.run / "config.json")
        config["finished_at"] = now()
        write_json(self.run / "config.json", config)
        say(f"Automatic stages ended. Review {self.run / 'reproduction-status.json'}")
        return 0 if read_json(self.run / "reproduction-status.json")["scope_complete"] else 2


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["init", "plan", "check", "run", "analyze"], nargs="?", default="plan")
    p.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    p.add_argument("--models", type=Path, default=ROOT / "paper-models.json")
    p.add_argument("--run-id", default=SCOPE)
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}", args.run_id):
        raise ValueError("Invalid run ID")
    if args.action == "analyze":
        run = ROOT / "private-results" / args.run_id
        python = ROOT / ".benchmark/analysis/bin/python"
        if not (run / "matrix.json").exists() or not python.exists():
            raise ValueError("No initialized suite/analysis environment for this run")
        require_command([python, HERE / "analyze.py", run], run / "logs/analysis.log")
        status = read_json(run / "reproduction-status.json")
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0 if status["scope_complete"] else 2
    if args.action == "init":
        if not args.env_file.exists():
            shutil.copyfile(HERE / "benchmark.env.example", args.env_file)
            args.env_file.chmod(0o600)
        if not args.models.exists():
            write_json(args.models, model_template())
        else:
            models = read_json(args.models)
            if not isinstance(models, dict):
                raise ValueError("Existing model map must be a JSON object")
            removed = sorted(set(models) & set(EXCLUDED_MODELS))
            if removed:
                write_json(args.models, {k: v for k, v in models.items() if k not in EXCLUDED_MODELS})
                say("Removed excluded model entries: " + ", ".join(removed))
        say(f"Configure {args.env_file} and {args.models}; retained model settings and existing env were preserved.")
        return 0
    if args.action == "plan":
        jobs = matrix()
        text = {**scope_metadata(), "paper": "2508.01780v2", "upstream_commit": UPSTREAM_COMMIT,
                "tasks_per_job": 95, "generation_jobs": sum(j["kind"] == "generate" for j in jobs),
                "total_generation_tasks": sum(j["kind"] == "generate" for j in jobs) * 95, "judging_jobs": len(jobs),
                "minimum_judge_calls": len(jobs) * 95,
                "additional_auto_keypoint_calls": sum(j.get("auto_key_points", False) for j in jobs) * 95, "jobs": jobs,
                "manual_requirements": ["model/version/provider provenance", "runtime/container provenance",
                    "2026-01-31 price comparison for included models",
                    "review included results, paper/code differences and exclusions"]}
        print(json.dumps(text, ensure_ascii=False, indent=2))
        return 0
    env = environment(args)
    models = read_json(args.models) if args.models.exists() else {}
    errors = check(env, models)
    if errors:
        print("Preflight not ready:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 2
    if args.action == "check":
        say("Static prerequisites passed; live endpoints/tools/GPU model loads are checked by run.")
        return 0
    os.umask(0o077)
    state = ROOT / ".benchmark"
    state.mkdir(exist_ok=True)
    with (state / "execution.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another benchmark process owns the shared fixture paths")
        suite = Suite(args, env, models)
        try:
            return suite.execute()
        except (Exception, KeyboardInterrupt) as exc:
            write_json(suite.run / "reproduction-status.json", {
                **scope_metadata(), "complete": False, "scope_complete": False,
                "status": "interrupted" if isinstance(exc, KeyboardInterrupt) else "blocked",
                "error_type": type(exc).__name__, "message": str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Inspect private logs",
                "updated_at": now()})
            raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Interrupted; completed outcomes and incomplete attempts were preserved.", file=sys.stderr)
        sys.exit(130)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
