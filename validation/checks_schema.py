import json
import urllib.request
from collections import Counter
from pathlib import Path

from . import checks_data as data

SCHEMA_URL = "https://raw.githubusercontent.com/gs1/EPCIS/master/EPCIS-JSON-Schema.json"
NAME = "Generated events validate against the official GS1 EPCIS 2.0 JSON Schema"


def load_schema(work, schema_path=None):
    if schema_path:
        return json.loads(Path(schema_path).read_text())
    cached = Path(work) / "EPCIS-JSON-Schema.json"
    if not cached.exists():
        with urllib.request.urlopen(SCHEMA_URL, timeout=60) as response:
            cached.write_bytes(response.read())
    return json.loads(cached.read_text())


def leaf_errors(error):
    """The innermost failures of a (possibly nested) schema error, which name the real cause."""
    if not error.context:
        return [error]
    return [leaf for child in error.context for leaf in leaf_errors(child)]


def summarise(errors, top=6):
    counts = Counter()
    for error in errors:
        for leaf in leaf_errors(error):
            where = "/".join(str(p) for p in list(leaf.absolute_path)[-2:])
            counts[(leaf.validator, where, leaf.message[:90])] += 1
    return "; ".join(f"{n}x {v} at {w}: {m}" for (v, w, m), n in counts.most_common(top))


def check_epcis_schema(events_path, work, schema_path=None):
    try:
        import jsonschema
    except ImportError:
        return data.result("20", NAME, False, "NOT RUN: python package `jsonschema` is not installed (pip install jsonschema)")
    try:
        schema = load_schema(work, schema_path)
    except Exception as error:
        return data.result("20", NAME, False, f"NOT RUN: could not load the GS1 schema ({str(error)[:120]}); "
                                              f"pass --epcis-schema <file> ({SCHEMA_URL})")
    document = json.loads(Path(events_path).read_text())
    errors = list(jsonschema.Draft7Validator(schema).iter_errors(document))
    count = len(document.get("epcisBody", {}).get("eventList", []))
    detail = f"{count} events checked against {schema.get('$id', 'the GS1 schema')}"
    if errors:
        detail += f"; {len(errors)} schema errors: {summarise(errors)}"
    return data.result("20", NAME, not errors, detail)
