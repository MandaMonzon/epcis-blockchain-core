# Oracle notes

Source: `docs/BUSINESS_RULES.md` only (plus the event field names in `/tmp/v3/events.json`). Run: `python3 validation/oracle.py <events.json> [--out result.json]`.

## Assumptions and ambiguities

- "Each transaction is replayed in isolation": grouped by `ilmd['cbvmda:transactionID']`, sorted by `eventTime` (stable). Rule state is keyed per SGTIN (epcList + childEPCs of every event; the aggregation parentID is not a unit).
- "**Detection threshold:** score >= 70": `flagged = max score >= 70`; the transaction score also includes audit violations.
- "Class A rules (mandatory fields) block the event": no Class A codes or field list are given, so none are implemented.
- "`SKIPPED_LIFECYCLE_STEP` (75) fires" when "a unit reaches `receiving` without `commissioning`" / "`receiving` and no prior `shipping`": fires on any `receiving` event (ObjectEvent, TransactionEvent, AggregationEvent) for each unit lacking a prior commissioning OR a prior shipping. Packing is not required (the doc names only commissioning and shipping).
- "the events are processed in arrival order ... `OUT_OF_ORDER` scores 30 and never decides alone" and open item 1 "`LOGISTICS_DIVERSION_TIMING`, score 30 ... the offline replay sorts events by time, so it can never appear there": both names are listed, score 30, fired only if an event's time precedes an earlier processed event. Since replay is sorted, they never fire. Which name is canonical is unclear.
- "`LOGISTICS_DIVERSION_SEQUENCE`" and "`VOLUME_FRAGMENTATION`" (open item 2): named without definition or score; not implemented.
- "a `receiving` less than `MIN_TRANSIT_DAYS` (3) days after `shipping`": strict `<` 3 x 24h against the most recent earlier shipping of the same unit; units with no earlier shipping are skipped.
- "declared destination is A but whose receiving is recorded at B": A = the `destinationList` entry of type `location` of the latest earlier shipping event of the unit; B = receiving `bizLocation.id` (fallback `readPoint.id`); fires on string inequality. No location destination on the shipping event means no check.
- "source and destination are in different jurisdictions ... at a step that is not international transport": any event whose bizStep is not `shipping`/`receiving` (including `dispensing`, and events with no bizStep). Endpoint = first `location` entry, else owning_party, else possessing_party. Jurisdiction: first dot-segment of the URN tail; `us` -> US; numeric prefix whose first 3 digits are in 400..440 (inclusive) -> EU; anything else unknown (no firing).
- "fewer than N * (1 - tolerance)", tolerance 10%: N = number of childEPCs of the most recent earlier `AggregationEvent ADD` with the same parentID; fires on a `DELETE` with the same parentID when `len(childEPCs) < 0.9 * N` (strict). A DELETE without a prior ADD is ignored.
- "a `desadv` without a `recadv`": matched via `bizTransactionList` entries whose type ends in `desadv`/`recadv`, paired by identical `bizTransaction` string. Audit runs 31 days after the last event of the transaction; fires once if any desadv is unmatched and older than 30 days at audit time (always true under these inputs). Score 70.
- Scenario 10, "a buyer location whose `receiving`, `stocking` or `dispensing` events list 9 or more distinct parties in `sourceList` entries of type `possessing_party` or `owning_party` (accumulated over the events of that location; `location` entries are not parties)": per `bizLocation` (fallback `readPoint`), the set of distinct party URNs is accumulated across receiving/stocking/dispensing events in the transaction replay. The violation is evaluated only when a `receiving` event is processed, with the current event's parties included; bands 4-5 = 30, 6-8 = 60, >=9 = 85. Under isolated replay this rarely exceeds a few parties.
- Item location mismatch (scenario 11): no dedicated rule, as stated; covered by SKIPPED_LIFECYCLE_STEP.
- Scenario 2 (recalled): disposition is never used.
- Multiple violations with the same code on one event are collapsed to one (highest score).

## Too vague to implement

- Class A mandatory-field validation (no field list).
- `LOGISTICS_DIVERSION_SEQUENCE`, `VOLUME_FRAGMENTATION` (no definition/score; the latter needs cross-transaction history).
- Whether rules apply per unit event or per container/TransactionEvent; the oracle applies them to every event that carries units.
