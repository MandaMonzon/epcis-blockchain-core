# epcis-fraud-logistic-diversion

Smart contract for detecting **Logistics Diversion** in pharmaceutical supply chains.
Built on GS1 EPCIS 2.0 and Hyperledger Fabric.

## Architecture

```
EPCIS 2.0 Event (JSON)
        |
        v
  Class A (blocking)
  +- MandatoryFieldsRule         -> rejects if required fields are missing
        | passes
        v
  Class B (risk scoring, 0-100): event is accepted, stored, and flagged
  +- LogisticsDiversionRule      -> invalid sequence, timing, jurisdiction
  +- SupplyBaseComplexityRule    -> many distinct suppliers per buyer (Skilton et al. 2024)
  +- VolumeFragmentationRule     -> fragmented orders from one source in 30 days
  +- QuantityMismatchRule     -> packed count != received count
  +- ShipmentReceiptMismatchRule -> despatch advice without receiving advice (needs audit call)
  +- TransitDiversionRule        -> received at a location other than the declared destination
  +- TransitTimeRule             -> physically impossible transit time
  +- LifecycleSequenceRule       -> received without commissioning/packing/shipping
  +- LotContaminationRule        -> propagates lot risk (runs last)
```

**Score = highest score among the rules that fired** (MAX strategy), clamped to [0, 100].
Detection threshold used in the experiments: **score >= 70**.

**`disposition` (recalled / destroyed / expired) is metadata, not diversion evidence.**
It no longer raises a score (reviewed by Fausto, Oct 2026). `recalled` is a negative control.

## Scores

All values live in `chaincode/constants/RiskScoreConfig.js` and `RuleThresholdsConfig.js`.

| Rule | Condition | Score |
|---|---|---|
| LogisticsDiversionRule | Invalid bizStep sequence | 60 |
| LogisticsDiversionRule | Cross-jurisdiction at wrong step | 60 |
| LogisticsDiversionRule | Out-of-order event time | 30 |
| LifecycleSequenceRule | Received without earlier lifecycle step | 75 |
| SupplyBaseComplexityRule | >= 9 / 6-8 / 4-5 suppliers | 85 / 60 / 30 |
| VolumeFragmentationRule | high / elevated fragmentation | 60 / 30 |
| QuantityMismatchRule | Packed != received | 75 |
| ShipmentReceiptMismatchRule | No receiving confirmation after 30 days | 70 |
| TransitDiversionRule | Received at undeclared location | 85 |
| LotContaminationRule | Lot already contaminated | 60 |

## Reproducing the results

```bash
npm install
npm test                               # unit tests + one fixture per anomaly type
./verificar_regras.sh                  # readable table: which anomaly types are detected
node evaluate_rules.js <dataset_dir>   # per-transaction precision / recall on a generated dataset
```

`<dataset_dir>` holds `events.json` and `scenario_template.csv` produced by
`epcis-arcos-etl-generator`. Each transaction is replayed on a fresh ledger and flagged if its
maximum score is >= 70. `recalled` and `none` count as negatives.

The report pipeline (Excel / Word numbers) is in `../analysis_scripts/` (see its `README_PACOTE.md`).

## Known limitations

- Scores below were measured on synthetic data with all lots replayed on ONE shared ledger
  (`validation/shared_ledger_scores.js`): recall is 100% for every anomaly type when events are
  replayed in time order. With file order, `item_location_mismatch` drops to 11% (it needs the
  earlier commissioning event), so arrival order matters.
- False positives on clean lots are 6.6% (time order), all from `SUPPLY_BASE_COMPLEXITY`: a buyer
  that accumulates 9 or more distinct suppliers is flagged at buyer level, so clean lots at that buyer
  are flagged too. This is the rule's design (Skilton 2024), not a lot-level error.
- The generated datasets inject about 71-77% anomalous transactions by construction. The figures measure
  detection against injected labels, not real-world fraud prevalence.

## References

- Vanin et al. (2026) — Logistics Diversion taxonomy
- Skilton et al. (2024) — Supply base attributes and diversion risk. DOI: 10.1002/joom.1335
- GS1 EPCIS 2.0 — https://ref.gs1.org/standards/epcis
