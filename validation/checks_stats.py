import hashlib
import json
import math
import random
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from . import stats
from .checks_data import NORMAL_LABELS, result
from .pipeline_runner import (CHAINCODE_DIR, ROOT, build_dataset, group_events, load_events, read_labels,
                              score_with_chaincode, score_with_oracle)

THRESHOLD = 70
ALL_TYPES = ["skip_commission", "out_of_order", "impossible_transit", "transit_diversion", "jurisdiction",
             "quantity_discrepancy", "shipment_divergence", "many_suppliers", "item_location_mismatch"]


def classify(labels, scores):
    rows = []
    for tx, label in labels.items():
        rows.append({"tx": tx, "label": label, "positive": label not in NORMAL_LABELS,
                     "flagged": scores[tx]["flagged"], "score": scores[tx]["score"]})
    return rows


def confusion(rows):
    tp = sum(r["positive"] and r["flagged"] for r in rows)
    fn = sum(r["positive"] and not r["flagged"] for r in rows)
    fp = sum(not r["positive"] and r["flagged"] for r in rows)
    tn = sum(not r["positive"] and not r["flagged"] for r in rows)
    return tp, fn, fp, tn


def compare_with_oracle(chaincode, oracle):
    flag_disagreements = [tx for tx in chaincode if chaincode[tx]["flagged"] != oracle[tx]["flagged"]]
    consistent_deciding, deciding = 0, 0
    only_chaincode, only_oracle = Counter(), Counter()
    alias = {"SHIPMENT_DIVERGENCE_AUDIT": "SHIPMENT_DIVERGENCE"}
    for tx in chaincode:
        c, o = chaincode[tx], oracle[tx]
        cc_codes = Counter()
        for e in c["events"]:
            for v in e["violations"]:
                cc_codes[alias.get(v["code"], v["code"])] += 1
        for v in c.get("audit_violations", []):
            cc_codes[alias.get(v["code"], v["code"])] += 1
        or_codes = Counter()
        for e in o["events"]:
            for v in e["violations"]:
                or_codes[v["code"]] += 1
        for v in o.get("audit_violations", []):
            or_codes[v["code"]] += 1
        for code in set(cc_codes) - set(or_codes):
            only_chaincode[code] += cc_codes[code]
        for code in set(or_codes) - set(cc_codes):
            only_oracle[code] += or_codes[code]
        if c["flagged"]:
            deciding += 1
            top = {alias.get(v["code"], v["code"]) for e in c["events"] for v in e["violations"] if v["score"] >= THRESHOLD}
            top |= {alias.get(v["code"], v["code"]) for v in c.get("audit_violations", []) if v["score"] >= THRESHOLD}
            oracle_codes = {v["code"] for e in o["events"] for v in e["violations"] if v["score"] >= THRESHOLD}
            oracle_codes |= {v["code"] for v in o.get("audit_violations", []) if v["score"] >= THRESHOLD}
            consistent_deciding += bool(top) and top <= oracle_codes
    return flag_disagreements, consistent_deciding, deciding, only_chaincode, only_oracle


def check_oracle(per_seed):
    total = sum(len(r["chaincode"]) for r in per_seed)
    disagreements, consistent, deciding = 0, 0, 0
    only_cc, only_or = Counter(), Counter()
    for r in per_seed:
        d, c, n, a, b = compare_with_oracle(r["chaincode"], r["oracle"])
        disagreements += len(d)
        consistent += c
        deciding += n
        only_cc.update(a)
        only_or.update(b)
    detail = (f"{len(per_seed)} seeds, {total} transactions: flag disagreements={disagreements}; "
              f"flagged transactions whose deciding chaincode code is also reported by the oracle={consistent}/{deciding}; "
              f"codes only in chaincode (events)={dict(only_cc)}; codes only in oracle (events)={dict(only_or)}; "
              f"see validation/DIVERGENCES.md")
    return result("9", "Oracle vs chaincode: 100% agreement on the flag of every transaction (divergences documented)",
                  disagreements == 0 and consistent == deciding, detail)


def per_type_table(per_seed):
    positives_pool = Counter()
    rows = []
    normals = [r for s in per_seed for r in s["rows"] if not r["positive"]]
    false_positives = sum(r["flagged"] for r in normals)
    for kind in ALL_TYPES:
        recalls, precisions, f1s = [], [], []
        tp_total = n_total = 0
        for s in per_seed:
            of_type = [r for r in s["rows"] if r["label"] == kind]
            tp = sum(r["flagged"] for r in of_type)
            fn = len(of_type) - tp
            fp = sum(r["flagged"] for r in s["rows"] if not r["positive"])
            p, rc, f = stats.precision_recall_f1(tp, fp, fn)
            recalls.append(rc)
            precisions.append(p)
            f1s.append(f)
            tp_total += tp
            n_total += len(of_type)
        fp_total = false_positives
        p_total, r_total, f_total = stats.precision_recall_f1(tp_total, fp_total, n_total - tp_total)
        rows.append({"type": kind, "n": n_total, "tp": tp_total, "precision": p_total, "recall": r_total, "f1": f_total,
                     "recall_ci": stats.wilson(tp_total, n_total), "precision_ci": stats.wilson(tp_total, tp_total + fp_total),
                     "recall_seed": stats.mean_sd(recalls), "precision_seed": stats.mean_sd(precisions),
                     "f1_seed": stats.mean_sd(f1s)})
    return rows, len(normals), false_positives


