# Roda no node003, dentro de cada RUN_*/, apos o benchmark. Gera ~/lote_scores_summary.json com ID de lote (SGTIN) + regra disparada por rodada.
import json, glob, os, collections
scales = ["d100_e1000","d1000_e1000","d1000_e10000"]
base = os.path.expanduser("~/Workspace/blockchain-research/RUN_2026-09-27_multiscale")
out = {}
for sc in scales:
    d = os.path.join(base, sc, "round_scores_raw")
    per_epc = collections.defaultdict(dict)
    rules_by_epc = collections.defaultdict(dict)
    for fp in glob.glob(os.path.join(d, "*.jsonl")):
        with open(fp) as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                epc, rnd = r.get("epc"), r.get("roundIndex")
                score = r.get("riskScore")
                if score is None: score = 0
                rules = r.get("triggeredRules") or []
                if epc is None or rnd is None: continue
                if score > per_epc[epc].get(rnd, -1):
                    per_epc[epc][rnd] = score
                    rules_by_epc[epc][rnd] = rules
    rows = []
    for epc, rounds in per_epc.items():
        vals = list(rounds.values())
        if not vals: continue
        rows.append({"epc": epc, "rounds": rounds, "rules": rules_by_epc[epc], "variacao": max(vals)-min(vals)})
    rows.sort(key=lambda x: -x["variacao"])
    out[sc] = rows[:20]
json.dump(out, open(os.path.expanduser("~/lote_scores_summary.json"), "w"))
print("OK", {k: len(v) for k,v in out.items()})
