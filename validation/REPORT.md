# Validation report

- Generated: 2026-10-22 17:48:53 (run time 210s)
- Core commit: `0c00410`; generator commit: `416d86f`
- Input: synthetic ARCOS-like file (known defects injected: {'rows_written': 4000, 'injected_defects': {'missing_buyer': 27, 'bad_date': 27, 'bad_ndc': 27, 'bad_quantity': 27}}); 4000 rows read, 3892 usable
- Seeds: 1-30; sample per drug 10
- Python 3.9.6, node v26.0.0
- Summary: 17 of 18 criteria pass

## Criteria

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | No duplicate event ids, no quantity <= 0 | PASS | 30/30 seeds pass. Seed 1: 32826 events, duplicate ids=0, events without units=0, quantity<=0 fields=0, scenario rows with dosage<=0=0 |
| 2 | Dates non-decreasing within each lot (normal lots strict; violators = out_of_order/item_location_mismatch) | PASS | 30/30 seeds pass. Seed 1: lots with a date inversion by label: {'out_of_order': 72, 'item_location_mismatch': 71}; normal-lot violations=0 |
| 3 | Conservation: received <= shipped per unit in every lot; units = min(dosage, cap) | PASS | 30/30 seeds pass. Seed 1: lots over-received by label: {'item_location_mismatch': 71} (item_location_mismatch is a double receiving by design); lots with unexpected unit count=0 |
| 4 | Accounting: ARCOS rows read = lots generated + discards, each with a recorded reason | PASS | 30/30 seeds pass. Seed 1: raw=4000 = lots_in_events(1000) + discarded(3000); skip reasons={'transaction_date': 27, 'drug_code': 27, 'dosage_unit': 27, 'buyer_id': 27}; scenario discards={'missing_drug_code': 0, 'beyond_max_drugs': 0, 'not_sampled': 2892, 'drug_without_full_sample': 0}; conversion discards={'limit': 0, 'max_events': 0} |
| 5 | Determinism: same seed gives same SHA256 of events.json (different seed differs) | PASS | seed 1: 1c0a73191af4a537 vs 1c0a73191af4a537; scenario equal=True; other seed 340865b643c99030 |
| 6 | Ground truth: injected = labeled = configured per anomaly type, one signature per lot | PASS | 30/30 seeds pass. Seed 1: (configured, labeled, injected) {'impossible_transit': (71, 71, 71), 'item_location_mismatch': (71, 71, 71), 'jurisdiction': (72, 72, 72), 'many_suppliers': (71, 71, 71), 'out_of_order': (72, 72, 72), 'quantity_discrepancy': (71, 71, 71), 'recalled': (72, 72, 72), 'shipment_divergence': (71, 71, 71), 'skip_commission': (72, 72, 72), 'transit_diversion': (71, 71, 71)}; lots whose detected signature differs from label=0 [] |
| 7 | Mutation: one known mutation on normal lots fires the expected rule and no other rule >= 70 | PASS | 200 mutated lots; failures=0 []; mutations not recognised by the independent signatures=0 |
| 9 | Oracle vs chaincode: 100% agreement on the flag of every transaction (divergences documented) | PASS | 30 seeds, 30000 transactions: flag disagreements=0; flagged transactions whose deciding chaincode code is also reported by the oracle=19285/19285; codes only in chaincode (events)={'LOT_CONTAMINATION': 242219, 'LOGISTICS_DIVERSION_SEQUENCE': 20409}; codes only in oracle (events)={}; see validation/DIVERGENCES.md |
| 10 | Metamorphic: shuffling event arrival order does not change any transaction result | PASS | 1000 transactions compared (flag, max score); differences=0 []; transactions with the same result but a different set of fired codes=28 |
| 11 | Metamorphic: consistently renaming ids (events, units, lots, parties) does not change any result | PASS | 1000 transactions compared; ids renamed=44394; differences=0 []; code-set-only differences=0 |
| 12 | Metamorphic: scaling every quantity by k=3 does not change any result | PASS | 1000 transactions compared; object-event units at x3=86582; differences=0 []; code-set-only differences=0 |
| 13 | 100% normal dataset: false positive rate is 0 (every false positive explained) | PASS | 1000 transactions, all labeled none=True; false positives=0 codes={} |
| 14 | >= 30 seeds: precision, recall, F1, mean +- sd and Wilson 95% CI per anomaly type | PASS | 30 seeds; normal transactions=10715, false positives=0 |
| 15 | PPV at prevalence 1%, 5%, 10% by Bayes, checked against resampled and regenerated datasets | PASS | recall=1.0000, FPR=0.00000 (Wilson upper 0.00036); max /Bayes - resampled/ = 0.0000 (tolerance 0.01); regenerated runs present=True |
| 16 | Train/test 70/30 split by lot; only the test partition is reported | PASS | split by lot (sha256 of the transaction id, 70/30): train=20673 test=9327, disjoint=True. Test only: TP=5985 FN=0 FP=0 TN=3342; recall 100.0% [99.9, 100.0]; FPR 0.0% [0.0, 0.1]; precision 100.0% [99.9, 100.0]; F1=1.0000. No threshold is fitted by any code in this repository: scores and tolerances are hand-set (see limitations), so the split guards against future tuning and is not used to select anything |
| 17 | McNemar (paired, exact) between an older rule version and HEAD | PASS | seed 1, 1000 paired transactions; 200fabf vs HEAD: new correct only=72, old correct only=0, exact McNemar p=4.24e-22, odds ratio=inf, accuracy 0.9280 -> 1.0000; ba67b09 vs HEAD: new correct only=72, old correct only=0, exact McNemar p=4.24e-22, odds ratio=inf, accuracy 0.9280 -> 1.0000 |
| 18 | Confusion matrix cells sum to the number of transactions in every report | PASS | 63 matrices checked (own scorer, evaluate_rules.js JSON for every seed, generate_report.py sections); problems=[] |
| 19 | Fabric network vs local evaluator: identical scores per transaction | NOT RUN | NOT RUN: needs the Fabric network (node003). harness checked locally: contract.submitEvent on an isolated ledger vs the scoring tool, 55 transactions, score mismatches=0. Run: see validation/README.md |

