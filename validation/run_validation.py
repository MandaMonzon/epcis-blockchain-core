"""Runs the validation suite (items A-F) and writes validation/REPORT.md.

Usage: python3 -m validation.run_validation [--seeds 30] [--raw arcos_raw.gz] [--limit N | --sample-rows N --sample-seed S] [--work DIR]
"""
import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

from . import checks_data as data
from . import checks_meta as meta
from . import checks_schema as schema_check
from . import checks_stats as st
from . import per_drug_sla
from . import stats
from .pipeline_runner import (GENERATOR, ROOT, build_dataset, extract_clean, group_events, load_events, read_labels,
                              score_with_chaincode, score_with_oracle, transaction_of as transaction_of_event)
from .synthetic_raw import write_synthetic_raw

sys.path.insert(0, str(GENERATOR))
from pipeline.transform import ANOMALY_CYCLE  # noqa: E402


def git_head(path):
    try:
        return subprocess.run(["git", "-C", str(path), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def aggregate(item, name, results):
    failed = [r for r in results if not r["passed"]]
    detail = f"{len(results) - len(failed)}/{len(results)} seeds pass. Seed 1: {results[0]['detail']}"
    if failed:
        detail += f" FIRST FAILURE: {failed[0]['detail']}"
    return data.result(item, name, not failed, detail)


def build_seed(seed, clean_csv, work, sample_per_drug):
    out = Path(work) / f"seed_{seed}"
    dataset = build_dataset(clean_csv, out, seed, sample_per_drug)
    events = load_events(dataset["events"])
    labels = read_labels(dataset["scenario"])
    chaincode = score_with_chaincode(dataset["events"], out / "chaincode_scores.json")
    oracle = score_with_oracle(dataset["events"], out / "oracle_scores.json")
    rows = st.classify(labels, chaincode)
    per_drug = per_drug_sla.per_drug_table(rows, per_drug_sla.read_drugs(dataset["scenario"]))
    per_drug_sla.write_tsv(per_drug, out / "per_drug_sla.tsv")
    return {"seed": seed, "dir": out, "dataset": dataset, "events_path": dataset["events"], "events": events,
            "labels": labels, "chaincode": chaincode, "oracle": oracle, "rows": rows, "per_drug": per_drug}


def network_equivalence(per_seed, work, network_results):
    script = ROOT / "validation" / "network_equivalence.js"
    first = per_seed[0]
    subset, local_file = Path(work) / "network_subset.json", Path(work) / "network_local.json"
    for command in (["prepare", str(first["dir"]), str(subset), "--per-type", "5"], ["local", str(subset), str(local_file)]):
        run = subprocess.run(["node", str(script), *command], capture_output=True, text=True)
        if run.returncode:
            return data.result("19", "Fabric network vs local evaluator: identical scores per transaction", False,
                               f"local harness failed: {run.stderr[-200:]}")
    local = json.loads(local_file.read_text())
    isolated_max = {}
    transaction_of = {e["eventID"]: transaction_of_event(e) for e in json.loads(subset.read_text())["events"]}
    for record in local["isolated"]:
        tx = transaction_of[record["eventID"]]
        isolated_max[tx] = max(isolated_max.get(tx, 0), record["riskScore"])
    scorer = {tx: max([v["score"] for e in s["events"] for v in e["violations"]] or [0]) for tx, s in first["chaincode"].items()
              if tx in isolated_max}
    entry_mismatch = [tx for tx in scorer if scorer[tx] != isolated_max[tx]]
    harness = (f"harness checked locally: contract.submitEvent on an isolated ledger vs the scoring tool, "
               f"{len(scorer)} transactions, score mismatches={len(entry_mismatch)}")
    if not network_results:
        return data.result("19", "Fabric network vs local evaluator: identical scores per transaction", False,
                           f"NOT RUN: needs the Fabric network (node003). {harness}. Run: see validation/README.md"), harness
    run = subprocess.run(["node", str(script), "compare", str(local_file), str(network_results)], capture_output=True, text=True)
    return data.result("19", "Fabric network vs local evaluator: identical scores per transaction",
                       run.returncode == 0 and not entry_mismatch, f"{run.stdout.strip()} | {harness}"), harness


def pct(x):
    return f"{100 * x:.1f}%"


def write_report(path, header, results, rows, matrix, ppv_table, prevalence_runs, split, mcnemar, per_seed, harness):
    lines = ["# Validation report", "", *header, "", "## Criteria", "",
             "| # | Criterion | Result | Evidence |", "|---|-----------|--------|----------|"]
    for r in sorted(results, key=lambda r: int(r["item"])):
        status = "PASS" if r["passed"] else ("NOT RUN" if r["detail"].startswith("NOT RUN") else "FAIL")
        lines.append(f"| {r['item']} | {r['name']} | {status} | {r['detail'].replace('|', '/')} |")
    lines += ["", "## Detection by anomaly type (item 14)", "",
              f"{len(per_seed)} seeds; one dataset per seed. Pooled values with Wilson 95% CI; the last columns are mean ± sd across seeds. "
              "Precision of a type = TP of the type / (TP of the type + false positives on normal lots), since false positives have no type.", "",
              "| Type | Lots | Recall (Wilson 95%) | Precision (Wilson 95%) | F1 | Recall mean±sd | Precision mean±sd | F1 mean±sd |",
              "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['type']} | {r['n']} | {pct(r['recall'])} [{pct(r['recall_ci'][0])}, {pct(r['recall_ci'][1])}] | "
                     f"{pct(r['precision'])} [{pct(r['precision_ci'][0])}, {pct(r['precision_ci'][1])}] | {r['f1']:.4f} | "
                     f"{r['recall_seed'][0]:.4f}±{r['recall_seed'][1]:.4f} | {r['precision_seed'][0]:.4f}±{r['precision_seed'][1]:.4f} | "
                     f"{r['f1_seed'][0]:.4f}±{r['f1_seed'][1]:.4f} |")
    pooled_rows, (tp, fn, fp, tn) = st.pooled(per_seed)
    p, rc, f1 = stats.precision_recall_f1(tp, fp, fn)
    lines += ["", f"Pooled over all seeds: TP={tp} FN={fn} FP={fp} TN={tn} (sum {tp + fn + fp + tn} = {len(pooled_rows)} transactions). "
              f"Recall {stats.fmt_ci(tp, tp + fn)}; FPR {stats.fmt_ci(fp, fp + tn)}; precision {stats.fmt_ci(tp, tp + fp)}; F1 {f1:.4f}. "
              "The dataset prevalence is about 71% by construction (10 of 14 cycle positions), `recalled` lots are normal.", ""]
    lines += ["## Drugs passing the 90% cut-off, per round", "",
              "A drug passes a round when at least 90% of its anomalous transactions are flagged (score >= 70). Each seed is one round. "
              "`Wilson lower >= 90%` is the stricter reading: the 95% interval of the drug's detection rate stays above the cut-off. "
              "Drugs without anomalous transactions are not evaluable. False positives per drug are in `per_drug_sla.tsv` of each seed.", ""]
    lines += per_drug_sla.rounds_summary([(f"seed {s['seed']}", s["per_drug"]) for s in per_seed])
    lines += [""]
    lines += ["## PPV by prevalence (item 15)", "",
              "PPV = recall·p / (recall·p + FPR·(1−p)). `Lower bound` uses the upper Wilson limit of the FPR. "
              "`Resampled` is the mean PPV over 300 datasets of 1000 lots drawn from the pooled lots at prevalence p. "
              "`Regenerated` is one real generator run at that prevalence.", "",
              "| Prevalence | Bayes PPV | Bayes lower bound | Resampled mean (min) | Regenerated (n, anomalous, TP, FP, PPV) |", "|---|---|---|---|---|"]
    for t in ppv_table:
        real = t["real"]
        lines.append(f"| {pct(t['prevalence'])} | {t['bayes']:.4f} | {t['bayes_lower']:.4f} | {t['resampled']:.4f} ({t['resampled_min']:.4f}) | "
                     f"{real['n']}, {round(real['prevalence_measured'] * real['n'])}, {real['tp']}, {real['fp']}, {real['ppv']:.4f} |")
    lines += ["", "## Train/test split by lot (item 16)", "",
              f"Test partition (30% of lots): TP={split['tp']} FN={split['fn']} FP={split['fp']} TN={split['tn']}.", ""]
    lines += ["## Version comparison (item 17)", "",
              "| Older version | Paired lots | Accuracy old → HEAD | HEAD right only | Old right only | McNemar exact p | Odds ratio |", "|---|---|---|---|---|---|---|"]
    for c in mcnemar:
        lines.append(f"| `{c['ref']}` | {c['n']} | {c['old_acc']:.4f} → {c['new_acc']:.4f} | {c['new_only_correct']} | "
                     f"{c['old_only_correct']} | {c['p_value']:.3g} | {c['odds_ratio']:.3g} |")
    lines += ["", "Effect size: odds ratio of the discordant pairs (HEAD right only / old right only). Lots of one seed are paired; "
              "lots across seeds share raw rows, so only seed 1 is used.", "",
              "## Mutation matrix (item 7)", "", "Codes fired on 20 normal lots per mutation (chaincode, one mutation per lot):", ""]
    lines += [f"- {line}" for line in matrix["lines"]]
    lines += ["", "`LOT_CONTAMINATION` and `LOGISTICS_DIVERSION_SEQUENCE` (60) co-fire below the 70 threshold on several mutations; "
              "they never decide a flag.", "", "## Oracle divergences (item 9)", "",
              "See `validation/DIVERGENCES.md` (every divergence with its cause).", "",
              "## Network equivalence (item 19)", "", f"{harness}", "",
              "## Limitations", ""]
    lines += [f"- {x}" for x in LIMITATIONS]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


LIMITATIONS = [
    "The data is synthetic: anomalies are injected by the generator from ARCOS rows. Perfect recall measures agreement between "
    "generator and rules, not detection of real fraud. Prevalence of about 71% is an artefact of the cycle.",
    "Rules, generator and docs were developed on one ARCOS sample, so seeds 1-30 are not an independent hold-out; "
    "the seed changes the anomaly assignment and sampling, not the underlying raw data.",
    "The oracle was written from the documentation but by the same project; the two share the documented interpretation. "
    "Ambiguities resolved in the docs (supplier identity) make the oracle depend on those decisions.",
    "`LOT_CONTAMINATION`, `LOGISTICS_DIVERSION_SEQUENCE` and `VOLUME_FRAGMENTATION` have no documented condition the oracle can "
    "reproduce; they score below 70, except fragmentation, which needs >= 10 orders of one buyer in 30 days and is not generated.",
    "Scores (30-90), the 70 threshold, the 10% quantity tolerance and the 3-day minimum transit are hand-set; none is fitted on data.",
    "The chaincode reports only the worst failure of the logistics rule per event, so per-event code attribution differs from the oracle; "
    "only the transaction flag is compared for equality.",
    "Events with the same timestamp are processed in arrival order; the set of low-score codes can depend on it (item 10), the flag and score do not.",
    "Evaluation is per isolated transaction. Cross-transaction state (supplier accumulation, fragmentation, audit) only appears on the network (item 19).",
    "OpenEPCIS / GS1 schema validation of the events is not part of this suite (see docs/ARCOS_DATA_AUDIT.md for the known sgln:us.dea issue).",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=30)
    parser.add_argument("--raw")
    parser.add_argument("--limit", type=int, help="first N rows of the raw file (NOT a random sample)")
    parser.add_argument("--sample-rows", type=int, help="uniform random sample of N valid rows over the whole raw file")
    parser.add_argument("--epcis-schema", help="local copy of the GS1 EPCIS-JSON-Schema.json (downloaded when omitted)")
    parser.add_argument("--sample-seed", type=int, default=0)
    parser.add_argument("--sample-design", choices=("stratified", "simple"), default="stratified")
    parser.add_argument("--sample-per-drug", type=int, default=10)
    parser.add_argument("--work", default=str(ROOT / "validation" / "work"))
    parser.add_argument("--old-refs", nargs="*", default=["200fabf", "ba67b09"])
    parser.add_argument("--network-results")
    parser.add_argument("--report", default=str(ROOT / "validation" / "REPORT.md"))
    args = parser.parse_args()
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    started = time.time()

    if args.raw:
        raw, source = Path(args.raw), f"real ARCOS file `{Path(args.raw).name}`"
    else:
        raw = work / "synthetic_raw.gz"
        injected = write_synthetic_raw(raw)
        source = f"synthetic ARCOS-like file (known defects injected: {injected})"
    clean_csv, extract_result = extract_clean(raw, work, limit=args.limit, sample_rows=args.sample_rows, seed=args.sample_seed, design=args.sample_design)
    if "representativeness" in extract_result:
        rep = extract_result["representativeness"]
        if extract_result["sampling_design"] == "stratified":
            fit = (f"stratified by drug (floor {rep['drug']['min_per_stratum']}; {rep['drug']['strata']} drugs, "
                   f"{rep['drug']['taken_whole']} taken whole); weighted year total variation vs population "
                   f"{rep['year']['total_variation']:.4f}")
        else:
            fit = (f"simple random; chi-square vs population: year p={rep['year']['p_value']:.3g} "
                   f"(TV={rep['year']['total_variation']:.4f}), drug p={rep['drug']['p_value']:.3g}")
        source += (f"; random sample of {extract_result['converted']:,} of {extract_result['population_valid']:,} valid rows "
                   f"(seed {extract_result['sample_seed']}), {fit}")
    elif args.limit:
        source += f"; FIRST {args.limit:,} rows of the file (head sample, not random)"
    print(f"extract: {extract_result['converted']} converted of {extract_result['rows_read']} rows", flush=True)

    per_seed = []
    cap = 10
    per_check = {"1": [], "2": [], "3": [], "4": [], "6": []}
    for seed in range(1, args.seeds + 1):
        s = build_seed(seed, clean_csv, work, args.sample_per_drug)
        groups = group_events(s["events"])
        per_check["1"].append(data.check_unique_ids_and_quantities(s["events"], s["dataset"]["scenario"]))
        per_check["2"].append(data.check_date_order(groups, s["labels"]))
        per_check["3"].append(data.check_conservation(groups, s["labels"], s["dataset"]["scenario"], cap))
        per_check["4"].append(data.check_accounting(raw, extract_result, s["dataset"], s["events"]))
        per_check["6"].append(data.check_ground_truth(groups, s["labels"], ANOMALY_CYCLE, s["seed"]))
        del groups
        if seed != 1:
            s["events"] = None
        per_seed.append(s)
        print(f"seed {seed}/{args.seeds} done", flush=True)

    results = []
    for item, rs in per_check.items():
        results.append(aggregate(item, rs[0]["name"], rs))
    first = per_seed[0]
    results.append(data.check_determinism(clean_csv, work, 1, args.sample_per_drug, first["dataset"]))

    mutation_result, matrix = meta.check_mutation_matrix(group_events(first["events"]), first["labels"], work)
    results.append(mutation_result)
    results.append(st.check_oracle(per_seed))

    base = first["chaincode"]
    results.append(meta.check_shuffle(first["events"], base, work))
    results.append(meta.check_rename(first["events"], base, work))
    results.append(meta.check_scale(clean_csv, work, 1, args.sample_per_drug, base))
    results.append(meta.check_all_normal(clean_csv, work, 1, args.sample_per_drug))

    stat_result, rows = st.check_statistics(per_seed)
    results.append(stat_result)
    prevalence_runs = {p: st.run_prevalence_dataset(clean_csv, work, p, args.sample_per_drug) for p in (0.01, 0.05, 0.10)}
    ppv_result, ppv_table = st.check_ppv(per_seed, prevalence_runs)
    results.append(ppv_result)
    split_result, split = st.check_split(per_seed)
    results.append(split_result)
    mcnemar_result, mcnemar = st.check_mcnemar(per_seed, args.old_refs, work)
    results.append(mcnemar_result)
    results.append(st.check_confusion_sums(per_seed, work))
    network_result, harness = network_equivalence(per_seed, work, args.network_results)
    results.append(network_result)
    results.append(schema_check.check_epcis_schema(per_seed[0]["events_path"], work, args.epcis_schema))

    header = [f"- Generated: {time.strftime('%Y-%m-%d %H:%M:%S')} (run time {time.time() - started:.0f}s)",
              f"- Core commit: `{git_head(ROOT)}`; generator commit: `{git_head(GENERATOR)}`",
              f"- Input: {source}; {extract_result['rows_read']} rows read, {extract_result['converted']} usable",
              f"- Seeds: 1-{args.seeds}; sample per drug {args.sample_per_drug}",
              f"- Python {platform.python_version()}, node {subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip()}",
              f"- Summary: {sum(r['passed'] for r in results)} of {len(results)} criteria pass"]
    write_report(args.report, header, results, rows, matrix, ppv_table, prevalence_runs, split, mcnemar, per_seed, harness)
    (work / "results.json").write_text(json.dumps(results, indent=1, default=str))
    print(f"report written to {args.report}")
    failed = [r for r in results if not r["passed"]]
    for r in failed:
        print(f"item {r['item']}: {r['name']} -> {r['detail'][:200]}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
