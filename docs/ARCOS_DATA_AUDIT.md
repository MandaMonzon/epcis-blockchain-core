# ARCOS data audit

Run `make audit` to audit `arcos_clean.csv` (the extractor output). The script is
`analysis_scripts/audit_arcos.py`; it checks ids, DEA numbers, NDC codes, dates and quantities.

## Findings (sample of 1000 transactions; full-file audit pending on node003)

| Finding | Evidence | Handling |
|---|---|---|
| About 50% of raw ARCOS rows have no `transaction_id` (blank form field) | Known from the raw file; the sample shows 0 because the generator fills a composite key | Composite key `reporter\|buyer\|date\|drug` |
| `transaction_id` repeated across rows (0.4% of the sample) | `14319.0` and `111.0` appear twice | Fixed in the generator (commit `87dd139`): repeated ids get a unique suffix. Before the fix, two lots shared SGTINs, mixed ledger state and produced false positives |
| `buyer_id` not in DEA format (0.4%) | `B92628393` (1 letter + 8 digits) | Treated as an opaque string; no rule depends on its format |
| Non-integer `dosage_unit` (0.2%) | `22.98`, `7.98` | Truncated to an integer lot size |
| Quantities are capped per lot | Median 100 units, p99 15000, but lots are capped at 10 units (`--max-units-per-lot`) | Limitation: lot-size effects are not represented |
| Non-standard EPC URNs | The generator builds `urn:epc:id:sgln:us.dea.<DEA>.0.0`, which is not a valid GS1 SGLN (company prefix must be numeric) | Rules read the `us.`/`eu.` markers to infer jurisdiction. Not valid for GS1 validators; see the EPCIS validation notes |
| No real labels | Anomalies are injected by the generator, not observed in ARCOS | Limitation: results measure consistency, not real fraud detection |
