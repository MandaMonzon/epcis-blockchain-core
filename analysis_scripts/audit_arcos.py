"""Audits an ARCOS-derived CSV and reports data quality problems.

Usage: python3 audit_arcos.py <csv file> [output.md]
Works on arcos_clean.csv and on scenario_template.csv (columns that are absent are skipped).
"""
import csv
import re
import sys
from collections import Counter
from datetime import date, datetime

DEA_PATTERN = re.compile(r'^[A-Z]{2}\d{7}$')
NDC_PATTERN = re.compile(r'^\d{11}$')
MIN_YEAR, MAX_YEAR = 2006, 2019
SAMPLE_SIZE = 3


class Check:
    def __init__(self, name, description):
        self.name = name
        self.description = description
        self.count = 0
        self.samples = []

    def add(self, line, value):
        self.count += 1
        if len(self.samples) < SAMPLE_SIZE:
            self.samples.append(f'line {line}: {value!r}')


def parse_date(text):
    try:
        return datetime.strptime(text, '%Y-%m-%d').date()
    except ValueError:
        return None


def parse_number(text):
    try:
        return float(text)
    except ValueError:
        return None


def audit(path):
    checks = {c.name: c for c in [
        Check('missing_transaction_id', 'Empty transaction_id (ARCOS form field left blank)'),
        Check('duplicate_transaction_id', 'transaction_id appearing in more than one row'),
        Check('invalid_reporter_id', 'reporter_id is not a DEA number (2 letters + 7 digits)'),
        Check('invalid_buyer_id', 'buyer_id is not a DEA number (2 letters + 7 digits)'),
        Check('same_reporter_and_buyer', 'Seller and buyer are the same DEA number'),
        Check('invalid_date', 'transaction_date is not a valid YYYY-MM-DD date'),
        Check('date_out_of_range', f'transaction_date outside {MIN_YEAR}-{MAX_YEAR}'),
        Check('invalid_drug_code', 'drug_code is not an 11-digit NDC'),
        Check('invalid_quantity', 'dosage_unit is not a positive number'),
        Check('non_integer_quantity', 'dosage_unit is not a whole number of units'),
        Check('invalid_weight', 'quantity_grams is not a positive number'),
    ]}
    ids = Counter()
    quantities = []
    rows = 0
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []
        for line, row in enumerate(reader, start=2):
            rows += 1
            tx = (row.get('transaction_id') or '').strip()
            if 'transaction_id' in columns:
                if not tx:
                    checks['missing_transaction_id'].add(line, tx)
                else:
                    ids[tx] += 1
            for column, name in (('reporter_id', 'invalid_reporter_id'), ('buyer_id', 'invalid_buyer_id')):
                if column in columns and not DEA_PATTERN.match((row.get(column) or '').strip()):
                    checks[name].add(line, row.get(column))
            if {'reporter_id', 'buyer_id'} <= set(columns) and row['reporter_id'].strip() == row['buyer_id'].strip():
                checks['same_reporter_and_buyer'].add(line, row['reporter_id'])
            if 'transaction_date' in columns:
                day = parse_date((row.get('transaction_date') or '').strip())
                if day is None:
                    checks['invalid_date'].add(line, row.get('transaction_date'))
                elif not MIN_YEAR <= day.year <= MAX_YEAR or day > date.today():
                    checks['date_out_of_range'].add(line, row.get('transaction_date'))
            if 'drug_code' in columns and not NDC_PATTERN.match((row.get('drug_code') or '').strip()):
                checks['invalid_drug_code'].add(line, row.get('drug_code'))
            if 'dosage_unit' in columns:
                q = parse_number((row.get('dosage_unit') or '').strip())
                if q is None or q <= 0:
                    checks['invalid_quantity'].add(line, row.get('dosage_unit'))
                else:
                    quantities.append(q)
                    if q != int(q):
                        checks['non_integer_quantity'].add(line, row.get('dosage_unit'))
            if 'quantity_grams' in columns:
                w = parse_number((row.get('quantity_grams') or '').strip())
                if w is None or w <= 0:
                    checks['invalid_weight'].add(line, row.get('quantity_grams'))
    for tx, n in ids.items():
        if n > 1:
            checks['duplicate_transaction_id'].count += n
            if len(checks['duplicate_transaction_id'].samples) < SAMPLE_SIZE:
                checks['duplicate_transaction_id'].samples.append(f'{tx!r} x{n}')
    return rows, columns, checks, quantities


def quantile(sorted_values, q):
    return sorted_values[min(len(sorted_values) - 1, int(q * len(sorted_values)))]


def render(path, rows, columns, checks, quantities):
    lines = [f'# ARCOS data audit: `{path}`', '', f'- Rows: {rows}', f'- Columns: {", ".join(columns)}', '',
             '| Check | Rows affected | % | Examples |', '|---|---|---|---|']
    for c in checks.values():
        pct = f'{100 * c.count / rows:.2f}%' if rows else 'n/a'
        lines.append(f'| {c.description} | {c.count} | {pct} | {"; ".join(c.samples) or "-"} |')
    if quantities:
        q = sorted(quantities)
        lines += ['', f'dosage_unit quantiles: min {q[0]:.0f}, median {quantile(q, .5):.0f}, '
                      f'p95 {quantile(q, .95):.0f}, p99 {quantile(q, .99):.0f}, max {q[-1]:.0f}']
    return '\n'.join(lines) + '\n'


def main():
    path = sys.argv[1]
    report = render(path, *audit(path))
    print(report)
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w') as f:
            f.write(report)


main()
