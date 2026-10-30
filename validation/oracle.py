import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone

DETECTION_THRESHOLD = 70
MIN_TRANSIT_DAYS = 3
SHIPMENT_TRANSIT_DAYS_MAX = 30
AUDIT_DELAY_DAYS = 31
QUANTITY_TOLERANCE = 0.10
INTERNATIONAL_STEPS = ("shipping", "receiving")

DOCUMENTED_CODES = [
    "SKIPPED_LIFECYCLE_STEP",
    "OUT_OF_ORDER",
    "LOGISTICS_DIVERSION_TIMING",
    "IMPOSSIBLE_TRANSIT_TIME",
    "TRANSIT_DIVERSION",
    "LOGISTICS_DIVERSION_JURISDICTION",
    "QUANTITY_MISMATCH",
    "SHIPMENT_RECEIPT_MISMATCH",
    "SUPPLY_BASE_COMPLEXITY",
]

SCORES = {
    "SKIPPED_LIFECYCLE_STEP": 75,
    "OUT_OF_ORDER": 30,
    "LOGISTICS_DIVERSION_TIMING": 30,
    "IMPOSSIBLE_TRANSIT_TIME": 85,
    "TRANSIT_DIVERSION": 85,
    "LOGISTICS_DIVERSION_JURISDICTION": 75,
    "QUANTITY_MISMATCH": 75,
    "SHIPMENT_RECEIPT_MISMATCH": 70,
}


