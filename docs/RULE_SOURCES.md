# Rule sources and parameters

Derived from `chaincode/constants/RiskScoreConfig.js` and `RuleThresholdsConfig.js`. Nothing here was tuned against the results.

Status: **Sourced** = the number comes from a cited source. **Mapped** = the score is placed on the FDA recall scale by judgment. **Parameter** = no published source; configurable and declared as a limitation.

| Rule (code) | Class | Score | Condition | Source | Status |
|---|---|---|---|---|---|
| MandatoryFieldsRule (`MISSING_FIELD`) | A | rejects | required field missing | EPCIS 2.0 / GS1 schema | Sourced |
| LogisticsDiversionRule `BLOCKED_DISPOSITION` / `BLOCKED_STATUS` | B | 85 | recalled/expired/damaged product moves | FDA 21 CFR §7.41 Class I | Mapped |
| LogisticsDiversionRule `INVALID_SEQUENCE` | B | 60 | shipped without commissioning | EU 2016/161 Art. 36; FDA Class II | Mapped |
| LogisticsDiversionRule `CROSS_JURISDICTION` | B | 75 | cross-jurisdiction at an unauthorized bizStep | DSCSA 21 USC §360eee (suspect product) | Parameter. 75 sits between Class II (60) and Class I (85); no source fixes it |
| LogisticsDiversionRule `OUT_OF_ORDER` | B | 30 | timestamp earlier than the previous event | FDA Class III | Mapped |
| LifecycleSequenceRule (`SKIPPED_LIFECYCLE_STEP`) | B | 75 | lifecycle step skipped | none | Parameter |
| TransitDiversionRule (`TRANSIT_DIVERSION`) | B | 85 | received at a location other than the declared destination | DSCSA; EU FMD Art. 35; FDA Class I | Mapped |
| TransitTimeRule (`IMPOSSIBLE_TRANSIT_TIME`) | B | 85 (reuses `TRANSIT_DIVERSION`) | received less than 3 days after shipping | none | Parameter (`MIN_TRANSIT_DAYS = 3`) |
| LotContaminationRule (`LOT_CONTAMINATION`) | B | 60 | another unit of a flagged lot | DSCSA 21 USC §360eee-1(c) (quarantine of the whole transaction) | Score: mapped. The 70 filter: parameter |
| QuantityMismatchRule (`QUANTITY_MISMATCH`) | B | 75 | loss rate above 10% | DSCSA §360eee-1(b)(1)(D) for the rule | Score: parameter. Tolerance 10%: **no source** (literature suggests 0.5 to 1%) |
| ShipmentReceiptMismatchRule (`SHIPMENT_RECEIPT_MISMATCH`) | B | 70 | no `recadv` after 30 days | DSCSA §360eee-1(c)(1) for the rule | Score: parameter. 30 days: **no source** |
| SupplyBaseComplexityRule (`SUPPLY_BASE_COMPLEXITY`) | B | 30 / 60 / 85 | 4–5 / 6–8 / ≥9 distinct suppliers | Skilton et al. 2024 (mean 3.12, SD 1.44, p99 ≈ 9) | Sourced for the thresholds. The mapping to scores is mapped |
| VolumeFragmentationRule (`VOLUME_FRAGMENTATION`) | B | 30 / 60 | ≥10 / ≥20 orders from the same source in 30 days | DEA SORS (21 CFR §1301.74(b)) confirms the pattern, not the numbers | Parameter. The robust multiplier (2× the median) is also a rule of thumb |

## Notes

- The flag threshold (70) and the per-drug SLA (90%) are decisions of the research team, not values from the literature.
- The 90% SLA is a rate per drug, not a score.
- The score is the MAX over the Class B rules that fire.
- Items marked **no source** must be reported as limitations. They must not be tuned until more transactions pass.
