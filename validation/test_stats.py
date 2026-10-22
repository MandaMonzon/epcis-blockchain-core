import math
import unittest

from . import stats


class WilsonTest(unittest.TestCase):
    def test_known_interval(self):
        low, high = stats.wilson(8, 10)
        self.assertAlmostEqual(low, 0.4902, places=3)
        self.assertAlmostEqual(high, 0.9433, places=3)

    def test_perfect_score_keeps_upper_bound_at_one_and_lower_below_one(self):
        low, high = stats.wilson(30, 30)
        self.assertAlmostEqual(high, 1.0)
        self.assertLess(low, 1.0)
        self.assertAlmostEqual(low, 0.8864, places=3)

    def test_zero_successes(self):
        low, high = stats.wilson(0, 30)
        self.assertEqual(low, 0.0)
        self.assertAlmostEqual(high, 0.1136, places=3)

    def test_empty_sample_is_uninformative(self):
        self.assertEqual(stats.wilson(0, 0), (0.0, 1.0))


class McNemarTest(unittest.TestCase):
    def test_symmetric_discordance_is_not_significant(self):
        self.assertEqual(stats.mcnemar_exact(5, 5)["p_value"], 1.0)

    def test_known_exact_p_value(self):
        self.assertAlmostEqual(stats.mcnemar_exact(0, 10)["p_value"], 2 / 1024)

    def test_no_discordant_pairs(self):
        self.assertEqual(stats.mcnemar_exact(0, 0)["p_value"], 1.0)

    def test_odds_ratio(self):
        self.assertEqual(stats.mcnemar_exact(9, 3)["odds_ratio"], 3.0)
        self.assertTrue(math.isinf(stats.mcnemar_exact(4, 0)["odds_ratio"]))


class PpvTest(unittest.TestCase):
    def test_bayes_formula(self):
        self.assertAlmostEqual(stats.ppv(0.9, 0.05, 0.01), 0.009 / (0.009 + 0.0495))

    def test_zero_false_positive_rate_gives_certainty(self):
        self.assertEqual(stats.ppv(0.8, 0.0, 0.01), 1.0)

    def test_rises_with_prevalence(self):
        values = [stats.ppv(0.9, 0.02, p) for p in (0.01, 0.05, 0.10)]
        self.assertEqual(values, sorted(values))


class ScoresTest(unittest.TestCase):
    def test_precision_recall_f1(self):
        self.assertEqual(stats.precision_recall_f1(8, 2, 2), (0.8, 0.8, 0.8))

    def test_undefined_when_no_positives(self):
        precision, recall, f1 = stats.precision_recall_f1(0, 0, 0)
        self.assertTrue(math.isnan(precision) and math.isnan(recall) and math.isnan(f1))

    def test_mean_sd(self):
        mean, sd = stats.mean_sd([2, 4, 4, 4, 5, 5, 7, 9])
        self.assertEqual(mean, 5)
        self.assertAlmostEqual(sd, 2.138, places=3)


if __name__ == "__main__":
    unittest.main()
