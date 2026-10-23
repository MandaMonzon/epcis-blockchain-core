# Oracle vs chaincode divergences

Dataset: 998 transactions (`d100_e1000_v3`). Oracle written from `docs/BUSINESS_RULES.md` only.

**Flag agreement (score >= 70): 998/998 (100%).**

| # | Divergence | Count | Cause | Resolution |
|---|-----------|-------|-------|------------|
| 1 | `SUPPLY_BASE_COMPLEXITY` fired only in the chaincode (71 flags) | 71 tx | Rule ambiguity + chaincode bug. The doc did not say how suppliers are identified. The chaincode counted every `sourceList` entry, including `location` entries, as a supplier. | Doc scenario 10 now defines suppliers as `possessing_party`/`owning_party` entries accumulated per buyer location. The chaincode now ignores other entry types (regression test added). Oracle updated from the doc only. Flags now agree. |
| 2 | `LOT_CONTAMINATION` (60) only in chaincode | 9109 events | Not implementable from the docs (the doc gives no detectable condition). Score 60 < threshold 70, so no flag impact. | Open: document the condition in the docs. |
| 3 | `LOGISTICS_DIVERSION_SEQUENCE` (60) only in chaincode | 736 events | Same as above; below threshold. | Open. |
| 4 | `SKIPPED_LIFECYCLE_STEP`, `IMPOSSIBLE_TRANSIT_TIME`, `TRANSIT_DIVERSION` only in oracle | 144 / 142 / 71 events | `LogisticsDiversionRule.evaluate` returns only the worst failure per event, the oracle lists every violated rule. The transaction flag is identical because the worst failure is always >= 70. | Reporting difference, not a bug. Flag-level comparison is the acceptance criterion. |

Names: the chaincode audit code `SHIPMENT_RECEIPT_MISMATCH_AUDIT` is mapped to the documented `SHIPMENT_RECEIPT_MISMATCH`.

Limitation: agreement is measured on the generator's data, which the generator and the docs share an author with. Real ARCOS-derived events outside the 11 scenarios are not covered.

## Chaincode bugs found by the other validation checks

| # | Check that found it | Bug | Fix |
|---|---------------------|-----|-----|
| 5 | Metamorphic rename (item 11) | `LogisticsDiversionRule.extractJurisdiction` matched `eu.`/`us.` anywhere in the id, so a DEA registrant such as `us.dea.EU7100642` was read as an EU party. | The jurisdiction now comes from the URN authority marker (`:sgln:eu.` / `:sgln:us.`) or the GS1 400-440 prefix. Regression test added. |
| 6 | Network equivalence harness (item 19) | `submitEvent` flattens `bizLocation`/`readPoint` to a string, but `TransitDiversionRule` and `QuantityMismatchRule` read `bizLocation.id`. On the network path `TRANSIT_DIVERSION` never fired. | New `util/locationId.js` accepts both shapes and is used by every rule that reads a location. `test/transitDiversion.test.js` fails on the old code and passes now. Earlier network results for transit_diversion are invalid. |

## Generator data loss found by the accounting check (item 4)

`extract.py` dropped every ARCOS row with a blank `order_form_no` (about 50% of real ARCOS), a silent sampling bias. Rows are now kept with a composite id, and `tests/test_extract.py` covers it.

## Renamed codes (old -> new)

| Old | New |
|---|---|
| `QUANTITY_DISCREPANCY` / `quantity_discrepancy` | `QUANTITY_MISMATCH` / `quantity_mismatch` |
| `SHIPMENT_DIVERGENCE` / `shipment_divergence` | `SHIPMENT_RECEIPT_MISMATCH` / `shipment_receipt_mismatch` |
| `SHIPMENT_DIVERGENCE_AUDIT` | `SHIPMENT_RECEIPT_MISMATCH_AUDIT` |
| `pendingShipmentDivergences` | `pendingShipmentMismatches` |
| `quantityDiscrepancyTolerancePct` | `quantityMismatchTolerancePct` |

`validation/signatures.py` `CODE_ALIASES` maps the old names so older rule versions still compare.
