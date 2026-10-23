import copy
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

from . import signatures as sig
from .checks_data import NORMAL_LABELS, result
from .pipeline_runner import (build_dataset, group_events, load_events, read_labels, score_with_chaincode,
                              transaction_of, write_events)

THRESHOLD = 70


def summary(tx):
    codes = {v["code"] for e in tx["events"] for v in e["violations"]} | {v["code"] for v in tx.get("audit_violations", [])}
    return (tx["flagged"], tx["score"], frozenset(codes))


def compare(base, other, mapping=None):
    mapping = mapping or {}
    differences, code_only = [], []
    for tx, value in base.items():
        counterpart = other.get(mapping.get(tx, tx))
        if counterpart is None:
            differences.append((tx, summary(value), None))
        elif summary(counterpart)[:2] != summary(value)[:2]:
            differences.append((tx, summary(value), summary(counterpart)))
        elif summary(counterpart) != summary(value):
            code_only.append(tx)
    missing = len(set(base) ^ set(other)) if not mapping else abs(len(base) - len(other))
    return differences, missing, code_only


def has_shrinkable_aggregation(lot):
    return any(e["type"] == "AggregationEvent" and e["action"] == "DELETE" and len(e["childEPCs"]) >= 2 for e in lot)


def sample_lots(groups, labels, wanted, per_type):
    pool = sorted(tx for tx in groups if labels[tx] == "none")
    used, chosen = set(), {}
    for kind in sorted(wanted, key=lambda k: k != "quantity_mismatch"):
        eligible = [tx for tx in pool if tx not in used and (kind != "quantity_mismatch" or has_shrinkable_aggregation(groups[tx]))]
        chosen[kind] = eligible[:per_type]
        used.update(chosen[kind])
    return {kind: chosen[kind] for kind in wanted}


def check_mutation_matrix(groups, labels, work, per_type=20):
    chosen = sample_lots(groups, labels, list(sig.MUTATORS), per_type)
    events, expected_by_tx = [], {}
    signature_failures = []
    for kind, txs in chosen.items():
        for tx in txs:
            lot = sig.MUTATORS[kind](copy.deepcopy(groups[tx]))
            found = sig.signatures(lot)
            if found != {kind}:
                signature_failures.append((kind, tx, sorted(found)))
            events.extend(lot)
            expected_by_tx[tx] = kind
    path = Path(work) / "mutated_events.json"
    write_events(events, path)
    scores = score_with_chaincode(path, Path(work) / "mutated_scores.json")
    matrix = defaultdict(Counter)
    failures = []
    for tx, kind in expected_by_tx.items():
        codes = {sig.canonical_code(v["code"]): v["score"] for e in scores[tx]["events"] for v in e["violations"]}
        for v in scores[tx].get("audit_violations", []):
            codes[sig.canonical_code(v["code"])] = v["score"]
        deciding = {c for c, s in codes.items() if s >= THRESHOLD}
        for c in codes:
            matrix[kind][c] += 1
        expected = sig.EXPECTED_CODE[kind]
        if expected is None:
            ok = not scores[tx]["flagged"]
        else:
            ok = expected in deciding and deciding == {expected}
        if not ok:
            failures.append((kind, tx, sorted(deciding)))
    lines = [f"{kind}: n={len(chosen[kind])}, codes fired={dict(matrix[kind])}" for kind in chosen]
    return result("7", "Mutation: one known mutation on normal lots fires the expected rule and no other rule >= 70",
                  not failures and not signature_failures,
                  f"{len(expected_by_tx)} mutated lots; failures={len(failures)} {failures[:3]}; "
                  f"mutations not recognised by the independent signatures={len(signature_failures)}"), \
        {"matrix": {k: dict(v) for k, v in matrix.items()}, "lines": lines, "failures": failures}


def check_shuffle(events, base_scores, work, seed=11):
    shuffled = list(events)
    random.Random(seed).shuffle(shuffled)
    path = Path(work) / "shuffled_events.json"
    write_events(shuffled, path)
    other = score_with_chaincode(path, Path(work) / "shuffled_scores.json")
    differences, missing, code_only = compare(base_scores, other)
    return result("10", "Metamorphic: shuffling event arrival order does not change any transaction result",
                  not differences and not missing,
                  f"{len(base_scores)} transactions compared (flag, max score); differences={len(differences)} {differences[:2]}; "
                  f"transactions with the same result but a different set of fired codes={len(code_only)}")


