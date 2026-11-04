"""Dependency-free manifest, sampling and reporting utilities."""
import hashlib
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

UPSTREAM_URL = "https://github.com/icip-cas/LiveMCPBench.git"
UPSTREAM_COMMIT = "36a51a1065dda49c1e503b87edf33a1e0b331a74"
STATES = ("succeeded", "failed", "infra_error", "judge_error", "not_run")


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text())


def validate_task_ids(ids):
    if (not isinstance(ids, list) or len(ids) != 95
            or any(not isinstance(i, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", i) for i in ids)
            or len(set(ids)) != 95):
        raise ValueError("Expected exactly 95 distinct, path-safe task IDs")
    return ids


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    os.replace(temp, path)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def load_env(path):
    """Read literal dotenv values without eval, source, interpolation or key logging."""
    if not path.exists():
        return {}
    result = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError(f"Invalid environment assignment at line {number}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        result[key] = value
    return result


def summary(rows):
    if len({r["task_id"] for r in rows}) != len(rows):
        raise ValueError("Duplicate formal results")
    if any(r["status"] not in STATES for r in rows):
        raise ValueError("Unknown task status")
    counts = Counter(r["status"] for r in rows)
    n = len(rows)
    scored = counts["succeeded"] + counts["failed"]
    return {
        "counts": {"planned": n, **{s: counts[s] for s in STATES}},
        "planned_success_rate": counts["succeeded"] / n if n else None,
        "scored_success_rate": counts["succeeded"] / scored if scored else None,
        "coverage": scored / n if n else None,
        "cost": None,
        "metric_note": "Project denominator accounting; scorer verdicts are reported separately.",
    }


def initial_rows(tasks):
    return [{"task_id": t["task_id"], "attempt_id": "formal-1", "category": t["category"],
             "status": "not_run", "score": None, "error_type": None,
             "duration_ms": None, "trace_path": None, "scoring_evidence": None}
            for t in tasks]


def parse_verdict(text):
    # Do not interpret "unsuccessful" or an unparseable response as a valid verdict.
    matches = re.findall(r'^Status:\s*["\']?(success|failure)["\']?\s*$',
                         text, re.MULTILINE | re.IGNORECASE)
    if len(matches) != 1:
        raise ValueError("Judge response has no unique success/failure Status line")
    return matches[0].lower()


def report(run_dir, rows):
    stats = summary(rows)
    write_json(run_dir / "tasks.json", rows)
    write_json(run_dir / "summary.json", stats)
    c = stats["counts"]
    (run_dir / "report.md").write_text(
        "# LiveMCPBench 运行记录（待审核）\n\n"
        f"计划 {c['planned']}；成功 {c['succeeded']}；失败 {c['failed']}；"
        f"环境错误 {c['infra_error']}；评分错误 {c['judge_error']}；未执行 {c['not_run']}。\n\n"
        "指标分母见 summary.json，原始轨迹与评分依据均留在本地。\n"
        "正式报告仍需补充案例分析、工具故障复核、方法限制和公开审核。\n"
    )
    return stats
