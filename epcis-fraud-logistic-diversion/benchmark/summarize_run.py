"""Summarize a Caliper run from its per-round JSONL files.

Usage: python3 summarize_run.py output/<run_id> [--flag-threshold 70]
Prints one row per round: transactions, committed, rejected by design (Class A),
system errors, success rate, latency percentiles of committed transactions,
and for submit rounds the number of events flagged at the threshold.
"""
import argparse
import json
import math
import re
from pathlib import Path


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(q * len(ordered)) - 1)]


def summarize_round(records, flag_threshold=70):
    committed = [r for r in records if r.get("outcome") == "committed"]
    rejected = [r for r in records if r.get("outcome") == "rejected"]
    errors = [r for r in records if r.get("outcome") == "error"]
    latencies = [r["latencyMs"] for r in committed if r.get("latencyMs") is not None]
    scored = [r["riskScore"] for r in committed if r.get("riskScore") is not None]
    total = len(records)
    return {
        "transactions": total,
        "committed": len(committed),
        "rejected_by_design": len(rejected),
        "system_errors": len(errors),
        "success_rate": (len(committed) + len(rejected)) / total if total else None,
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "p99_ms": percentile(latencies, 0.99),
        "retried": sum(1 for r in records if r.get("retries", 0) > 0),
        "flagged": sum(1 for s in scored if s >= flag_threshold) if scored else None,
    }


def load_rounds(run_dir):
    rounds = {}
    for path in sorted(Path(run_dir, "round_scores").glob("r*_w*.jsonl")):
        match = re.match(r"r(\d+)_(.+)_w\d+\.jsonl$", path.name)
        key = (int(match.group(1)), match.group(2))
        records = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        rounds.setdefault(key, []).extend(records)
    return rounds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    parser.add_argument("--flag-threshold", type=int, default=70)
    args = parser.parse_args()
    columns = ["transactions", "committed", "rejected_by_design", "system_errors", "success_rate",
               "p50_ms", "p95_ms", "p99_ms", "retried", "flagged"]
    print("\t".join(["round", "label"] + columns))
    for (index, label), records in sorted(load_rounds(args.run_dir).items()):
        row = summarize_round(records, args.flag_threshold)
        cells = [f"{row[c]:.4f}" if isinstance(row[c], float) else str(row[c]) for c in columns]
        print("\t".join([str(index), label] + cells))


if __name__ == "__main__":
    main()
