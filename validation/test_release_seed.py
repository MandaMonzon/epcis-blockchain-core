import unittest

from . import checks_stats as st
from .run_validation import release_seed


def scores(flag):
    return {"tx1": {"flagged": flag, "events": [], "audit_violations": []}}


def seed(n, flag=False, oracle_flag=False):
    return {"seed": n, "chaincode": scores(flag), "oracle": scores(oracle_flag), "labels": {"tx1": "normal"}}


class ReleaseSeedTest(unittest.TestCase):
    def test_later_seeds_drop_full_scores_but_keep_the_oracle_check_inputs(self):
        s = seed(2)
        release_seed(s)
        self.assertIsNone(s["chaincode"])
        self.assertIsNone(s["oracle"])
        self.assertIsNone(s["labels"])
        self.assertEqual((s["n_tx"], s["n_labels"]), (1, 1))

    def test_first_seed_keeps_scores_for_mutation_mcnemar_and_network_checks(self):
        s = seed(1)
        release_seed(s)
        self.assertIn("tx1", s["chaincode"])
        self.assertIn("tx1", s["oracle"])

    def test_oracle_disagreement_is_still_reported_after_release(self):
        seeds = [seed(1, flag=True, oracle_flag=False), seed(2, flag=True, oracle_flag=False)]
        for s in seeds:
            release_seed(s)
        result = st.check_oracle(seeds)
        self.assertFalse(result["passed"])
        self.assertIn("flag disagreements=2", result["detail"])
        self.assertIn("2 seeds, 2 transactions", result["detail"])


if __name__ == "__main__":
    unittest.main()
