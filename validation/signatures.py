import copy
import re
from datetime import datetime, timedelta

MIN_TRANSIT = timedelta(days=3)
QUANTITY_TOLERANCE = 0.9
MANY_SUPPLIERS = 9
PARTY_TYPES = ("possessing_party", "owning_party")
TYPES = ("skip_commission", "out_of_order", "impossible_transit", "transit_diversion", "jurisdiction",
         "quantity_mismatch", "shipment_receipt_mismatch", "many_suppliers", "item_location_mismatch", "recalled")


def parse_time(value):
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


def format_time(value):
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def object_events(lot):
    return [e for e in lot if e["type"] == "ObjectEvent"]


def per_unit(lot):
    units = {}
    for event in object_events(lot):
        units.setdefault(event["epcList"][0], []).append(event)
    return units


def jurisdiction(entries):
    text = " ".join(str(x.get("source") or x.get("destination") or "") for x in entries).lower()
    if "us.dea" in text:
        return "US"
    return "EU"


def dea_of(value):
    match = re.search(r"us\.dea\.([A-Z0-9]+)", value)
    return match.group(1) if match else None


def signatures(lot):
    found = set()
    units = per_unit(lot)
    by_step = lambda events, step: [e for e in events if e["bizStep"] == step]

    if any(by_step(ev, "receiving") and not by_step(ev, "commissioning") for ev in units.values()):
        found.add("skip_commission")
    if any(e.get("disposition") == "recalled" for e in lot):
        found.add("recalled")
    if any(len(by_step(ev, "receiving")) >= 2 for ev in units.values()):
        found.add("item_location_mismatch")
    for events in units.values():
        shipping, receiving = by_step(events, "shipping"), by_step(events, "receiving")
        if shipping and receiving and len(receiving) == 1:
            delta = parse_time(receiving[0]["eventTime"]) - parse_time(shipping[0]["eventTime"])
            if delta < timedelta(0):
                found.add("out_of_order")
            elif delta < MIN_TRANSIT:
                found.add("impossible_transit")
    for events in units.values():
        shipping, receiving = by_step(events, "shipping"), by_step(events, "receiving")
        if shipping and receiving:
            declared = {dea_of(d.get("destination", "")) for d in shipping[0].get("destinationList", [])} - {None}
            actual = dea_of(receiving[0].get("bizLocation", {}).get("id", ""))
            if declared and actual not in declared:
                found.add("transit_diversion")
    for event in lot:
        if event["bizStep"] == "dispensing" and jurisdiction(event.get("sourceList", [])) != jurisdiction(event.get("destinationList", [])):
            found.add("jurisdiction")
    adds = [e for e in lot if e["type"] == "AggregationEvent" and e["action"] == "ADD"]
    deletes = [e for e in lot if e["type"] == "AggregationEvent" and e["action"] == "DELETE"]
    if adds and deletes and len(deletes[0]["childEPCs"]) < QUANTITY_TOLERANCE * len(adds[0]["childEPCs"]):
        found.add("quantity_mismatch")
    types = {b["type"] for e in lot for b in e.get("bizTransactionList", [])}
    if "urn:epcglobal:cbv:btt:desadv" in types and "urn:epcglobal:cbv:btt:recadv" not in types:
        found.add("shipment_receipt_mismatch")
    parties = {s["source"] for e in lot if e["bizStep"] == "receiving" for s in e.get("sourceList", [])
               if s.get("type") in PARTY_TYPES}
    if len(parties) >= MANY_SUPPLIERS:
        found.add("many_suppliers")
    return found


def _times(lot, step):
    return [parse_time(e["eventTime"]) for e in lot if e["bizStep"] == step]


def mutate_skip_commission(lot):
    return [e for e in lot if not (e["type"] == "ObjectEvent" and e["bizStep"] == "commissioning")]


def mutate_out_of_order(lot):
    commissioning = {e["epcList"][0]: parse_time(e["eventTime"]) for e in object_events(lot) if e["bizStep"] == "commissioning"}
    for e in object_events(lot):
        if e["bizStep"] == "receiving":
            e["eventTime"] = format_time(commissioning[e["epcList"][0]] - timedelta(hours=1))
    return lot


def mutate_impossible_transit(lot):
    shipped = min(_times(lot, "shipping"))
    for e in lot:
        if e["bizStep"] == "receiving":
            e["eventTime"] = format_time(shipped + timedelta(days=1))
    return lot


