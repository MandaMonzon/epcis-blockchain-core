# Business rules and test scenarios

This document describes what the system must detect and how. Each scenario is an acceptance test
(Given/When/Then) and maps to an anomaly type produced by `epcis-arcos-etl-generator` and to a fixture in
`test/fixtures/anomalies.json`. The Portuguese version is `REGRAS_DE_NEGOCIO.md`.

**Detection threshold:** score >= 70. An event's score is the **maximum** over the Class B rules that fired.
Class A rules (mandatory fields) block the event.

## Normal lifecycle

Each unit (SGTIN) follows `commissioning -> packing -> shipping -> receiving`, shipped from the EU to a
US buyer (real ARCOS/DEA transactions).

## Scenarios

### 1. Normal transaction (`none`)
- **Given** a unit with the full lifecycle, in order and without deviations
- **When** the four events are processed
- **Then** no event reaches score 70

### 2. Recalled lot (`recalled`, negative control)
- **Given** a lot with a recall disposition but a normal logistics lifecycle
- **When** the events are processed
- **Then** it is not flagged: disposition is metadata, not a logistics anomaly

### 3. Skipped step (`skip_commission`)
- **Given** a unit that reaches `receiving` without `commissioning`
- **When** the receiving event is processed
- **Then** `SKIPPED_LIFECYCLE_STEP` (75) fires

### 4. Out of order (`out_of_order`)
- **Given** a `receiving` recorded before the `shipping` of the same unit
- **When** the events are processed in arrival order
- **Then** the sequence is invalid. Today `SKIPPED_LIFECYCLE_STEP` (75) decides; `OUT_OF_ORDER` scores 30 and never decides alone

### 5. Impossible transit (`impossible_transit`)
- **Given** a `receiving` less than `MIN_TRANSIT_DAYS` (3) days after `shipping`
- **When** the receiving is processed
- **Then** `IMPOSSIBLE_TRANSIT_TIME` (85) fires

### 6. Transit diversion (`transit_diversion`)
- **Given** a shipment whose declared destination is A but whose receiving is recorded at B
- **When** the receiving is processed
- **Then** `TRANSIT_DIVERSION` (85) fires

### 7. Jurisdiction (`jurisdiction`)
- **Given** an event whose source and destination are in different jurisdictions (EU and US) at a step that is not international transport (`shipping` and `receiving` are the allowed steps)
- **When** the event is processed
- **Then** `LOGISTICS_DIVERSION_JURISDICTION` (75) fires. GS1 prefixes 400-440 count as EU

### 8. Quantity mismatch (`quantity_mismatch`)
- **Given** a container packed with N units and unpacked with fewer than N * (1 - tolerance)
- **When** the `AggregationEvent DELETE` is processed
- **Then** `QUANTITY_MISMATCH` (75) fires. Current tolerance: 10% (no cited source; see open items)

### 9. Unconfirmed shipment (`shipment_receipt_mismatch`)
- **Given** a `desadv` (despatch advice) without a `recadv` (receiving advice)
- **When** the periodic audit runs more than `SHIPMENT_TRANSIT_DAYS_MAX` (30) days later
- **Then** `SHIPMENT_RECEIPT_MISMATCH` (70) fires

### 10. Many suppliers (`many_suppliers`)
- **Given** a buyer location whose `receiving`, `stocking` or `dispensing` events list 9 or more distinct parties in `sourceList` entries of type `possessing_party` or `owning_party` (accumulated over the events of that location; `location` entries are not parties) (99th percentile, Skilton et al. 2024)
- **When** the receiving is processed
- **Then** `SUPPLY_BASE_COMPLEXITY` (85) fires. Bands: 4-5 suppliers = 30, 6-8 = 60, 9 or more = 85

### 11. Item at the wrong location (`item_location_mismatch`)
- **Given** a unit commissioned at one location and received at another without having been shipped
- **When** the receiving is processed
- **Then** it is currently caught by `SKIPPED_LIFECYCLE_STEP` (75). There is no dedicated location rule

## Open items for the group

| # | Finding | Impact |
|---|---|---|
| 1 | DECIDED: no new rules. `out_of_order` already has its own code (`LOGISTICS_DIVERSION_TIMING`, score 30, tested) but it is masked by the sequence check when both fail, and the offline replay sorts events by time, so it can never appear there. `item_location_mismatch` is a unit with `receiving` and no prior `shipping`, which is exactly what `SKIPPED_LIFECYCLE_STEP` (75) detects. A new rule would duplicate it and need a score threshold with no source | Detected via `SKIPPED_LIFECYCLE_STEP`; labels are documented, not separate rules. Real ledger order (arrival order) is not reproduced by the offline replay |
| 2 | RESOLVED. `LOGISTICS_DIVERSION_SEQUENCE` fired on ~50% of normal transactions because the generator placed shipping before packing when commissioning and shipping fell on the same day (fixed: shipping is at least 3h after commissioning). `VOLUME_FRAGMENTATION` fired on ~84% because it counted one receiving event per unit; it now counts distinct orders (lot). Normal transactions now trigger no rule | Fragmentation needs cross-transaction history, so isolated replay never exercises it; it is covered by unit tests |
| 3 | Quantity tolerance of 10% and the 30-day window have no source; literature suggests 0.5-1% | Calibration, pending a decision |
| 4 | Synthetic data and ~70% prevalence | Metrics measure generator/rule consistency, not real performance |