def check_statistics(per_seed):
    rows, normals, false_positives = per_type_table(per_seed)
    return result("14", ">= 30 seeds: precision, recall, F1, mean +- sd and Wilson 95% CI per anomaly type",
                  len(per_seed) >= 30 and all(r["n"] > 0 for r in rows),
                  f"{len(per_seed)} seeds; normal transactions={normals}, false positives={false_positives}"), rows


def pooled(per_seed):
    rows = [r for s in per_seed for r in s["rows"]]
    return rows, confusion(rows)


def check_ppv(per_seed, real_runs, rng_seed=5, size=1000, replicates=300):
    rows, (tp, fn, fp, tn) = pooled(per_seed)
    positives, negatives = tp + fn, fp + tn
    recall = tp / positives
    fpr = fp / negatives
    fpr_high = stats.wilson(fp, negatives)[1]
    anomalous = [r for r in rows if r["positive"]]
    normal = [r for r in rows if not r["positive"]]
    rng = random.Random(rng_seed)
    table, worst_gap = [], 0.0
    for p in (0.01, 0.05, 0.10):
        n_pos = round(p * size)
        measured = []
        for _ in range(replicates):
            sample = rng.sample(anomalous, n_pos) + rng.sample(normal, size - n_pos)
            sp = sum(r["flagged"] and r["positive"] for r in sample)
            sf = sum(r["flagged"] and not r["positive"] for r in sample)
            measured.append(sp / (sp + sf) if sp + sf else float("nan"))
        valid = [m for m in measured if not math.isnan(m)]
        mean_measured = sum(valid) / len(valid)
        bayes = stats.ppv(recall, fpr, p)
        lower = stats.ppv(recall, fpr_high, p)
        worst_gap = max(worst_gap, abs(mean_measured - bayes))
        table.append({"prevalence": p, "bayes": bayes, "bayes_lower": lower, "resampled": mean_measured,
                      "resampled_min": min(valid), "real": real_runs.get(p)})
    real_ok = all(t["real"] is not None for t in table)
    passed = worst_gap <= 0.01 and real_ok
    return result("15", "PPV at prevalence 1%, 5%, 10% by Bayes, checked against resampled and regenerated datasets",
                  passed, f"recall={recall:.4f}, FPR={fpr:.5f} (Wilson upper {fpr_high:.5f}); "
                  f"max |Bayes - resampled| = {worst_gap:.4f} (tolerance 0.01); regenerated runs present={real_ok}"), table


def run_prevalence_dataset(clean_csv, work, p, sample_per_drug, seed=1):
    if p == 0.01:
        cycle = ["none"] * 200
        cycle[0], cycle[100] = "skip_commission", "jurisdiction"
    elif p == 0.05:
        cycle = ["none"] * 200
        for i, kind in enumerate(ALL_TYPES + ["skip_commission"]):
            cycle[i * 19] = kind
    else:
        cycle = ["none"] * 100
        for i, kind in enumerate(ALL_TYPES + ["skip_commission"]):
            cycle[i * 9] = kind
    dataset = build_dataset(clean_csv, Path(work) / f"prevalence_{int(p * 100)}", seed, sample_per_drug, cycle=cycle)
    labels = read_labels(dataset["scenario"])
    scores = score_with_chaincode(dataset["events"], Path(work) / f"prevalence_{int(p * 100)}" / "scores.json")
    rows = classify(labels, scores)
    tp, fn, fp, tn = confusion(rows)
    flagged = tp + fp
    return {"prevalence_measured": (tp + fn) / len(rows), "n": len(rows), "tp": tp, "fp": fp, "fn": fn,
            "ppv": tp / flagged if flagged else float("nan"), "recall": tp / (tp + fn) if tp + fn else float("nan")}


def lot_split(tx):
    return int(hashlib.sha256(tx.encode()).hexdigest(), 16) % 100 < 70


def check_split(per_seed):
    train, test = [], []
    for s in per_seed:
        for r in s["rows"]:
            (train if lot_split(r["tx"]) else test).append(r)
    train_lots = {r["tx"] for r in train}
    test_lots = {r["tx"] for r in test}
    disjoint = not (train_lots & test_lots)
    tp, fn, fp, tn = confusion(test)
    p, rc, f1 = stats.precision_recall_f1(tp, fp, fn)
    detail = (f"split by lot (sha256 of the transaction id, 70/30): train={len(train)} test={len(test)}, disjoint={disjoint}. "
              f"Test only: TP={tp} FN={fn} FP={fp} TN={tn}; recall {stats.fmt_ci(tp, tp + fn)}; "
              f"FPR {stats.fmt_ci(fp, fp + tn)}; precision {stats.fmt_ci(tp, tp + fp)}; F1={f1:.4f}. "
              "No threshold is fitted by any code in this repository: scores and tolerances are hand-set (see limitations), "
              "so the split guards against future tuning and is not used to select anything")
    return result("16", "Train/test 70/30 split by lot; only the test partition is reported", disjoint and len(test) > 0, detail), \
        {"tp": tp, "fn": fn, "fp": fp, "tn": tn}


