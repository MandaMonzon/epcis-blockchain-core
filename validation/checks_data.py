import csv
import gzip
import hashlib
from collections import Counter, defaultdict
from pathlib import Path

from . import signatures as sig
from .pipeline_runner import build_dataset, group_events, load_events, read_labels, sha256_of

RANK = {"commissioning": 0, "packing": 1, "shipping": 2, "receiving": 3, "dispensing": 4}
NORMAL_LABELS = {"none", "recalled"}


def result(item, name, passed, detail):
    return {"item": item, "name": name, "passed": bool(passed), "detail": detail}


def walk_numbers(node, key):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                yield v
            yield from walk_numbers(v, key)
    elif isinstance(node, list):
        for v in node:
            yield from walk_numbers(v, key)


def check_unique_ids_and_quantities(events, scenario_csv):
    ids = Counter(e["eventID"] for e in events)
    duplicates = sum(1 for n in ids.values() if n > 1)
    empty = sum(1 for e in events if not (e.get("epcList") or e.get("childEPCs")))
    explicit = [q for q in walk_numbers(events, "quantity") if isinstance(q, (int, float)) and q <= 0]
    with open(scenario_csv, newline="", encoding="utf-8") as f:
        bad_rows = sum(1 for r in csv.DictReader(f) if float(r["dosage_unit"]) <= 0)
    passed = not (duplicates or empty or explicit or bad_rows)
    return result("1", "No duplicate event ids, no quantity <= 0", passed,
                  f"{len(events)} events, duplicate ids={duplicates}, events without units={empty}, "
                  f"quantity<=0 fields={len(explicit)}, scenario rows with dosage<=0={bad_rows}")


def unit_inversions(lot):
    units = defaultdict(list)
    for e in lot:
        if e["type"] == "ObjectEvent" and e["bizStep"] in RANK:
            units[e["epcList"][0]].append(e)
    inverted = False
    for events in units.values():
        previous_max = None
        for rank in sorted({RANK[e["bizStep"]] for e in events}):
            times = [sig.parse_time(e["eventTime"]) for e in events if RANK[e["bizStep"]] == rank]
            if previous_max is not None and min(times) < previous_max:
                inverted = True
            previous_max = max(times) if previous_max is None else max(previous_max, max(times))
    return inverted


def check_date_order(groups, labels):
    inverted = {tx for tx, lot in groups.items() if unit_inversions(lot)}
    by_label = Counter(labels[tx] for tx in inverted if tx in labels)
    normal_violations = sum(n for t, n in by_label.items() if t in NORMAL_LABELS)
    expected = {"out_of_order", "item_location_mismatch"}
    unexpected = {t: n for t, n in by_label.items() if t not in NORMAL_LABELS and t not in expected}
    missing = [t for t in expected if not by_label.get(t)]
    passed = not normal_violations and not unexpected and not missing
    return result("2", "Dates non-decreasing within each lot (normal lots strict; violators = out_of_order/item_location_mismatch)",
                  passed, f"lots with a date inversion by label: {dict(by_label)}; normal-lot violations={normal_violations}")


def check_conservation(groups, labels, scenario_csv, cap):
    over_received, wrong_units = [], []
    with open(scenario_csv, newline="", encoding="utf-8") as f:
        dosage = {r["transaction_id"].strip(): int(float(r["dosage_unit"])) for r in csv.DictReader(f)}
    for tx, lot in groups.items():
        shipped, received = Counter(), Counter()
        for e in lot:
            if e["type"] == "ObjectEvent" and e["bizStep"] == "shipping":
                shipped[e["epcList"][0]] += 1
            if e["type"] == "ObjectEvent" and e["bizStep"] == "receiving":
                received[e["epcList"][0]] += 1
        if any(received[u] > shipped[u] for u in received):
            over_received.append(tx)
        expected = min(dosage[tx], cap)
        if labels.get(tx) == "quantity_discrepancy":
            expected = max(expected, 2)
        if len(shipped) != expected:
            wrong_units.append(tx)
    by_label = Counter(labels[t] for t in over_received)
    unexpected = {t: n for t, n in by_label.items() if t != "item_location_mismatch"}
    passed = not unexpected and not wrong_units
    return result("3", "Conservation: received <= shipped per unit in every lot; units = min(dosage, cap)", passed,
                  f"lots over-received by label: {dict(by_label)} (item_location_mismatch is a double receiving by design); "
                  f"lots with unexpected unit count={len(wrong_units)}")


