import unittest

from summarize_run import percentile, summarize_round


class SummarizeRunTest(unittest.TestCase):
    def test_percentile_nearest_rank(self):
        self.assertEqual(percentile(list(range(1, 101)), 0.95), 95)
        self.assertIsNone(percentile([], 0.5))

    def test_rejection_by_design_is_not_a_system_error(self):
        records = [
            {"outcome": "committed", "latencyMs": 100, "riskScore": 80, "retries": 0},
            {"outcome": "committed", "latencyMs": 300, "riskScore": 10, "retries": 1},
            {"outcome": "rejected", "latencyMs": 50, "retries": 0},
            {"outcome": "error", "latencyMs": 900, "retries": 3},
        ]
        row = summarize_round(records)
        self.assertEqual((row["committed"], row["rejected_by_design"], row["system_errors"]), (2, 1, 1))
        self.assertEqual(row["success_rate"], 0.75)
        self.assertEqual(row["flagged"], 1)
        self.assertEqual(row["retried"], 2)
        self.assertEqual(row["p99_ms"], 300)


if __name__ == "__main__":
    unittest.main()
