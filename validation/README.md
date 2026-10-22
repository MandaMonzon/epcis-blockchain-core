# Validation

`make validate` runs items 1-18 and writes `validation/REPORT.md`
(`VALIDATE_ARGS="--seeds 30 --raw <arcos.gz>"`).

Item 19 (Fabric network vs local evaluator), on a fresh ledger:

    node validation/network_equivalence.js prepare <dataset dir> subset.json
    node validation/network_equivalence.js local subset.json local.json
    node validation/network_equivalence.js submit subset.json network.json
    node validation/network_equivalence.js compare local.json network.json
    make validate VALIDATE_ARGS="--network-results network.json"
