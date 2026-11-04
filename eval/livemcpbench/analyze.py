"""Recompute tables from per-task evidence; never infer completeness from exit code."""
import csv
import json
import math
import sys
from pathlib import Path

from common import now, read_json, summary, write_json, validate_task_ids
from protocol import MODELS, JUDGES, SCOPE, matrix, scope_metadata


def exact_mcnemar(left, right):
    if set(left) != set(right):
        raise ValueError("Paired tests require identical task IDs")
    b = sum(left[k] == 1 and right[k] == 0 for k in left)
    c = sum(left[k] == 0 and right[k] == 1 for k in left)
    n = b + c
    return {"b": b, "c": c, "p_value": min(1.0, 2 * sum(math.comb(n, k) for k in range(min(b, c)+1)) / 2**n) if n else 1.0}


def dump_csv(path, rows):
    if not rows:
        path.unlink(missing_ok=True)
        return
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def outcomes(rows):
    if any(r["status"] not in ("succeeded", "failed") for r in rows):
        return None
    return {r["task_id"]: int(r["status"] == "succeeded") for r in rows}


def evidence_exists(run, value):
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        return False
    path = (run / value).resolve()
    return path.is_relative_to(run.resolve()) and path.is_file() and path.stat().st_size > 0


def behavior(run, model):
    directory = run / f"main-{model}"
    total = {"steps": 0, "tools": 0, "execute": 0, "route": 0, "input_tokens": 0, "output_tokens": 0}
    records = 0
    usage_complete = True
    for row in read_json(directory / "tasks.json"):
        path = directory / row["task_id"] / "trajectory.json"
        gen = directory / row["task_id"] / "generation.json"
        if not path.exists() or not gen.exists():
            continue
        entry = read_json(path)[0]
        records += 1
        total["steps"] += len(entry["messages"])
        used = set()
        for message in entry["messages"]:
            for call in message.get("tool_calls") or []:
                fn = call["function"]
                if fn["name"] == "route":
                    total["route"] += 1
                if fn["name"] == "execute-tool":
                    total["execute"] += 1
                    try:
                        params = json.loads(fn["arguments"])
                        used.add((params["server_name"], params["tool_name"]))
                    except (ValueError, KeyError, TypeError):
                        pass
        total["tools"] += len(used)
        usage = read_json(gen).get("usage", [])
        usage_complete &= bool(usage) and all(u is not None for u in usage)
        for item in usage:
            if item:
                total["input_tokens"] += item["prompt_tokens"]
                total["output_tokens"] += item["completion_tokens"]
    return {"recorded_tasks": records,
            **{k: total[k] / records if records else None for k in ("steps", "tools", "execute", "route")},
            "input_tokens": total["input_tokens"] if usage_complete and records == 95 else None,
            "output_tokens": total["output_tokens"] if usage_complete and records == 95 else None,
            "tokens_million": (total["input_tokens"] + total["output_tokens"]) / 1e6 if usage_complete and records == 95 else None}