## Detection by anomaly type (item 14)

30 seeds; one dataset per seed. Pooled values with Wilson 95% CI; the last columns are mean ± sd across seeds. Precision of a type = TP of the type / (TP of the type + false positives on normal lots), since false positives have no type.

| Type | Lots | Recall (Wilson 95%) | Precision (Wilson 95%) | F1 | Recall mean±sd | Precision mean±sd | F1 mean±sd |
|---|---|---|---|---|---|---|---|
| skip_commission | 2144 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| out_of_order | 2144 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| impossible_transit | 2142 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| transit_diversion | 2142 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| jurisdiction | 2144 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| quantity_discrepancy | 2142 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| shipment_divergence | 2142 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| many_suppliers | 2143 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |
| item_location_mismatch | 2142 | 100.0% [99.8%, 100.0%] | 100.0% [99.8%, 100.0%] | 1.0000 | 1.0000±0.0000 | 1.0000±0.0000 | 1.0000±0.0000 |

Pooled over all seeds: TP=19285 FN=0 FP=0 TN=10715 (sum 30000 = 30000 transactions). Recall 100.0% [100.0, 100.0]; FPR 0.0% [0.0, 0.0]; precision 100.0% [100.0, 100.0]; F1 1.0000. The dataset prevalence is about 71% by construction (10 of 14 cycle positions), `recalled` lots are normal.

## PPV by prevalence (item 15)

PPV = recall·p / (recall·p + FPR·(1−p)). `Lower bound` uses the upper Wilson limit of the FPR. `Resampled` is the mean PPV over 300 datasets of 1000 lots drawn from the pooled lots at prevalence p. `Regenerated` is one real generator run at that prevalence.

| Prevalence | Bayes PPV | Bayes lower bound | Resampled mean (min) | Regenerated (n, anomalous, TP, FP, PPV) |
|---|---|---|---|---|
| 1.0% | 1.0000 | 0.9657 | 1.0000 (1.0000) | 1000, 10, 10, 0, 1.0000 |
| 5.0% | 1.0000 | 0.9932 | 1.0000 (1.0000) | 1000, 50, 50, 0, 1.0000 |
| 10.0% | 1.0000 | 0.9968 | 1.0000 (1.0000) | 1000, 100, 100, 0, 1.0000 |