def mutate_transit_diversion(lot):
    def divert(value):
        return re.sub(r"(us\.dea\.[A-Z0-9]*)([A-Z0-9])", lambda m: m.group(1) + ("1" if m.group(2) != "1" else "2"), value)
    for e in lot:
        if e["bizStep"] == "receiving":
            for key in ("bizLocation", "readPoint"):
                if key in e:
                    e[key]["id"] = divert(e[key]["id"])
    return lot


def mutate_jurisdiction(lot):
    receiving = next(e for e in object_events(lot) if e["bizStep"] == "receiving")
    event = copy.deepcopy(receiving)
    event.update({"eventID": receiving["eventID"] + "-dispense", "bizStep": "dispensing",
                  "eventTime": format_time(parse_time(receiving["eventTime"]) + timedelta(days=1))})
    event["sourceList"] = [{"type": "location", "source": "urn:epc:id:sgln:4000001.00000.0"}]
    event["destinationList"] = [{"type": "location", "destination": "urn:epc:id:sgln:us.dea.AB1234563.0.0"}]
    return lot + [event]


def mutate_quantity_mismatch(lot):
    for e in lot:
        if e["type"] == "AggregationEvent" and e["action"] == "DELETE":
            e["childEPCs"] = e["childEPCs"][: max(1, int(len(e["childEPCs"]) * 0.7))]
    return lot


def mutate_shipment_receipt_mismatch(lot):
    def is_receipt(e):
        return e["bizStep"] == "receiving"
    return [e for e in lot if not is_receipt(e)]


def mutate_many_suppliers(lot):
    for e in lot:
        if e["bizStep"] == "receiving" and e["type"] == "ObjectEvent":
            e["sourceList"] = e["sourceList"] + [
                {"type": "possessing_party", "source": f"urn:epc:id:pgln:us.dea.ZZ000000{i}"} for i in range(8)]
    return lot


def mutate_item_location_mismatch(lot):
    units = per_unit(lot)
    epc = next(iter(units))
    commissioning = next(e for e in units[epc] if e["bizStep"] == "commissioning")
    receiving = next(e for e in units[epc] if e["bizStep"] == "receiving")
    rogue = copy.deepcopy(receiving)
    rogue.update({"eventID": receiving["eventID"] + "-rogue", "eventTime": commissioning["eventTime"]})
    return lot + [rogue]


def mutate_recalled(lot):
    for e in object_events(lot):
        if e["bizStep"] == "commissioning":
            e["disposition"] = "recalled"
    return lot


MUTATORS = {
    "skip_commission": mutate_skip_commission,
    "out_of_order": mutate_out_of_order,
    "impossible_transit": mutate_impossible_transit,
    "transit_diversion": mutate_transit_diversion,
    "jurisdiction": mutate_jurisdiction,
    "quantity_mismatch": mutate_quantity_mismatch,
    "shipment_receipt_mismatch": mutate_shipment_receipt_mismatch,
    "many_suppliers": mutate_many_suppliers,
    "item_location_mismatch": mutate_item_location_mismatch,
    "recalled": mutate_recalled,
}

EXPECTED_CODE = {
    "skip_commission": "SKIPPED_LIFECYCLE_STEP",
    "out_of_order": "SKIPPED_LIFECYCLE_STEP",
    "impossible_transit": "IMPOSSIBLE_TRANSIT_TIME",
    "transit_diversion": "TRANSIT_DIVERSION",
    "jurisdiction": "LOGISTICS_DIVERSION_JURISDICTION",
    "quantity_mismatch": "QUANTITY_MISMATCH",
    "shipment_receipt_mismatch": "SHIPMENT_RECEIPT_MISMATCH",
    "many_suppliers": "SUPPLY_BASE_COMPLEXITY",
    "item_location_mismatch": "SKIPPED_LIFECYCLE_STEP",
    "recalled": None,
}

CODE_ALIASES = {
    "SHIPMENT_RECEIPT_MISMATCH_AUDIT": "SHIPMENT_RECEIPT_MISMATCH",
    "SHIPMENT_DIVERGENCE": "SHIPMENT_RECEIPT_MISMATCH",
    "SHIPMENT_DIVERGENCE_AUDIT": "SHIPMENT_RECEIPT_MISMATCH",
    "QUANTITY_DISCREPANCY": "QUANTITY_MISMATCH",
}


def canonical_code(code):
    return CODE_ALIASES.get(code, code)
