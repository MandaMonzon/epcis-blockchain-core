# Validation

`make validate` runs items 1-18 and writes `validation/REPORT.md`
(`VALIDATE_ARGS="--seeds 30 --raw <arcos.gz>"`).

On the real ARCOS use a random sample, not `--limit` (which only reads the first rows):
`VALIDATE_ARGS="--seeds 30 --raw <arcos.gz> --sample-rows 300000 --sample-seed 1"`. The report states the
sample design (stratified by drug with a floor, or `--sample-design simple`), size and representativeness against the population.

Item 19 (Fabric network vs local evaluator), on a fresh ledger:

    node validation/network_equivalence.js prepare <dataset dir> subset.json
    node validation/network_equivalence.js local subset.json local.json
    node validation/network_equivalence.js submit subset.json network.json
    node validation/network_equivalence.js compare local.json network.json
    make validate VALIDATE_ARGS="--network-results network.json"

One command (wipes the test-network ledger; refuses without `CONFIRM_WIPE=yes`):

    CONFIRM_WIPE=yes scripts/network_equivalence.sh <dataset dir with events.json and scenario_template.csv>