def parse_time(value):
    text = str(value).strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        match = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$", text)
        if not match:
            raise
        fraction = (match.group(2) or ".0")[:7]
        parsed = datetime.fromisoformat(match.group(1) + fraction + (match.group(3) or ""))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def load_events(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    body = data.get("epcisBody", {})
    if "eventList" in body:
        return body["eventList"]
    return data.get("eventList", [])


def transaction_id(event):
    ilmd = event.get("ilmd") or {}
    value = ilmd.get("cbvmda:transactionID") or event.get("arcos:transactionID")
    if value is not None:
        return str(value)
    for entry in event.get("bizTransactionList") or []:
        ref = entry.get("bizTransaction") if isinstance(entry, dict) else entry
        if ref:
            return str(ref).rsplit(":", 1)[-1]
    return "UNKNOWN"


def units_of(event):
    return list(event.get("epcList") or []) + list(event.get("childEPCs") or [])


def party_prefix(urn):
    if not urn:
        return None
    tail = urn.split(":")[-1]
    return tail.split(".")[0] if tail else None


def jurisdiction_of(urn):
    prefix = party_prefix(urn)
    if not prefix:
        return None
    if prefix.lower() == "us":
        return "US"
    if prefix.isdigit() and len(prefix) >= 3 and 400 <= int(prefix[:3]) <= 440:
        return "EU"
    return None


def pick(entries, key, types):
    for wanted in types:
        for entry in entries or []:
            if entry.get("type") == wanted and entry.get(key):
                return entry[key]
    return None


def source_location(event):
    return pick(event.get("sourceList"), "source", ["location"])


def destination_location(event):
    return pick(event.get("destinationList"), "destination", ["location"])


def event_location(event):
    return (event.get("bizLocation") or {}).get("id") or (event.get("readPoint") or {}).get("id")


def jurisdiction_endpoint(entries, key):
    return pick(entries, key, ["location", "owning_party", "possessing_party"])


def source_parties(event):
    return {
        entry["source"]
        for entry in event.get("sourceList") or []
        if entry.get("type") in ("possessing_party", "owning_party") and entry.get("source")
    }


SUPPLY_STEPS = ("receiving", "stocking", "dispensing")


def band_score(count):
    if count >= 9:
        return 85
    if count >= 6:
        return 60
    if count >= 4:
        return 30
    return 0


class TransactionState:
    def __init__(self):
        self.commissioned = set()
        self.shipped_at = {}
        self.declared_destination = {}
        self.packed = {}
        self.desadv = {}
        self.recadv = set()
        self.suppliers = {}
        self.last_time = None

    def process(self, event):
        step = event.get("bizStep")
        time = parse_time(event["eventTime"])
        units = units_of(event)
        fired = {}

        def fire(code, score=None):
            value = SCORES[code] if score is None else score
            if value > fired.get(code, -1):
                fired[code] = value

        if self.last_time is not None and time < self.last_time:
            fire("OUT_OF_ORDER")
            fire("LOGISTICS_DIVERSION_TIMING")

        if step == "receiving":
            for unit in units:
                if unit not in self.commissioned or unit not in self.shipped_at:
                    fire("SKIPPED_LIFECYCLE_STEP")
                shipped = self.shipped_at.get(unit)
                if shipped is not None and time - shipped < timedelta(days=MIN_TRANSIT_DAYS):
                    fire("IMPOSSIBLE_TRANSIT_TIME")
                declared = self.declared_destination.get(unit)
                actual = event_location(event)
                if declared and actual and declared != actual:
                    fire("TRANSIT_DIVERSION")

        if step not in INTERNATIONAL_STEPS:
            src = jurisdiction_of(jurisdiction_endpoint(event.get("sourceList"), "source"))
            dst = jurisdiction_of(jurisdiction_endpoint(event.get("destinationList"), "destination"))
            if src and dst and src != dst:
                fire("LOGISTICS_DIVERSION_JURISDICTION")

        if event.get("type") == "AggregationEvent" and event.get("parentID"):
            parent = event["parentID"]
            children = event.get("childEPCs") or []
            if event.get("action") == "ADD":
                self.packed[parent] = len(children)
            elif event.get("action") == "DELETE" and parent in self.packed:
                if len(children) < self.packed[parent] * (1 - QUANTITY_TOLERANCE):
                    fire("QUANTITY_MISMATCH")

        if step in SUPPLY_STEPS:
            location = event_location(event)
            if location:
                seen = self.suppliers.setdefault(location, set())
                seen.update(source_parties(event))
                score = band_score(len(seen))
                if step == "receiving" and score:
                    fire("SUPPLY_BASE_COMPLEXITY", score)

        self.update(event, step, time, units)
        return [{"code": code, "score": score} for code, score in fired.items()]

    def update(self, event, step, time, units):
        if step == "commissioning":
            self.commissioned.update(units)
        elif step == "shipping":
            destination = destination_location(event)
            for unit in units:
                self.shipped_at[unit] = time
                if destination:
                    self.declared_destination[unit] = destination
        for entry in event.get("bizTransactionList") or []:
            if not isinstance(entry, dict):
                continue
            kind = str(entry.get("type", "")).lower()
            ref = entry.get("bizTransaction")
            if ref is None:
                continue
            if kind.endswith("desadv"):
                self.desadv.setdefault(ref, time)
            elif kind.endswith("recadv"):
                self.recadv.add(ref)
        if self.last_time is None or time > self.last_time:
            self.last_time = time

    def audit(self):
        if self.last_time is None:
            return []
        audit_time = self.last_time + timedelta(days=AUDIT_DELAY_DAYS)
        for ref, sent in self.desadv.items():
            if ref not in self.recadv and audit_time - sent > timedelta(days=SHIPMENT_TRANSIT_DAYS_MAX):
                return [{"code": "SHIPMENT_RECEIPT_MISMATCH", "score": SCORES["SHIPMENT_RECEIPT_MISMATCH"]}]
        return []


def evaluate(events):
    groups = {}
    for index, event in enumerate(events):
        groups.setdefault(transaction_id(event), []).append((parse_time(event["eventTime"]), index, event))
    transactions = []
    for tid, items in groups.items():
        items.sort(key=lambda item: (item[0], item[1]))
        state = TransactionState()
        event_results = []
        scores = []
        for _, _, event in items:
            violations = state.process(event)
            scores.extend(v["score"] for v in violations)
            event_results.append({"eventID": event.get("eventID"), "violations": violations})
        audit = state.audit()
        scores.extend(v["score"] for v in audit)
        score = max(scores) if scores else 0
        transactions.append({
            "transaction_id": tid,
            "events": event_results,
            "audit_violations": audit,
            "score": score,
            "flagged": score >= DETECTION_THRESHOLD,
        })
    return {"documented_codes": DOCUMENTED_CODES, "transactions": transactions}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("events")
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    result = evaluate(load_events(args.events))
    text = json.dumps(result)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    else:
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
