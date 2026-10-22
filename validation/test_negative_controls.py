import csv
import tempfile
import unittest
from pathlib import Path

from . import checks_data as data

STEPS = ["commissioning", "packing", "shipping", "receiving"]


def lot(tx, times=None, received_twice=False):
    times = times or ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z", "2024-01-08T00:00:00Z"]
    events = [{"type": "ObjectEvent", "eventID": f"{tx}-{step}", "bizStep": step, "eventTime": time,
               "epcList": [f"urn:epc:id:sgtin:{tx}.1"]} for step, time in zip(STEPS, times)]
    if received_twice:
        events.append({**events[-1], "eventID": f"{tx}-receiving-2"})
    return events


def scenario_csv(rows):
    handle = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="")
    writer = csv.writer(handle)
    writer.writerow(["transaction_id", "dosage_unit"])
    writer.writerows(rows)
    handle.close()
    return Path(handle.name)


class NegativeControlTest(unittest.TestCase):
    def test_clean_data_passes_each_check(self):
        csv_path = scenario_csv([("T1", 1)])
        events = lot("T1")
        self.assertTrue(data.check_unique_ids_and_quantities(events, csv_path)["passed"])
        self.assertTrue(data.check_conservation({"T1": events}, {"T1": "none"}, csv_path, 10)["passed"])

    def test_duplicate_event_id_fails_item_1(self):
        events = lot("T1") + [lot("T1")[0]]
        self.assertFalse(data.check_unique_ids_and_quantities(events, scenario_csv([("T1", 1)]))["passed"])

    def test_non_positive_dosage_fails_item_1(self):
        self.assertFalse(data.check_unique_ids_and_quantities(lot("T1"), scenario_csv([("T1", 0)]))["passed"])

    def test_explicit_negative_quantity_fails_item_1(self):
        events = lot("T1")
        events[0]["quantity"] = -4
        self.assertFalse(data.check_unique_ids_and_quantities(events, scenario_csv([("T1", 1)]))["passed"])

    def test_date_inversion_in_a_normal_lot_is_detected(self):
        swapped = lot("T1", ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-09T00:00:00Z", "2024-01-08T00:00:00Z"])
        self.assertTrue(data.unit_inversions(swapped))
        self.assertFalse(data.check_date_order({"T1": swapped}, {"T1": "none"})["passed"])

    def test_ordered_lot_has_no_inversion(self):
        self.assertFalse(data.unit_inversions(lot("T1")))

    def test_over_received_normal_lot_fails_item_3(self):
        events = lot("T1", received_twice=True)
        self.assertFalse(data.check_conservation({"T1": events}, {"T1": "none"}, scenario_csv([("T1", 1)]), 10)["passed"])

    def test_wrong_unit_count_fails_item_3(self):
        self.assertFalse(data.check_conservation({"T1": lot("T1")}, {"T1": "none"}, scenario_csv([("T1", 3)]), 10)["passed"])


if __name__ == "__main__":
    unittest.main()
