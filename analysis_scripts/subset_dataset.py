"""Reduces a full EPCIS dataset to N drugs x K transactions per drug.

Usage: python3 subset_dataset.py <source dir> <target dir> [n_drugs=100] [per_drug=10]
Input and output: events.json + scenario_template.csv.
"""
import csv
import json
import os
import sys

src, dst = sys.argv[1], sys.argv[2]
n_drugs = int(sys.argv[3]) if len(sys.argv) > 3 else 100
per_drug = int(sys.argv[4]) if len(sys.argv) > 4 else 10

os.makedirs(dst, exist_ok=True)
with open(os.path.join(src, 'scenario_template.csv'), newline='') as f:
    reader = csv.DictReader(f)
    fields = reader.fieldnames
    rows = list(reader)

count, keep = {}, []
for r in rows:
    d = r['drug_code']
    if d not in count and len(count) >= n_drugs:
        continue
    if count.get(d, 0) < per_drug:
        count[d] = count.get(d, 0) + 1
        keep.append(r)
ids = {r['transaction_id'].strip() for r in keep}

with open(os.path.join(dst, 'scenario_template.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(keep)

with open(os.path.join(src, 'events.json')) as f:
    doc = json.load(f)
events = [e for e in doc['epcisBody']['eventList']
          if str((e.get('ilmd') or {}).get('cbvmda:transactionID', '')).strip() in ids]
doc['epcisBody']['eventList'] = events
with open(os.path.join(dst, 'events.json'), 'w') as f:
    json.dump(doc, f)

print(f'{len(count)} drugs, {len(keep)} transactions, {len(events)} events -> {dst}')
