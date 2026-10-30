"""Per-drug SLA cut-off: a drug passes a round when at least `sla` of its anomalous transactions are flagged.

Usage: python3 -m validation.per_drug_sla <scenario.csv> <scores.json> [--sla 0.9] [--out table.tsv]
"""
import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from . import stats
from .checks_data import NORMAL_LABELS

SLA = 0.90
COLUMNS = ["drug_code", "anomalous", "detected", "detection_rate", "ci_low", "ci_high", "normal", "false_positives",
           "missed_types", "passes", "passes_confident"]


def read_drugs(scenario_csv):
    with open(scenario_csv, newline="", encoding="utf-8") as f:
        return {r["transaction_id"].strip(): r["drug_code"].strip() for r in csv.DictReader(f)}


def per_drug_table(rows, drugs, sla=SLA):
    by_drug = defaultdict(list)
    for row in rows:
        by_drug[drugs[row["tx"]]].append(row)
    table = []
    for drug in sorted(by_drug):
        positives = [r for r in by_drug[drug] if r["positive"]]
        normals = [r for r in by_drug[drug] if not r["positive"]]
        detected = sum(r["flagged"] for r in positives)
        low, high = stats.wilson(detected, len(positives))
        rate = detected / len(positives) if positives else None
        missed = Counter(r["label"] for r in positives if not r["flagged"])
        table.append({"drug_code": drug, "anomalous": len(positives), "detected": detected, "detection_rate": rate,
                      "ci_low": low if positives else None, "ci_high": high if positives else None,
                      "normal": len(normals), "false_positives": sum(r["flagged"] for r in normals),
                      "missed_types": ";".join(f"{k}:{v}" for k, v in sorted(missed.items())),
                      "passes": None if rate is None else rate >= sla,
                      "passes_confident": None if rate is None else low >= sla})
    return table


def summarize(table):
    evaluable = [r for r in table if r["passes"] is not None]
    return {"drugs": len(table), "evaluable": len(evaluable),
            "passing": sum(r["passes"] for r in evaluable),
            "passing_confident": sum(r["passes_confident"] for r in evaluable),
            "failing_types": Counter(t.split(":")[0] for r in evaluable if not r["passes"]
                                     for t in r["missed_types"].split(";") if t)}


def write_tsv(table, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(COLUMNS)
        for r in table:
            writer.writerow(["" if r[c] is None else (f"{r[c]:.4f}" if isinstance(r[c], float) else r[c]) for c in COLUMNS])


def rounds_summary(rounds, sla=SLA):
    lines = [f"| Round | Drugs | Evaluable | Pass (rate >= {sla:.0%}) | Pass (Wilson lower >= {sla:.0%}) | Share passing |",
             "|---|---|---|---|---|---|"]
    shares = []
    for name, table in rounds:
        s = summarize(table)
        share = s["passing"] / s["evaluable"] if s["evaluable"] else float("nan")
        shares.append(share)
        lines.append(f"| {name} | {s['drugs']} | {s['evaluable']} | {s['passing']} | {s['passing_confident']} | {share:.1%} |")
    if len(shares) > 1:
        mean, sd = stats.mean_sd(shares)
        lines.append(f"| mean ± sd | | | | | {mean:.1%} ± {sd:.1%} |")
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    parser.add_argument("scores")
    parser.add_argument("--sla", type=float, default=SLA)
    parser.add_argument("--out")
    args = parser.parse_args()
    scores = {t["transaction_id"]: t for t in json.loads(Path(args.scores).read_text())["transactions"]}
    drugs = read_drugs(args.scenario)
    with open(args.scenario, newline="", encoding="utf-8") as f:
        labels = {r["transaction_id"].strip(): r["anomaly_type"] for r in csv.DictReader(f)}
    rows = [{"tx": tx, "label": label, "positive": label not in NORMAL_LABELS, "flagged": scores[tx]["flagged"]}
            for tx, label in labels.items()]
    table = per_drug_table(rows, drugs, args.sla)
    if args.out:
        write_tsv(table, args.out)
    print("\n".join(rounds_summary([("run", table)], args.sla)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
