# Oracle vs chaincode divergences

Dataset: 998 transactions (`d100_e1000_v3`). Oracle written from `docs/BUSINESS_RULES.md` only.

**Flag agreement (score >= 70): 998/998 (100%).**

| # | Divergence | Count | Cause | Resolution |
|---|-----------|-------|-------|------------|
| 1 | `SUPPLY_BASE_COMPLEXITY` fired only in the chaincode (71 flags) | 71 tx | Rule ambiguity + chaincode bug. The doc did not say how suppliers are identified. The chaincode counted every `sourceList` entry, including `location` entries, as a supplier. | Doc scenario 10 now defines suppliers as `possessing_party`/`owning_party` entries accumulated per buyer location. The chaincode now ignores other entry types (regression test added). Oracle updated from the doc only. Flags now agree. |
| 2 | `LOT_CONTAMINATION` (60) only in chaincode | 9109 events | Not implementable from the docs (the doc gives no detectable condition). Score 60 < threshold 70, so no flag impact. | Open: document the condition in the docs. |
| 3 | `LOGISTICS_DIVERSION_SEQUENCE` (60) only in chaincode | 736 events | Same as above; below threshold. | Open. |
| 4 | `SKIPPED_LIFECYCLE_STEP`, `IMPOSSIBLE_TRANSIT_TIME`, `TRANSIT_DIVERSION` only in oracle | 144 / 142 / 71 events | `LogisticsDiversionRule.evaluate` returns only the worst failure per event, the oracle lists every violated rule. The transaction flag is identical because the worst failure is always >= 70. | Reporting difference, not a bug. Flag-level comparison is the acceptance criterion. |

Names: the chaincode audit code `SHIPMENT_DIVERGENCE_AUDIT` is mapped to the documented `SHIPMENT_DIVERGENCE`.

Limitation: agreement is measured on the generator's data, which the generator and the docs share an author with. Real ARCOS-derived events outside the 11 scenarios are not covered.