class Renamer:
    def __init__(self):
        self.tables = defaultdict(dict)

    def pick(self, table, value, make):
        t = self.tables[table]
        if value not in t:
            t[value] = make(len(t))
        return t[value]

    def text(self, value):
        value = re.sub(r"us\.dea\.([A-Z0-9]+)", lambda m: "us.dea." + self.pick("dea", m.group(1), lambda n: f"ZQ{n:07d}"), value)
        value = re.sub(r"(urn:epc:id:sgtin:\d+\.\d+\.)(\d+)",
                       lambda m: m.group(1) + self.pick("serial", m.group(2), lambda n: f"9{n:011d}"), value)
        value = re.sub(r"(urn:epc:id:sscc:\d+\.)([0-9a-f]+)",
                       lambda m: m.group(1) + self.pick("sscc", m.group(2), lambda n: f"b{n:015x}"), value)
        value = re.sub(r"(urn:epc:id:gdti:\d+\.\d+\.)(\d+)(\.0)",
                       lambda m: m.group(1) + self.pick("gdti", m.group(2), lambda n: f"8{n:08d}") + m.group(3), value)
        if value.startswith("urn:uuid:"):
            value = "urn:uuid:" + self.pick("event", value, lambda n: hashlib.md5(f"renamed-{n}".encode()).hexdigest())
        return value

    def node(self, node):
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k in ("cbvmda:transactionID", "cbvmda:lotNumber") and isinstance(v, str):
                    out[k] = self.pick(k, v.strip(), lambda n, k=k: f"{'TX' if 'trans' in k else 'LOT'}{n:07d}")
                else:
                    out[k] = self.node(v)
            return out
        if isinstance(node, list):
            return [self.node(v) for v in node]
        if isinstance(node, str):
            return self.text(node)
        return node


def check_rename(events, base_scores, work):
    renamer = Renamer()
    renamed = [renamer.node(e) for e in events]
    path = Path(work) / "renamed_events.json"
    write_events(renamed, path)
    other = score_with_chaincode(path, Path(work) / "renamed_scores.json")
    mapping = {tx.strip(): renamer.tables["cbvmda:transactionID"].get(tx.strip(), tx) for tx in base_scores}
    differences, missing, code_only = compare(base_scores, other, mapping)
    return result("11", "Metamorphic: consistently renaming ids (events, units, lots, parties) does not change any result",
                  not differences and not missing,
                  f"{len(base_scores)} transactions compared; ids renamed={sum(len(t) for t in renamer.tables.values())}; "
                  f"differences={len(differences)} {differences[:2]}; code-set-only differences={len(code_only)}")


def check_scale(clean_csv, work, seed, sample_per_drug, base_scores, factor=3):
    scaled = build_dataset(clean_csv, Path(work) / f"scaled_x{factor}", seed, sample_per_drug, scale=factor)
    other = score_with_chaincode(scaled["events"], Path(work) / f"scaled_x{factor}" / "scores.json")
    differences, missing, code_only = compare(base_scores, other)
    units = sum(len(e.get("epcList", [])) for e in load_events(scaled["events"]) if e["type"] == "ObjectEvent")
    return result("12", f"Metamorphic: scaling every quantity by k={factor} does not change any result",
                  not differences and not missing,
                  f"{len(base_scores)} transactions compared; object-event units at x{factor}={units}; "
                  f"differences={len(differences)} {differences[:2]}; code-set-only differences={len(code_only)}")


def check_all_normal(clean_csv, work, seed, sample_per_drug):
    dataset = build_dataset(clean_csv, Path(work) / "all_normal", seed, sample_per_drug, cycle=["none"])
    scores = score_with_chaincode(dataset["events"], Path(work) / "all_normal" / "scores.json")
    labels = read_labels(dataset["scenario"])
    false_positives = [tx for tx, s in scores.items() if s["flagged"]]
    explained = Counter()
    for tx in false_positives:
        explained.update({v["code"] for e in scores[tx]["events"] for v in e["violations"] if v["score"] >= THRESHOLD})
    only_none = set(labels.values()) == {"none"}
    return result("13", "100% normal dataset: false positive rate is 0 (every false positive explained)",
                  only_none and not false_positives,
                  f"{len(scores)} transactions, all labeled none={only_none}; false positives={len(false_positives)} "
                  f"codes={dict(explained)}")
