import gzip
import random
import string

HEADER = ["reporter_dea_no", "buyer_dea_no", "transaction_date", "ndc_no",
          "calc_base_wt_in_gm", "quantity", "order_form_no"]

DEFECTS = ("missing_buyer", "bad_date", "bad_ndc", "bad_quantity")


def dea(rng):
    return "".join(rng.choices(string.ascii_uppercase, k=2)) + "".join(rng.choices(string.digits, k=7))


def write_synthetic_raw(path, drugs=100, rows_per_drug=40, defect_every=37, seed=7):
    rng = random.Random(seed)
    reporters = [dea(rng) for _ in range(30)]
    buyers = [dea(rng) for _ in range(300)]
    ndcs = [f"{rng.randint(10_000_000_000, 99_999_999_999)}" for _ in range(drugs)]
    injected = {name: 0 for name in DEFECTS}
    total = 0
    with gzip.open(path, "wt", encoding="utf-8") as out:
        out.write("\t".join(HEADER) + "\n")
        for ndc in ndcs:
            for _ in range(rows_per_drug):
                total += 1
                row = {
                    "reporter_dea_no": rng.choice(reporters),
                    "buyer_dea_no": rng.choice(buyers),
                    "transaction_date": f"{rng.randint(2006, 2014)}{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}",
                    "ndc_no": ndc,
                    "calc_base_wt_in_gm": f"{rng.uniform(1, 500):.2f}",
                    "quantity": str(rng.choice([1, 2, 5, 10, 30, 60, 100, 200, 1200])),
                    "order_form_no": str(rng.randint(1000, 9_999_999)) if rng.random() < 0.5 else "",
                }
                if total % defect_every == 0:
                    defect = DEFECTS[(total // defect_every) % len(DEFECTS)]
                    injected[defect] += 1
                    if defect == "missing_buyer":
                        row["buyer_dea_no"] = ""
                    elif defect == "bad_date":
                        row["transaction_date"] = "31/31/2010"
                    elif defect == "bad_ndc":
                        row["ndc_no"] = "NOT-AN-NDC"
                    else:
                        row["quantity"] = "0"
                out.write("\t".join(row[c] for c in HEADER) + "\n")
    return {"rows_written": total, "injected_defects": injected}