## Train/test split by lot (item 16)

Test partition (30% of lots): TP=5985 FN=0 FP=0 TN=3342.

## Version comparison (item 17)

| Older version | Paired lots | Accuracy old → HEAD | HEAD right only | Old right only | McNemar exact p | Odds ratio |
|---|---|---|---|---|---|---|
| `200fabf` | 1000 | 0.9280 → 1.0000 | 72 | 0 | 4.24e-22 | inf |
| `ba67b09` | 1000 | 0.9280 → 1.0000 | 72 | 0 | 4.24e-22 | inf |

Effect size: odds ratio of the discordant pairs (HEAD right only / old right only). Lots of one seed are paired; lots across seeds share raw rows, so only seed 1 is used.

## Mutation matrix (item 7)

Codes fired on 20 normal lots per mutation (chaincode, one mutation per lot):

- skip_commission: n=20, codes fired={'SKIPPED_LIFECYCLE_STEP': 20, 'LOT_CONTAMINATION': 20}
- out_of_order: n=20, codes fired={'SKIPPED_LIFECYCLE_STEP': 20, 'LOT_CONTAMINATION': 20, 'LOGISTICS_DIVERSION_SEQUENCE': 20}
- impossible_transit: n=20, codes fired={'IMPOSSIBLE_TRANSIT_TIME': 20, 'LOT_CONTAMINATION': 20}
- transit_diversion: n=20, codes fired={'TRANSIT_DIVERSION': 20, 'LOT_CONTAMINATION': 20}
- jurisdiction: n=20, codes fired={'LOGISTICS_DIVERSION_JURISDICTION': 20}
- quantity_discrepancy: n=20, codes fired={'QUANTITY_DISCREPANCY': 20, 'LOT_CONTAMINATION': 20}
- shipment_divergence: n=20, codes fired={'SHIPMENT_DIVERGENCE': 20}
- many_suppliers: n=20, codes fired={'SUPPLY_BASE_COMPLEXITY': 20, 'LOT_CONTAMINATION': 20}
- item_location_mismatch: n=20, codes fired={'LOGISTICS_DIVERSION_SEQUENCE': 20, 'SKIPPED_LIFECYCLE_STEP': 20, 'LOT_CONTAMINATION': 20}
- recalled: n=20, codes fired={}

`LOT_CONTAMINATION` and `LOGISTICS_DIVERSION_SEQUENCE` (60) co-fire below the 70 threshold on several mutations; they never decide a flag.

## Oracle divergences (item 9)

See `validation/DIVERGENCES.md` (every divergence with its cause).

## Network equivalence (item 19)

harness checked locally: contract.submitEvent on an isolated ledger vs the scoring tool, 55 transactions, score mismatches=0

## Limitations

- The data is synthetic: anomalies are injected by the generator from ARCOS rows. Perfect recall measures agreement between generator and rules, not detection of real fraud. Prevalence of about 71% is an artefact of the cycle.
- Rules, generator and docs were developed on one ARCOS sample, so seeds 1-30 are not an independent hold-out; the seed changes the anomaly assignment and sampling, not the underlying raw data.
- The oracle was written from the documentation but by the same project; the two share the documented interpretation. Ambiguities resolved in the docs (supplier identity) make the oracle depend on those decisions.
- `LOT_CONTAMINATION`, `LOGISTICS_DIVERSION_SEQUENCE` and `VOLUME_FRAGMENTATION` have no documented condition the oracle can reproduce; they score below 70, except fragmentation, which needs >= 10 orders of one buyer in 30 days and is not generated.
- Scores (30-90), the 70 threshold, the 10% quantity tolerance and the 3-day minimum transit are hand-set; none is fitted on data.
- The chaincode reports only the worst failure of the logistics rule per event, so per-event code attribution differs from the oracle; only the transaction flag is compared for equality.
- Events with the same timestamp are processed in arrival order; the set of low-score codes can depend on it (item 10), the flag and score do not.
- Evaluation is per isolated transaction. Cross-transaction state (supplier accumulation, fragmentation, audit) only appears on the network (item 19).
- OpenEPCIS / GS1 schema validation of the events is not part of this suite (see docs/ARCOS_DATA_AUDIT.md for the known sgln:us.dea issue).
