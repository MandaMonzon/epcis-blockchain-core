# Validation

`make validate` runs items 1-20 and writes `validation/REPORT.md`
(`VALIDATE_ARGS="--seeds 30 --raw <arcos.gz>"`).

On the real ARCOS use a random sample, not `--limit` (which only reads the first rows):
`VALIDATE_ARGS="--seeds 30 --raw <arcos.gz> --sample-rows 300000 --sample-seed 1"`. The report states the
sample design (stratified by drug with a floor, or `--sample-design simple`), size and representativeness against the population.

The full ARCOS file (about 40 GB compressed) takes hours to read in Python, so `scripts/overnight_node003.sh` first keeps
every 97th line (`THIN_EVERY`, systematic, `0` disables it) in `~/arcos_thin97.gz` and samples from that. The sample is
therefore drawn from a population already reduced to 1/97 of the rows: drugs with few rows lose rows and `--balanced` can
drop some, and the inclusion weights refer to the thinned population, not to the full file.

Item 19 (Fabric network vs local evaluator), on a fresh ledger:

    node validation/network_equivalence.js prepare <dataset dir> subset.json
    node validation/network_equivalence.js local subset.json local.json
    node validation/network_equivalence.js submit subset.json network.json
    node validation/network_equivalence.js compare local.json network.json
    make validate VALIDATE_ARGS="--network-results network.json"

One command (wipes the test-network ledger; refuses without `CONFIRM_WIPE=yes`):

    CONFIRM_WIPE=yes scripts/network_equivalence.sh <dataset dir with events.json and scenario_template.csv>

Item 20 validates `events.json` against the official GS1 EPCIS 2.0 JSON Schema. It needs `pip install jsonschema` and
the schema (downloaded from github.com/gs1/EPCIS, or `--epcis-schema <file>`); without them it reports NOT RUN.

## Per-drug SLA cut-off

The report has a section "Drugs passing the 90% cut-off, per round" and each seed writes `per_drug_sla.tsv`. A drug passes a round when at least 90% of its anomalous transactions are flagged (score >= 70); each seed is a round. False positives on the drug's normal lots are a separate column and never count as detection. A drug with `n` anomalous lots can only pass the stricter reading (Wilson 95% lower bound >= 90%) if `n` is about 35 or more, so raise `--sample-per-drug` accordingly (at 10 lots per drug a drug has about 7-8 anomalous lots and the lower bound caps at 0.68). Standalone: `python3 -m validation.per_drug_sla scenario_template.csv chaincode_scores.json --out table.tsv`.

## Unattended node003 run

`scripts/overnight_node003.sh --start-at 10:00` runs the layers in order (generator, EPCIS events and the GS1 schema, contract, network) and always writes `~/overnight_<date>/SUMMARY.md`.
The network layer only starts when no Caliper/benchmark process has been seen for 3 consecutive checks (10 min apart, up to `--network-deadline-hours`, default 6).
It then runs `scripts/fabric_preflight.sh` (docker, disk, Fabric binaries, images, ports; pulls missing images and builds the Caliper image, never prunes), retries `down/up/deployCC` up to 3 times with container log diagnostics, runs item 19, and finishes with `scripts/caliper_smoke.sh` (5 transactions per Caliper round).
