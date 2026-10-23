import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = Path(os.environ.get("VALIDATION_GENERATOR", ROOT.parent / "epcis-arcos-etl-generator")).resolve()
CHAINCODE_DIR = ROOT / "epcis-fraud-logistic-diversion"
sys.path.insert(0, str(GENERATOR))

from pipeline.extract import extract  # noqa: E402
from pipeline.load import convert_scenario  # noqa: E402
from pipeline.transform import build_scenario  # noqa: E402

UNIT_CAP = 10


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def extract_clean(raw_path, out_dir, limit=None, sample_rows=None, seed=0):
    clean = Path(out_dir) / "arcos_clean.csv"
    return clean, extract(str(raw_path), str(clean), limit=limit, sample_size=sample_rows, seed=seed)


def build_dataset(clean_csv, out_dir, seed, sample_per_drug, cycle=None, scale=1):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scenario = out / "scenario_template.csv"
    events = out / "events.json"
    scenario_result = build_scenario(str(clean_csv), str(scenario), sample_per_drug=sample_per_drug,
                                     balanced=True, seed=seed, cycle=cycle)
    source = scenario
    if scale != 1:
        source = out / "scenario_scaled.csv"
        scale_quantities(scenario, source, scale)
    convert_result = convert_scenario(str(source), str(events), max_units_per_lot=UNIT_CAP * scale)
    return {"dir": out, "scenario": scenario, "events": events,
            "scenario_result": scenario_result, "convert_result": convert_result}


def scale_quantities(src, dst, factor):
    import csv
    with open(src, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fields = reader.fieldnames
    for row in rows:
        row["dosage_unit"] = str(int(float(row["dosage_unit"])) * factor)
    with open(dst, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def load_events(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))["epcisBody"]["eventList"]


def write_events(events, path):
    document = {"@context": ["https://ref.gs1.org/standards/epcis/epcis-context.jsonld"],
                "type": "EPCISDocument", "schemaVersion": "2.0",
                "creationDate": "1970-01-01T00:00:00Z", "epcisBody": {"eventList": events}}
    Path(path).write_text(json.dumps(document), encoding="utf-8")


def score_with_chaincode(events_path, out_path, chaincode_dir=None):
    command = ["node", str(ROOT / "validation" / "chaincode_scores.js"), str(events_path), str(out_path)]
    if chaincode_dir:
        command += ["--chaincode", str(chaincode_dir)]
    subprocess.run(command, check=True, capture_output=True, text=True)
    return {t["transaction_id"]: t for t in json.loads(Path(out_path).read_text())["transactions"]}


def score_with_oracle(events_path, out_path):
    subprocess.run([sys.executable, str(ROOT / "validation" / "oracle.py"), str(events_path), "--out", str(out_path)],
                   check=True, capture_output=True, text=True)
    return {t["transaction_id"]: t for t in json.loads(Path(out_path).read_text())["transactions"]}


def read_labels(scenario_csv):
    import csv
    with open(scenario_csv, newline="", encoding="utf-8") as f:
        return {r["transaction_id"].strip(): r["anomaly_type"] for r in csv.DictReader(f)}


def transaction_of(event):
    return str(event.get("ilmd", {}).get("cbvmda:transactionID", "")).strip()


def group_events(events):
    groups = {}
    for event in events:
        groups.setdefault(transaction_of(event), []).append(event)
    return groups


def temp_dir(prefix):
    return tempfile.mkdtemp(prefix=prefix)
