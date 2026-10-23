# Validation

`make validate` runs items 1-20 and writes `validation/REPORT.md`
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

Item 20 validates `events.json` against the official GS1 EPCIS 2.0 JSON Schema. It needs `pip install jsonschema` and
the schema (downloaded from github.com/gs1/EPCIS, or `--epcis-schema <file>`); without them it reports NOT RUN.
