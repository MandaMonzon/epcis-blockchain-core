import math
from statistics import mean, stdev

Z_95 = 1.959963984540054


def wilson(successes, n, z=Z_95):
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def mean_sd(values):
    values = list(values)
    if not values:
        return (float("nan"), float("nan"))
    return (mean(values), stdev(values) if len(values) > 1 else 0.0)


def precision_recall_f1(tp, fp, fn):
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else float("nan")
    return precision, recall, f1


def ppv(recall, false_positive_rate, prevalence):
    true_positives = recall * prevalence
    false_positives = false_positive_rate * (1 - prevalence)
    return true_positives / (true_positives + false_positives) if true_positives + false_positives else float("nan")


def mcnemar_exact(only_a, only_b):
    discordant = only_a + only_b
    if discordant == 0:
        return {"p_value": 1.0, "odds_ratio": float("nan"), "discordant": 0}
    k = min(only_a, only_b)
    tail = sum(math.comb(discordant, i) for i in range(k + 1)) / 2 ** discordant
    odds_ratio = only_a / only_b if only_b else float("inf")
    return {"p_value": min(1.0, 2 * tail), "odds_ratio": odds_ratio, "discordant": discordant}


def fmt_ci(successes, n):
    low, high = wilson(successes, n)
    return f"{100 * successes / n:.1f}% [{100 * low:.1f}, {100 * high:.1f}]" if n else "n/a"
