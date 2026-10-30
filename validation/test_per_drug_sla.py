import unittest

from . import per_drug_sla as sla


def row(tx, label, flagged):
    return {"tx": tx, "label": label, "positive": label not in ("none", "recalled"), "flagged": flagged}


class PerDrugSlaTest(unittest.TestCase):
    def setUp(self):
        self.drugs = {f"t{i}": "A" for i in range(10)}
        self.drugs.update({f"u{i}": "B" for i in range(10)})
        self.drugs.update({"n1": "A", "n2": "B", "c1": "C"})
        self.rows = ([row(f"t{i}", "jurisdiction", True) for i in range(10)]
                     + [row(f"u{i}", "out_of_order", i < 8) for i in range(10)]
                     + [row("n1", "none", True), row("n2", "none", False), row("c1", "none", False)])
        self.table = {r["drug_code"]: r for r in sla.per_drug_table(self.rows, self.drugs)}

    def test_rate_and_pass_flag(self):
        self.assertEqual(self.table["A"]["detection_rate"], 1.0)
        self.assertTrue(self.table["A"]["passes"])
        self.assertEqual(self.table["B"]["detection_rate"], 0.8)
        self.assertFalse(self.table["B"]["passes"])

    def test_exactly_at_cutoff_passes(self):
        rows = [row(f"t{i}", "jurisdiction", i < 9) for i in range(10)]
        table = sla.per_drug_table(rows, {f"t{i}": "A" for i in range(10)})
        self.assertEqual(table[0]["detection_rate"], 0.9)
        self.assertTrue(table[0]["passes"])
        self.assertFalse(table[0]["passes_confident"])

    def test_false_positives_are_reported_not_counted_as_detection(self):
        self.assertEqual((self.table["A"]["normal"], self.table["A"]["false_positives"]), (1, 1))
        self.assertEqual(self.table["A"]["detected"], 10)

    def test_drug_without_anomalies_is_not_evaluable(self):
        self.assertIsNone(self.table["C"]["passes"])
        summary = sla.summarize(list(self.table.values()))
        self.assertEqual((summary["drugs"], summary["evaluable"], summary["passing"]), (3, 2, 1))

    def test_missed_types_attribute_failures(self):
        self.assertEqual(self.table["B"]["missed_types"], "out_of_order:2")
        self.assertEqual(sla.summarize(list(self.table.values()))["failing_types"]["out_of_order"], 1)


if __name__ == "__main__":
    unittest.main()