def make_worktree(ref, work):
    target = Path(work) / f"chaincode_{ref}"
    if not target.exists():
        subprocess.run(["git", "-C", str(ROOT), "worktree", "add", "--detach", str(target), ref], check=True,
                       capture_output=True, text=True)
        link = target / "epcis-fraud-logistic-diversion" / "node_modules"
        source = CHAINCODE_DIR / "node_modules"
        if source.exists() and not link.exists():
            link.symlink_to(source)
    return target / "epcis-fraud-logistic-diversion"


def check_mcnemar(per_seed, refs, work):
    first = per_seed[0]
    labels = {r["tx"]: r["positive"] for r in first["rows"]}
    details, passed = [], True
    comparisons = []
    for ref in refs:
        try:
            old = score_with_chaincode(first["events_path"], Path(work) / f"old_{ref}.json", make_worktree(ref, work))
        except Exception as error:
            details.append(f"{ref}: could not run ({str(error)[:120]})")
            passed = False
            continue
        old_only = new_only = 0
        for tx, positive in labels.items():
            old_ok = old[tx]["flagged"] == positive
            new_ok = first["chaincode"][tx]["flagged"] == positive
            old_only += old_ok and not new_ok
            new_only += new_ok and not old_ok
        outcome = stats.mcnemar_exact(new_only, old_only)
        old_acc = sum(old[tx]["flagged"] == p for tx, p in labels.items()) / len(labels)
        new_acc = sum(first["chaincode"][tx]["flagged"] == p for tx, p in labels.items()) / len(labels)
        comparisons.append({"ref": ref, "n": len(labels), "old_acc": old_acc, "new_acc": new_acc,
                            "new_only_correct": new_only, "old_only_correct": old_only,
                            "p_value": outcome["p_value"], "odds_ratio": outcome["odds_ratio"]})
        details.append(f"{ref} vs HEAD: new correct only={new_only}, old correct only={old_only}, exact McNemar p={outcome['p_value']:.3g}, "
                       f"odds ratio={outcome['odds_ratio']:.3g}, accuracy {old_acc:.4f} -> {new_acc:.4f}")
    return result("17", "McNemar (paired, exact) between an older rule version and HEAD", passed and bool(comparisons),
                  f"seed {first['seed']}, {len(labels)} paired transactions; " + "; ".join(details)), comparisons


def check_confusion_sums(per_seed, work):
    problems, checked = [], 0
    evaluator = ROOT / "epcis-fraud-logistic-diversion" / "evaluate_rules.js"
    json_paths = []
    for s in per_seed:
        tp, fn, fp, tn = confusion(s["rows"])
        checked += 1
        if tp + fn + fp + tn != len(s["labels"]):
            problems.append(f"own matrix seed {s['seed']}")
        out = Path(work) / f"evaluator_seed_{s['seed']}.json"
        run = subprocess.run(["node", str(evaluator), str(s["dir"]), "--json", str(out)], capture_output=True, text=True)
        if run.returncode != 0 or not out.exists():
            problems.append(f"evaluator failed seed {s['seed']}: {run.stderr[:100]}")
            continue
        data = json.loads(out.read_text())
        checked += 1
        cells = data["tp"] + data["fn"] + data["fp"] + data["tn"]
        if cells != len(s["labels"]) or sum(v["n"] for v in data["stats"].values()) != len(s["labels"]):
            problems.append(f"evaluator matrix seed {s['seed']}: cells={cells} transactions={len(s['labels'])}")
        if (data["tp"], data["fn"], data["fp"], data["tn"]) != confusion(s["rows"]):
            problems.append(f"evaluator vs independent scorer differ on seed {s['seed']}")
        json_paths.append(out)
    report = Path(work) / "generated_report.md"
    meta = Path(work) / "meta.json"
    meta.write_text("{}")
    pairs = [f"seed {i + 1}={p}" for i, p in enumerate(json_paths[:3])]
    run = subprocess.run(["python3", str(ROOT / "analysis_scripts" / "generate_report.py"), str(report), str(meta), *pairs],
                         capture_output=True, text=True)
    if run.returncode != 0:
        problems.append(f"generate_report.py failed: {run.stderr[-120:]}")
    else:
        import re
        text = report.read_text()
        for block in text.split("\n## ")[1:]:
            header = re.search(r"(\d+) transactions \(", block)
            cells = [int(x) for x in re.findall(r"(?:TP|FN|FP|TN) = (\d+)", block)]
            if header and len(cells) == 4:
                checked += 1
                if sum(cells) != int(header.group(1)):
                    problems.append(f"generated report section sums {sum(cells)} != {header.group(1)}")
    return result("18", "Confusion matrix cells sum to the number of transactions in every report", not problems,
                  f"{checked} matrices checked (own scorer, evaluate_rules.js JSON for every seed, generate_report.py sections); "
                  f"problems={problems[:3]}")
