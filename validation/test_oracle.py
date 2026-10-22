import unittest
from datetime import datetime, timedelta, timezone

from validation import oracle

EU_A = "urn:epc:id:sgln:4000001.00000.0"
EU_B = "urn:epc:id:sgln:4000000.99999.0"
US_A = "urn:epc:id:sgln:us.dea.BR1.0.0"
US_B = "urn:epc:id:sgln:us.dea.BR2.0.0"
BASE = datetime(2020, 1, 1, tzinfo=timezone.utc)
_counter = [0]


def ev(step, day, units=("u1",), src=EU_A, dst=EU_B, loc=None, **extra):
    _counter[0] += 1
    event = {
        "eventID": "e%d" % _counter[0],
        "type": "ObjectEvent",
        "action": "OBSERVE",
        "eventTime": (BASE + timedelta(days=day)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bizStep": step,
        "epcList": list(units),
        "bizLocation": {"id": loc or dst},
        "sourceList": [{"type": "location", "source": src}],
        "destinationList": [{"type": "location", "destination": dst}],
        "ilmd": {"cbvmda:transactionID": "T1"},
    }
    event.update(extra)
    return event


def lifecycle(transit=14, units=("u1",)):
    return [
        ev("commissioning", 0, units, EU_A, EU_A),
        ev("packing", 0.05, units, EU_A, EU_A),
        ev("shipping", 1, units, EU_A, US_A, loc=EU_B),
        ev("receiving", 1 + transit, units, EU_B, US_A, loc=US_A),
    ]


def run(events):
    return oracle.evaluate(events)["transactions"][0]


def codes(tx):
    found = set()
    for item in tx["events"]:
        found.update(v["code"] for v in item["violations"])
    found.update(v["code"] for v in tx["audit_violations"])
    return found


class OracleTests(unittest.TestCase):
    def test_normal(self):
        tx = run(lifecycle())
        self.assertEqual(codes(tx), set())
        self.assertFalse(tx["flagged"])
        self.assertEqual(tx["score"], 0)

    def test_recalled_negative(self):
        events = lifecycle()
        events[0]["disposition"] = "recalled"
        self.assertFalse(run(events)["flagged"])

    def test_skipped_positive(self):
        tx = run(lifecycle()[1:])
        self.assertIn("SKIPPED_LIFECYCLE_STEP", codes(tx))
        self.assertEqual(tx["score"], 75)
        self.assertTrue(tx["flagged"])

    def test_skipped_negative(self):
        self.assertNotIn("SKIPPED_LIFECYCLE_STEP", codes(run(lifecycle())))

    def test_out_of_order_positive(self):
        events = lifecycle()
        events[3]["eventTime"], events[2]["eventTime"] = events[2]["eventTime"], events[3]["eventTime"]
        tx = run(events)
        self.assertEqual(codes(tx) & {"SKIPPED_LIFECYCLE_STEP"}, {"SKIPPED_LIFECYCLE_STEP"})
        self.assertNotIn("OUT_OF_ORDER", codes(tx))

    def test_out_of_order_negative(self):
        self.assertNotIn("SKIPPED_LIFECYCLE_STEP", codes(run(lifecycle())))

    def test_impossible_transit_positive(self):
        tx = run(lifecycle(transit=2))
        self.assertIn("IMPOSSIBLE_TRANSIT_TIME", codes(tx))
        self.assertEqual(tx["score"], 85)

    def test_impossible_transit_negative(self):
        self.assertNotIn("IMPOSSIBLE_TRANSIT_TIME", codes(run(lifecycle(transit=3))))

    def test_diversion_positive(self):
        events = lifecycle()
        events[3]["bizLocation"] = {"id": US_B}
        tx = run(events)
        self.assertIn("TRANSIT_DIVERSION", codes(tx))
        self.assertEqual(tx["score"], 85)

    def test_diversion_negative(self):
        self.assertNotIn("TRANSIT_DIVERSION", codes(run(lifecycle())))

    def test_jurisdiction_positive(self):
        events = lifecycle()
        events[1] = ev("packing", 0.05, ("u1",), EU_A, US_A)
        tx = run(events)
        self.assertIn("LOGISTICS_DIVERSION_JURISDICTION", codes(tx))
        self.assertEqual(tx["score"], 75)

    def test_jurisdiction_negative(self):
        self.assertNotIn("LOGISTICS_DIVERSION_JURISDICTION", codes(run(lifecycle())))

    def test_jurisdiction_prefix_range(self):
        self.assertEqual(oracle.jurisdiction_of("urn:epc:id:sgln:4400000.1.0"), "EU")
        self.assertIsNone(oracle.jurisdiction_of("urn:epc:id:sgln:4410000.1.0"))
        self.assertIsNone(oracle.jurisdiction_of("urn:epc:id:sgln:3990000.1.0"))

    def pack(self, delete_count):
        children = ["c%d" % i for i in range(10)]
        add = ev("packing", 0.1, (), EU_A, EU_A, type="AggregationEvent", action="ADD",
                 parentID="p1", childEPCs=children)
        delete = ev("receiving", 15, (), EU_B, US_A, loc=US_A, type="AggregationEvent",
                    action="DELETE", parentID="p1", childEPCs=children[:delete_count])
        return [add, delete]

    def test_quantity_positive(self):
        self.assertIn("QUANTITY_DISCREPANCY", codes(run(self.pack(8))))

    def test_quantity_boundary_negative(self):
        self.assertNotIn("QUANTITY_DISCREPANCY", codes(run(self.pack(9))))

    def test_quantity_full_negative(self):
        self.assertNotIn("QUANTITY_DISCREPANCY", codes(run(self.pack(10))))

    def advice(self, with_recadv):
        events = [ev("shipping", 0, ("u1",), EU_A, US_A,
                     bizTransactionList=[{"type": "urn:epcglobal:cbv:btt:desadv", "bizTransaction": "g1"}])]
        if with_recadv:
            events.append(ev("receiving", 5, ("u1",), EU_B, US_A,
                             bizTransactionList=[{"type": "urn:epcglobal:cbv:btt:recadv", "bizTransaction": "g1"}]))
        return events

    def test_divergence_positive(self):
        tx = run(self.advice(False))
        self.assertEqual(tx["audit_violations"], [{"code": "SHIPMENT_DIVERGENCE", "score": 70}])
        self.assertTrue(tx["flagged"])

    def test_divergence_negative(self):
        self.assertEqual(run(self.advice(True))["audit_violations"], [])

    def suppliers(self, count):
        events = []
        for i in range(count):
            src = "urn:epc:id:sgln:400000%d.1.0" % i
            events.append(ev("receiving", i, ("u%d" % i,), src, US_A,
                             sourceList=[{"type": "owning_party", "source": "urn:epc:id:pgln:400000%d.1" % i}],
                             destinationList=[{"type": "owning_party", "destination": "urn:epc:id:pgln:us.dea.B"}]))
        return events

    def supply_score(self, count):
        tx = run(self.suppliers(count))
        scores = [v["score"] for e in tx["events"] for v in e["violations"] if v["code"] == "SUPPLY_BASE_COMPLEXITY"]
        return max(scores) if scores else 0

    def test_supply_bands(self):
        self.assertEqual(self.supply_score(3), 0)
        self.assertEqual(self.supply_score(4), 30)
        self.assertEqual(self.supply_score(5), 30)
        self.assertEqual(self.supply_score(6), 60)
        self.assertEqual(self.supply_score(8), 60)
        self.assertEqual(self.supply_score(9), 85)

    def test_supply_ignores_location_entries(self):
        events = [ev("receiving", i, ("u%d" % i,), "urn:epc:id:sgln:400000%d.1.0" % i, US_A) for i in range(9)]
        self.assertEqual(self.supply_score_of(events), 0)

    def test_supply_accumulates_over_stocking_and_dispensing(self):
        events = self.suppliers(5)
        for i, step in zip(range(5, 8), ("stocking", "dispensing", "stocking")):
            events.append(ev(step, i, ("x%d" % i,), EU_A, US_A,
                             sourceList=[{"type": "possessing_party", "source": "urn:epc:id:pgln:400000%d.1" % i}]))
        events.append(ev("receiving", 9, ("y",), EU_A, US_A,
                         sourceList=[{"type": "owning_party", "source": "urn:epc:id:pgln:4000009.1"}]))
        self.assertEqual(self.supply_score_of(events), 85)

    def test_supply_separate_locations(self):
        events = self.suppliers(5)
        for event in events[3:]:
            event["bizLocation"] = {"id": US_B}
        self.assertEqual(self.supply_score_of(events), 0)

    def supply_score_of(self, events):
        tx = run(events)
        scores = [v["score"] for e in tx["events"] for v in e["violations"] if v["code"] == "SUPPLY_BASE_COMPLEXITY"]
        return max(scores) if scores else 0

    def test_location_mismatch_is_skipped(self):
        events = [ev("commissioning", 0, ("u1",), EU_A, EU_A),
                  ev("receiving", 10, ("u1",), EU_B, US_A, loc=US_A)]
        self.assertIn("SKIPPED_LIFECYCLE_STEP", codes(run(events)))


if __name__ == "__main__":
    unittest.main()
