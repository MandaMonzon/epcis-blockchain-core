"""Builds REPORT.md from the JSON files written by evaluate_rules.js.

Usage: python3 generate_report.py <output.md> <meta.json> <title=result.json> [...]
Each title=result.json pair becomes one section.
"""
import json
import math
import sys

NEGATIVES = {'none', 'recalled'}


def wilson_interval(k, n, z=1.96):
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def rate(k, n):
    if n == 0:
        return 'n/a'
    low, high = wilson_interval(k, n)
    return f'{100 * k / n:.1f}% ({k}/{n}; 95% CI {100 * low:.1f}-{100 * high:.1f}%)'


def section(title, r):
    tp, fn, fp, tn = r['tp'], r['fn'], r['fp'], r['tn']
    positives, negatives = tp + fn, fp + tn
    lines = [
        f'## {title}', '',
        f"Dataset `{r['dataset']}` | threshold: score >= {r['threshold']} | "
        f'{positives + negatives} transactions ({positives} anomalous, {negatives} normal) | '
        f'anomaly prevalence: {100 * positives / (positives + negatives):.2f}%', '',
        '| | Predicted anomalous | Predicted normal |', '|---|---|---|',
        f'| **Actually anomalous** | TP = {tp} | FN = {fn} |',
        f'| **Actually normal** | FP = {fp} | TN = {tn} |', '',
        f'- Recall: {rate(tp, positives)}',
        f'- False positive rate: {rate(fp, negatives)}',
        f'- Specificity: {rate(tn, negatives)}',
        f'- Precision: {rate(tp, tp + fp)}', '',
        '| Type | Transactions | Flagged | Rate (95% CI) |', '|---|---|---|---|',
    ]
    for kind, s in sorted(r['stats'].items()):
        label = kind + (' (negative control)' if kind in NEGATIVES else '')
        lines.append(f"| {label} | {s['n']} | {s['flagged']} | {rate(s['flagged'], s['n'])} |")
    lines.append('')
    if r['causes']:
        lines += ['Errors by cause:', '']
        lines += [f'- {n}x {cause}' for cause, n in sorted(r['causes'].items(), key=lambda x: -x[1])]
        lines.append('')
    return lines


METHOD = [
    '## 1. Method', '',
    'Each transaction of the synthetic dataset is replayed in isolation (fresh ledger), with events in '
    'chronological order, through the chaincode `RuleEngine`. A transaction is flagged when any event '
    'reaches the threshold score; the periodic audit of shipments without receiving also runs. '
    'Ground truth comes from the `anomaly_type` column of `scenario_template.csv`; `none` and '
    '`recalled` are negative controls. Intervals are Wilson 95%.', '',
]

REVIEW = [
    '## Review concerns and how this report addresses them', '',
    '- **Repository vs results**: the metadata records the core commit, generator commit, events '
    'SHA-256, sampling seed and tool versions; `make all` rebuilds everything from scratch.',
    '- **Almost every drug flagged**: rates are reported per anomaly type and for the negative '
    'controls (`none`, `recalled`) with confidence intervals, instead of one aggregate rate.',
    '- **False positives**: measured per isolated transaction, and also on a sample with ~1% '
    'anomaly prevalence (closer to a realistic regime).',
    '- This evaluation does not replace validation on real labeled data.', '',
]

LIMITATIONS = [
    '## Limitations', '',
    '- The data is **synthetic**: anomalies are injected by a generator from real ARCOS (DEA) '
    'transactions. Rules and generator were tuned together, so recall and precision measure '
    'consistency between the two, **not** performance on real data.',
    '- Each anomaly type follows a deterministic pattern; a 100% rate does not imply robustness to '
    'real fraud, which varies more.',
    '- Evaluation is per isolated transaction; interactions through shared ledger state are only '
    'exercised in the load test (Caliper).',
    '- The load test measures performance (TPS, latency), not detection accuracy.', '',
]


def main():
    destination, meta_path, *pairs = sys.argv[1:]
    with open(meta_path) as f:
        meta = json.load(f)
    lines = ['# Detection rule evaluation report (EPCIS / Hyperledger Fabric)', '', *METHOD,
             '## 2. Reproducibility', '', *[f'- {k}: `{v}`' for k, v in meta.items()], '']
    for i, pair in enumerate(pairs):
        title, path = pair.split('=', 1)
        with open(path) as f:
            lines += section(f'{i + 3}. {title}', json.load(f))
    lines += REVIEW + LIMITATIONS
    with open(destination, 'w') as f:
        f.write('\n'.join(lines))
    print('written', destination)


main()
