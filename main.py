"""gta6-trophy-rarity-forecast-01: trend-aware, damped logit forecaster.

Keeps the starter's I/O contract and helpers, but forecasts each trophy on the
logit scale using its recent growth, a saturation damping factor and a spread
that combines a random walk, trend-fit uncertainty and an irreducible floor.

Damping 1/(1+0.75*d) models earn-rate curve saturation over the first week; spread combines random walk, trend-fit residual and an irreducible floor.
"""

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# The grader's -P leaves /bot off sys.path: put it back first, so `import model` finds a model.py shipped beside this file.
sys.path.insert(0, str(Path(__file__).resolve().parent))

INPUT_DIR = Path(os.environ.get("MAKEFUN_INPUT_DIR", "/input"))
OUTPUT_DIR = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))

# The quantile levels the contest scores, in the order each row lists them.
LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95]
# The standard normal's quantile at each level.
Z = [-1.645, -0.674, 0, 0.674, 1.645]
# The spread of a rate's move, in logit units per square-root day.
SIGMA = 0.5


def clamp(x: float) -> float:
    return min(99.99, max(0.01, x))


def logit(pct: float) -> float:
    return math.log(clamp(pct) / (100 - clamp(pct)))


def round4(x: float) -> float | int:
    """x rounded to 4 decimals, half up, as JavaScript's Math.round(x * 10000) / 10000 rounds it.

    A whole number comes back as an int, so json.dumps writes 100 where JavaScript writes 100 (not 100.0).
    """
    scaled = x * 10000
    whole = math.floor(scaled)
    if scaled - whole >= 0.5:
        whole += 1
    value = whole / 10000
    return int(value) if value.is_integer() else value


def parse_at(value: str) -> datetime:
    """Parse an ISO 8601 UTC timestamp, including fractional seconds and trailing Z."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def fit_line(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Least-squares slope of y against t (days) and residual std; None if t has no spread."""
    n = len(points)
    if n < 2:
        return None
    t_bar = sum(t for t, _ in points) / n
    y_bar = sum(y for _, y in points) / n
    denom = sum((t - t_bar) ** 2 for t, _ in points)
    if denom <= 0:
        return None
    slope = sum((t - t_bar) * (y - y_bar) for t, y in points) / denom
    fitted_slope = min(4.0, max(-2.0, slope))
    if n < 3:
        residual_std = 0.0
    else:
        residuals = [y - (y_bar + slope * (t - t_bar)) for t, y in points]
        residual_std = math.sqrt(sum(r * r for r in residuals) / n)
    return fitted_slope, residual_std


def growth(points: list[tuple[float, float]], latest: float) -> tuple[float, float]:
    """Recent logit growth per day and residual std, widening the window only if the recent one is flat."""
    for window in (1.0, 3.0):
        recent = [(t, y) for t, y in points if t >= latest - window]
        if len({y for _, y in recent}) >= 2:
            fit = fit_line(recent)
            if fit is not None:
                return fit
    return 0.0, 0.0


def baseline_forecast(case: dict, name: str) -> dict:
    """Exactly the starter's baseline forecast for a case."""
    if case["levels"] != LEVELS:
        raise ValueError(f"{name} asks for levels {case['levels']}, not {LEVELS}")
    if not case["history"]:
        raise ValueError(f"{name} has no history")
    last = case["history"][-1]
    spread = SIGMA * math.sqrt(case["horizon_minutes"] / 1440)
    rows = []
    for i, trophy in enumerate(case["trophies"]):
        rate = last["rates"][i]
        lg = logit(rate if rate is not None else 0)
        rows.append({"id": trophy["id"], "q": [round4(100 / (1 + math.exp(-(lg + z * spread)))) for z in Z]})
    return {"trophies": rows}


def safe_baseline(case: dict, name: str) -> dict:
    try:
        return baseline_forecast(case, name)
    except Exception:
        return {"trophies": [{"id": trophy.get("id"), "q": [0.01, 0.01, 0.01, 0.01, 0.01]}
                             for trophy in case.get("trophies", [])]}


def improved_forecast(case: dict, name: str) -> dict:
    if case["levels"] != LEVELS:
        raise ValueError(f"{name} asks for levels {case['levels']}, not {LEVELS}")
    history = case["history"]
    if not history:
        raise ValueError(f"{name} has no history")

    horizon_days = case["horizon_minutes"] / 1440
    damp = 1 / (1 + 0.75 * horizon_days)
    start = parse_at(history[0]["at"])
    timed = [(parse_at(read["at"]), read.get("rates", [])) for read in history]
    latest = max(moment for moment, _ in timed)

    rows = []
    for i, trophy in enumerate(case["trophies"]):
        last_rate = None
        points = []
        for moment, rates in timed:
            rate = rates[i] if i < len(rates) else None
            if rate is None:
                continue
            last_rate = rate
            t = (moment - start).total_seconds() / 86400
            points.append((t, logit(rate)))

        if last_rate is None:
            rows.append({"id": trophy["id"], "q": [0.01, 0.01, 0.01, 0.01, 0.01]})
            continue

        latest_days = (latest - start).total_seconds() / 86400
        g, r_std = growth(points, latest_days)
        g_eff = g * damp

        lg_last = logit(last_rate)
        median = clamp(100 / (1 + math.exp(-(lg_last + g_eff * horizon_days))))
        sigma = math.sqrt(0.25 * horizon_days + (0.6 * r_std) ** 2 + 0.15)
        sigma = min(3.0, max(0.15, sigma))

        median_lg = logit(median)
        quantiles = []
        for z in Z:
            q = clamp(100 / (1 + math.exp(-(median_lg + z * sigma))))
            quantiles.append(round4(q))
        quantiles.sort()
        rows.append({"id": trophy["id"], "q": quantiles})

    return {"trophies": rows}


def forecast_case(case: dict, name: str) -> dict:
    try:
        return improved_forecast(case, name)
    except Exception:
        return safe_baseline(case, name)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    # Every case file, in name order, so two runs write the same bytes.
    for path in sorted(INPUT_DIR.glob("*.in")):
        case = json.loads(path.read_text(encoding="utf-8"))
        forecast = forecast_case(case, path.name)
        (OUTPUT_DIR / f"{path.stem}.out").write_text(json.dumps(forecast, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