def analyze(run):
    jobs = matrix()
    if (run / "matrix.json").exists() and read_json(run / "matrix.json") != jobs:
        raise ValueError("Run matrix differs from the current partial scope; do not reinterpret an older run")
    write_json(run / "reproduction-status.json", {**scope_metadata(), "complete": False,
               "scope_complete": False, "automatic_stages_complete": False,
               "status": "analyzing", "updated_at": now()})
    errors, results = [], {}
    expected_ids = set(validate_task_ids(read_json(run / "task_ids.json")))
    tables = run / "tables"
    tables.mkdir(exist_ok=True)
    for name in ("table2-main.csv", "table4-crossjudge.csv", "judge-agreement.csv", "kendall-tau.json", "judge-voting.json"):
        (tables / name).unlink(missing_ok=True)
    for job in jobs:
        path = run / job["id"] / "tasks.json"
        if not path.exists():
            errors.append(f"Missing {job['id']}")
            continue
        rows = read_json(path)
        stats = summary(rows)
        values = outcomes(rows)
        if len(rows) != 95 or {r["task_id"] for r in rows} != expected_ids or outcomes(rows) is None:
            errors.append(f"Incomplete {job['id']}")
            values = None
        elif any(not evidence_exists(run, r.get("trace_path"))
                 or not evidence_exists(run, r.get("scoring_evidence")) for r in rows):
            errors.append(f"Missing trace/scoring evidence for {job['id']}")
            values = None
        results[job["id"]] = {"rows": rows, "summary": stats, "outcomes": values}
    main = []
    for key, (paper, _, _, reference) in MODELS.items():
        result = results.get(f"main-{key}")
        if result:
            rate = result["summary"]["planned_success_rate"]
            main.append({"scope": SCOPE, "model": paper, "paper_success_pct": reference,
                         "observed_success_pct": rate * 100 if result["outcomes"] is not None else None,
                         "complete": result["outcomes"] is not None,
                         **result["summary"]["counts"], **behavior(run, key)})
    dump_csv(tables / "table2-main.csv", main)
    cross = []
    for key in MODELS:
        a, b = results.get(f"main-{key}"), results.get(f"crossjudge-{key}")
        if a and b:
            cross.append({"scope": SCOPE, "model": MODELS[key][0],
                          "deepseek_v3_pct": a["summary"]["planned_success_rate"] * 100 if a["outcomes"] else None,
                          "qwen72_pct": b["summary"]["planned_success_rate"] * 100 if b["outcomes"] else None,
                          "complete": bool(a["outcomes"] and b["outcomes"])})
    dump_csv(tables / "table4-crossjudge.csv", cross)
    if len(cross) == len(MODELS) and all(r["complete"] for r in cross):
        left, right = [r["deepseek_v3_pct"] for r in cross], [r["qwen72_pct"] for r in cross]
        statistic, p_value = None, None
        if len(set(left)) > 1 and len(set(right)) > 1:
            from scipy.stats import kendalltau
            tau = kendalltau(left, right, variant="b")
            statistic = float(tau.statistic) if math.isfinite(tau.statistic) else None
            p_value = float(tau.pvalue) if math.isfinite(tau.pvalue) else None
        write_json(tables / "kendall-tau.json", {"scope": SCOPE, "models": list(MODELS),
                   "tau_b": statistic, "p_value": p_value,
                   "defined": statistic is not None})
    human = {}
    for task_id in expected_ids:
        path = run / "published-sonnet" / task_id / "trajectory.json"
        if path.exists():
            entries = read_json(path)
            entry = entries[0] if isinstance(entries, list) and len(entries) == 1 else {}
            label = str(entry.get("task_success", "")).strip().lower()
            if entry.get("task_id") == task_id and label in ("success", "failure"):
                human[task_id] = int(label == "success")
    if set(human) != expected_ids:
        errors.append("Incomplete published human labels")
    agreement = []
    for auto in (False, True):
        for judge in JUDGES:
            key = f"agreement-{'auto' if auto else 'human'}-{judge}"
            values = results.get(key, {}).get("outcomes")
            complete = values is not None and set(values) == set(human) == expected_ids
            agreement.append({"scope": SCOPE, "judge": judge, "auto_key_points": auto, "complete": complete,
                              "agreement_pct": 100 * sum(values[k] == human[k] for k in human) / 95 if complete else None,
                              "success_pct": 100 * sum(values.values()) / 95 if complete else None})
    dump_csv(tables / "judge-agreement.csv", agreement)
    votes = [results.get(f"agreement-human-{j}", {}).get("outcomes") for j in JUDGES]
    if len(human) == 95 and all(v is not None for v in votes):
        predicted = {k: int(sum(v[k] for v in votes) >= len(votes)/2) for k in human}
        write_json(tables / "judge-voting.json", {
            "scope": SCOPE, "judges": JUDGES, "judge_count": len(JUDGES),
            "majority_agreement": sum(predicted[k] == human[k] for k in human)/95,
            "oracle_agreement": sum(any(v[k] == human[k] for v in votes) for k in human)/95,
            "source_type": "reevaluation_of_published_trajectories"})
    # Human analysis is not fabricated by the launcher. A human signs a separate
    # checklist after checking model provenance, live-data drift, cost and error labels.
    required = ("model_versions_and_quantization", "provider_routing", "container_and_tool_versions",
                "embedding_preprocessing", "paper_code_discrepancies",
                "historical_prices_and_cost_frontier", "included_results_and_exclusions")
    review_path = run / "reproduction-review.json"
    if not review_path.exists():
        write_json(review_path, {"scope": SCOPE, "reviewer": "", "reviewed_at": "",
                                 "evidence": dict.fromkeys(required, "")})
    review = read_json(review_path)
    # Evidence values are paths relative to the run directory, not unchecked booleans.
    manual_missing = []
    for key in required:
        value = review.get("evidence", {}).get(key)
        path = (run / value).resolve() if isinstance(value, str) and value else None
        if path is None or not path.is_relative_to(run.resolve()) or not path.is_file() or path.stat().st_size == 0:
            manual_missing.append(key)
    if not review.get("reviewer") or not review.get("reviewed_at"):
        manual_missing.append("reviewer_and_date")
    status = {**scope_metadata(), "complete": False,
              "scope_complete": not errors and not manual_missing, "automatic_stages_complete": not errors,
              "incomplete_jobs": errors, "manual_evidence_missing": manual_missing,
              "paper": "2508.01780v2", "updated_at": now(),
              "note": "scope_complete covers only the included experiments. Complete paper reproduction remains false. "
                      "Human sign-off is required; live-service and provider differences must be disclosed."}
    write_json(run / "reproduction-status.json", status)
    return status


if __name__ == "__main__":
    print(json.dumps(analyze(Path(sys.argv[1]).resolve()), ensure_ascii=False, indent=2))
