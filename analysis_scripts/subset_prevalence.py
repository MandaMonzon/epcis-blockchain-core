"""Builds a dataset with a controlled anomaly prevalence (e.g. 1%).

Usage: python3 subset_prevalence.py <source dir> <target dir> [rate=0.01] [seed=42]
Keeps every normal transaction (none/recalled) and samples anomalies until the rate is reached.
"""
import csv
import json
import os
import random
import sys

src, dst = sys.argv[1], sys.argv[2]
rate = float(sys.argv[3]) if len(sys.argv) > 3 else 0.01
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 42
NEG = {'none', 'recalled'}

os.makedirs(dst, exist_ok=True)
with open(os.path.join(src, 'scenario_template.csv'), newline='') as f:
    reader = csv.DictReader(f)
    fields = reader.fieldnames
    rows = list(reader)

neg = [r for r in rows if r['anomaly_type'] in NEG]
pos = [r for r in rows if r['anomaly_type'] not in NEG]
n_pos = min(len(pos), round(rate * len(neg) / (1 - rate)))
random.Random(seed).shuffle(pos)
keep = neg + pos[:n_pos]
ids = {r['transaction_id'].strip() for r in keep}

with open(os.path.join(dst, 'scenario_template.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(keep)

with open(os.path.join(src, 'events.json')) as f:
    doc = json.load(f)
events = [e for e in doc['epcisBody']['eventList']
          if str((e.get('ilmd') or {}).get('cbvmda:transactionID') or e.get('arcos:transactionID', '')).strip() in ids]
doc['epcisBody']['eventList'] = events
with open(os.path.join(dst, 'events.json'), 'w') as f:
    json.dump(doc, f)

print(f'{len(neg)} normal + {n_pos} anomalous = {len(keep)} transactions '
      f'(prevalence {n_pos / len(keep):.2%}), {len(events)} events -> {dst}')