def count_raw_rows(raw_path):
    opener = gzip.open if str(raw_path).endswith(".gz") else open
    with opener(raw_path, "rt", encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f) - 1


def check_accounting(raw_path, extract_result, dataset, events):
    raw_rows = count_raw_rows(raw_path)
    scenario = dataset["scenario_result"]["accounting"]
    conversion = dataset["convert_result"]["accounting"]
    skipped = extract_result["skipped"]
    reasons = sum(extract_result["skip_reasons"].values())
    lots = len({e["ilmd"]["cbvmda:transactionID"] for e in events})
    checks = {
        "raw rows == rows_read": raw_rows == extract_result["rows_read"],
        "rows_read == converted + skipped": extract_result["rows_read"] == extract_result["converted"] + skipped,
        "every skipped row has one recorded reason": reasons == skipped,
        "extract output == scenario rows read": extract_result["converted"] == scenario["rows_read"],
        "scenario rows == selected + discards": scenario["rows_read"] == scenario["selected"] + sum(scenario["discarded"].values()),
        "selected == conversion rows_in": scenario["selected"] == conversion["rows_in"],
        "conversion rows == lots + discards": conversion["rows_in"] == conversion["lots_converted"] + sum(conversion["discarded"].values()),
        "lots in events.json == lots_converted": lots == conversion["lots_converted"],
        "event count == generated events": len(events) == dataset["convert_result"]["events"],
    }
    discarded = skipped + sum(scenario["discarded"].values()) + sum(conversion["discarded"].values())
    detail = (f"raw={raw_rows} = lots_in_events({lots}) + discarded({discarded}); skip reasons={extract_result['skip_reasons']}; "
              f"scenario discards={scenario['discarded']}; conversion discards={conversion['discarded']}")
    failed = [k for k, v in checks.items() if not v]
    identity = raw_rows == lots + discarded
    if not identity:
        failed.append("raw == lots + all discards")
    return result("4", "Accounting: ARCOS rows read = lots generated + discards, each with a recorded reason",
                  not failed, detail + (f"; FAILED: {failed}" if failed else ""))


def check_determinism(clean_csv, work, seed, sample_per_drug, first):
    second = build_dataset(clean_csv, Path(work) / f"determinism_{seed}", seed, sample_per_drug)
    other = build_dataset(clean_csv, Path(work) / f"determinism_other_{seed}", seed + 1000, sample_per_drug)
    a, b, c = sha256_of(first["events"]), sha256_of(second["events"]), sha256_of(other["events"])
    scenario_equal = sha256_of(first["scenario"]) == sha256_of(second["scenario"])
    return result("5", "Determinism: same seed gives same SHA256 of events.json (different seed differs)",
                  a == b and scenario_equal and a != c,
                  f"seed {seed}: {a[:16]} vs {b[:16]}; scenario equal={scenario_equal}; other seed {c[:16]}")


def configured_counts(cycle, selected, seed):
    return Counter(cycle[(i + seed) % len(cycle)] for i in range(selected))


def check_ground_truth(groups, labels, cycle, seed):
    configured = configured_counts(cycle, len(labels), seed)
    labeled = Counter(labels.values())
    injected = Counter()
    mismatched = []
    for tx, lot in groups.items():
        found = sig.signatures(lot)
        expected = labels[tx]
        wanted = set() if expected == "none" else {expected}
        if found != wanted:
            mismatched.append((tx, expected, sorted(found)))
        for t in found:
            injected[t] += 1
    types = [t for t in configured if t != "none"]
    table = {t: (configured[t], labeled[t], injected[t]) for t in sorted(types)}
    equal = all(c == l == i for c, l, i in table.values()) and configured["none"] == labeled["none"]
    return result("6", "Ground truth: injected = labeled = configured per anomaly type, one signature per lot",
                  equal and not mismatched,
                  f"(configured, labeled, injected) {table}; lots whose detected signature differs from label={len(mismatched)} "
                  f"{mismatched[:3]}")
