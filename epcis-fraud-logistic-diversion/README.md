# epcis-fraud-logistic-diversion

Smart contract for detecting **Logistics Diversion** in pharmaceutical supply chains.
Built on GS1 EPCIS 2.0 and Hyperledger Fabric.

## Architecture

```
EPCIS 2.0 Event (JSON)
        │
        ▼
  Class A Rules (blocking)
  └─ MandatoryFieldsRule    → rejects if required fields are missing
        │ passes
        ▼
  Ledger write (immutable)
        │
        ▼
  Class B Rules (risk scoring, score 0–100)
  ├─ LogisticsDiversionRule     → sequence violations, timing, jurisdiction, blocked status
  ├─ SupplyBaseComplexityRule   → too many suppliers per pharmacy (Skilton et al. 2024)
  └─ VolumeFragmentationRule    → fragmented orders from same source in 30-day window
```

## Class B Score Table

| Rule | Condition | Score |
|---|---|---|
| LogisticsDiversionRule | Blocked disposition in transit | +90 |
| LogisticsDiversionRule | Invalid bizStep sequence | +75 |
| LogisticsDiversionRule | Cross-jurisdiction at wrong step | +80 |
| LogisticsDiversionRule | Out-of-order event time | +60 |
| SupplyBaseComplexityRule | ≥ 9 suppliers (99th percentile) | +85 |
| SupplyBaseComplexityRule | 6–8 suppliers | +60 |
| SupplyBaseComplexityRule | 4–5 suppliers | +30 |
| VolumeFragmentationRule | ≥ 20 orders / 30 days | +40 |
| VolumeFragmentationRule | ≥ 10 orders / 30 days | +20 |

Final score is clamped to **[0, 100]**.

## Run tests

```bash
npm install
npm test
```

## References

- Vanin et al. (2026) — Logistics Diversion taxonomy
- Skilton et al. (2024) — Supply base attributes and diversion risk. DOI: 10.1002/joom.1335
- GS1 EPCIS 2.0 — https://ref.gs1.org/standards/epcis
