"""Read-only access to the accepted C7 model-validation artifacts."""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import statistics
from datetime import date
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

import pyarrow.parquet as parquet
from fastapi import APIRouter, HTTPException, Query, Request


router = APIRouter(prefix="/ml/c7", tags=["C7 ML model analysis"])

MANIFEST_RELATIVE_PATH = Path("artifacts/models/c7/MODEL_MANIFEST.json")
IMPORTANCE_RELATIVE_PATH = Path("artifacts/models/c7/feature_importance.parquet")
PREDICTIONS_RELATIVE_PATH = Path("artifacts/predictions/c7/validation_predictions.parquet")
EXPECTED_FILES = {
    "manifest": MANIFEST_RELATIVE_PATH,
    "importance": IMPORTANCE_RELATIVE_PATH,
    "predictions": PREDICTIONS_RELATIVE_PATH,
}
EXPECTED_PREDICTION_SCHEMA = {
    "trade_date": "string",
    "symbol": "string",
    "fold_id": "string",
    "split_role": "string",
    "universe_name": "string",
    "target_name": "string",
    "target": "double",
    "prediction": "double",
    "prediction_probability": "double",
    "model_name": "string",
    "model_version": "int64",
    "device": "string",
}
EXPECTED_IMPORTANCE_SCHEMA = {
    "target_name": "string",
    "fold_id": "string",
    "model_name": "string",
    "feature": "string",
    "gain_importance": "double",
    "split_importance": "double",
    "permutation_importance": "double",
}
FOLDS = ("fold_2023", "fold_2024", "fold_2025")
IMPORTANCE_MODELS = ("lightgbm_cpu", "xgboost_gpu")
OVERVIEW_METRICS = (
    "mean_daily_ic",
    "median_daily_ic",
    "positive_ic_fraction",
    "spearman",
    "quantile_spread",
    "rmse",
    "mae",
    "roc_auc",
    "log_loss",
    "brier_score",
)
INTERVAL_METRICS = ("mean_daily_ic", "spearman", "quantile_spread", "roc_auc")
CONCLUSION = (
    "Nonlinear models found weak ranking structure, especially at 5–10 sessions, "
    "but results were not stable enough to establish a practical model. No profitability claim is made."
)


class ArtifactUnavailable(RuntimeError):
    """Raised when the accepted C7 source cannot be safely served."""


def _safe_value(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _safe_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_safe_value(item) for item in value]
    return value


def _artifact_root() -> Path:
    configured = os.environ.get("PSX_ML_C7_ROOT")
    if not configured:
        raise ArtifactUnavailable("C7 model artifacts are not configured")
    root = Path(configured).expanduser().resolve()
    if not root.is_dir():
        raise ArtifactUnavailable("C7 model artifacts are unavailable")
    return root


def _artifact_paths(root: Path) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for name, relative in EXPECTED_FILES.items():
        candidate = (root / relative).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            raise ArtifactUnavailable("C7 model artifacts are unavailable")
        paths[name] = candidate
    return paths


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_schema(path: Path, expected: dict[str, str]) -> parquet.ParquetFile:
    try:
        source = parquet.ParquetFile(path)
    except Exception as error:
        raise ArtifactUnavailable("C7 model artifacts are invalid") from error
    actual = {field.name: str(field.type) for field in source.schema_arrow}
    if actual != expected:
        raise ArtifactUnavailable("C7 model artifact schema mismatch")
    return source


def _validate_prediction_boundaries(source: parquet.ParquetFile, universe: str) -> None:
    columns = ["trade_date", "fold_id", "split_role", "universe_name"]
    for batch in source.iter_batches(batch_size=131_072, columns=columns):
        values = batch.to_pydict()
        for date, fold, role, row_universe in zip(*(values[column] for column in columns)):
            if (
                role != "validation"
                or fold not in FOLDS
                or row_universe != universe
                or not isinstance(date, str)
                or date > "2025-12-31"
            ):
                raise ArtifactUnavailable("C7 model artifacts violate validation boundaries")


@lru_cache(maxsize=2)
def _load_artifacts_cached(
    root_string: str, signatures: tuple[tuple[str, int, int], ...]
) -> tuple[dict[str, Any], Path, Path]:
    del signatures  # Included in the cache key so modified artifacts are revalidated.
    root = Path(root_string)
    paths = _artifact_paths(root)
    try:
        with paths["manifest"].open("r", encoding="utf-8") as source:
            manifest = json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactUnavailable("C7 model manifest is invalid") from error

    if manifest.get("holdout_accessed") is not False:
        raise ArtifactUnavailable("C7 holdout guard failed")
    if manifest.get("canonical_universe") != "pit_liquid_ordinary_equity_v1":
        raise ArtifactUnavailable("C7 model manifest has an unexpected universe")

    outputs = manifest.get("outputs", {})
    expected_hashes = {
        "importance": outputs.get("importance", {}).get("file_sha256"),
        "predictions": outputs.get("predictions", {}).get("file_sha256"),
    }
    if any(not value for value in expected_hashes.values()):
        raise ArtifactUnavailable("C7 model manifest is missing artifact hashes")
    for name, expected_hash in expected_hashes.items():
        if _sha256(paths[name]) != expected_hash:
            raise ArtifactUnavailable("C7 model artifact hash mismatch")

    predictions = _validate_schema(paths["predictions"], EXPECTED_PREDICTION_SCHEMA)
    importance = _validate_schema(paths["importance"], EXPECTED_IMPORTANCE_SCHEMA)
    counts = manifest.get("counts", {})
    if predictions.metadata.num_rows != counts.get("prediction_rows"):
        raise ArtifactUnavailable("C7 prediction row count mismatch")
    if importance.metadata.num_rows != counts.get("importance_rows"):
        raise ArtifactUnavailable("C7 feature-importance row count mismatch")
    _validate_prediction_boundaries(predictions, manifest["canonical_universe"])
    return manifest, paths["importance"], paths["predictions"]


def load_artifacts() -> tuple[dict[str, Any], Path, Path]:
    root = _artifact_root()
    paths = _artifact_paths(root)
    signatures = tuple(
        (name, path.stat().st_mtime_ns, path.stat().st_size)
        for name, path in sorted(paths.items())
    )
    return _load_artifacts_cached(str(root), signatures)


def _artifacts_or_503() -> tuple[dict[str, Any], Path, Path]:
    try:
        return load_artifacts()
    except ArtifactUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def _reject_unknown_query_keys(request: Request, allowed: set[str]) -> None:
    unknown = set(request.query_params) - allowed
    if unknown:
        raise HTTPException(status_code=422, detail="Unsupported query parameter")


def _filters(manifest: dict[str, Any]) -> dict[str, list[str]]:
    targets = manifest.get("targets", {})
    aggregate_keys = manifest.get("aggregate_metrics", {})
    return {
        "models": sorted({key.rsplit(":", 1)[1] for key in aggregate_keys}),
        "regression_targets": list(targets.get("regression", [])),
        "classification_targets": list(targets.get("classification", [])),
        "folds": list(FOLDS),
    }


def _validate_choice(value: str, choices: list[str] | tuple[str, ...], label: str) -> None:
    if value not in choices:
        raise HTTPException(status_code=422, detail=f"Unknown {label}")


@router.get("/summary")
def summary(request: Request) -> dict[str, Any]:
    _reject_unknown_query_keys(request, set())
    manifest, _, _ = _artifacts_or_503()
    filters = _filters(manifest)
    series = []
    for key, aggregate in sorted(manifest["aggregate_metrics"].items()):
        target, model = key.rsplit(":", 1)
        means = aggregate.get("mean", {})
        series.append(
            {
                "model": model,
                "target": target,
                "target_type": "regression" if target in filters["regression_targets"] else "classification",
                "fold_count": aggregate.get("folds"),
                "observation_count": aggregate.get("total_n"),
                "metrics": {metric: _safe_value(means.get(metric)) for metric in OVERVIEW_METRICS},
            }
        )
    return {
        "source": {
            "manifest_version": manifest.get("manifest_version"),
            "generated_at_utc": manifest.get("generated_at_utc"),
            "canonical_universe": manifest.get("canonical_universe"),
            "configuration_sha256": manifest.get("configuration_sha256"),
        },
        "counts": manifest.get("counts", {}),
        "filters": filters,
        "holdout_accessed": False,
        "overview_metrics": list(OVERVIEW_METRICS),
        "series": series,
        "conclusion": CONCLUSION,
    }


@router.get("/fold-metrics")
def fold_metrics(request: Request, model: str, target: str, metric: str | None = None) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "metric"})
    manifest, _, _ = _artifacts_or_503()
    filters = _filters(manifest)
    _validate_choice(model, filters["models"], "model")
    _validate_choice(target, filters["regression_targets"] + filters["classification_targets"], "target")
    available_metrics = sorted({
        name
        for fold in FOLDS
        for name in manifest["per_fold_metrics"].get(f"{target}:{fold}:{model}", {})
        if name != "uncertainty"
    })
    if metric is not None:
        _validate_choice(metric, available_metrics, "metric")
    selected_metrics = [metric] if metric else available_metrics
    folds = []
    finite_values = []
    for fold in FOLDS:
        values = manifest["per_fold_metrics"].get(f"{target}:{fold}:{model}")
        if values is None:
            raise HTTPException(status_code=404, detail="Fold metrics are unavailable")
        selected = {name: _safe_value(values.get(name)) for name in selected_metrics}
        finite_values.extend(value for value in selected.values() if isinstance(value, (int, float)))
        folds.append({
            "fold": fold,
            "year": int(fold.removeprefix("fold_")),
            "finite_ic_date_count": values.get("finite_ic_date_count"),
            "undefined_ic_date_count": values.get("nonfinite_ic_date_count"),
            "metrics": selected,
        })
    scale = None if not finite_values else {"min": min(0, min(finite_values)), "max": max(0, max(finite_values))}
    per_metric_scales = {}
    for name in selected_metrics:
        values = [item["metrics"][name] for item in folds if isinstance(item["metrics"][name], (int, float))]
        per_metric_scales[name] = None if not values else {"min": min(0, min(values)), "max": max(0, max(values))}
    return {
        "model": model,
        "target": target,
        "available_metrics": available_metrics,
        "scale": scale if metric else None,
        "metric_scales": per_metric_scales,
        "folds": folds,
    }


@router.get("/runtime")
def runtime(request: Request, model: str | None = None, target: str | None = None, fold: str | None = None) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "fold"})
    manifest, _, _ = _artifacts_or_503()
    filters = _filters(manifest)
    if model is not None:
        _validate_choice(model, filters["models"], "model")
    if target is not None:
        _validate_choice(target, filters["regression_targets"] + filters["classification_targets"], "target")
    if fold is not None:
        _validate_choice(fold, FOLDS, "fold")
    rows = [
        _safe_value(row)
        for row in manifest.get("runtime_statistics", [])
        if (model is None or row.get("model") == model)
        and (target is None or row.get("target") == target)
        and (fold is None or row.get("fold") == fold)
    ]
    return {"filters": {"model": model, "target": target, "fold": fold}, "count": len(rows), "rows": rows}


@router.get("/feature-importance")
def feature_importance(
    request: Request,
    model: str,
    target: str,
    fold: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "fold", "limit"})
    manifest, importance_path, _ = _artifacts_or_503()
    filters = _filters(manifest)
    _validate_choice(model, IMPORTANCE_MODELS, "model")
    _validate_choice(target, filters["regression_targets"] + filters["classification_targets"], "target")
    if fold is not None:
        _validate_choice(fold, FOLDS, "fold")

    table = parquet.read_table(
        importance_path,
        filters=[("model_name", "=", model), ("target_name", "=", target)],
    )
    rows = table.to_pylist()
    if fold is not None:
        rows = [row for row in rows if row["fold_id"] == fold]
    if not rows:
        raise HTTPException(status_code=404, detail="Feature importance is unavailable")

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["feature"], []).append(row)
    summaries = []
    for feature, feature_rows in grouped.items():
        permutation = [row["permutation_importance"] for row in feature_rows]
        mean = sum(permutation) / len(permutation)
        variance = sum((value - mean) ** 2 for value in permutation) / len(permutation)
        summaries.append({
            "feature": feature,
            "permutation_mean": mean,
            "permutation_std": math.sqrt(variance),
            "permutation_min": min(permutation),
            "permutation_max": max(permutation),
            "folds": [
                {
                    "fold": row["fold_id"],
                    "permutation_importance": row["permutation_importance"],
                    "gain_importance": row["gain_importance"],
                    "split_importance": row["split_importance"],
                }
                for row in sorted(feature_rows, key=lambda item: item["fold_id"])
            ],
        })
    summaries.sort(key=lambda item: (-item["permutation_mean"], item["feature"]))
    return {"model": model, "target": target, "fold": fold, "limit": limit, "features": summaries[:limit]}


def _parse_date(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid {label}") from error
    if parsed.year >= 2026:
        raise HTTPException(status_code=422, detail="Holdout dates are not permitted")
    return parsed.isoformat()


def _average_ranks(values: list[float]) -> list[float]:
    ordered = sorted(range(len(values)), key=lambda index: (values[index], index))
    ranks = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and values[ordered[end]] == values[ordered[start]]:
            end += 1
        rank = (start + end - 1) / 2 + 1
        for position in range(start, end):
            ranks[ordered[position]] = rank
        start = end
    return ranks


def _spearman(predictions: list[float], targets: list[float]) -> tuple[float | None, str | None]:
    if len(predictions) < 3:
        return None, "insufficient_rows"
    if len(set(targets)) < 2:
        return None, "constant_target"
    if len(set(predictions)) < 2:
        return None, "constant_prediction"
    left = _average_ranks(predictions)
    right = _average_ranks(targets)
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    denominator = math.sqrt(sum((a - left_mean) ** 2 for a in left) * sum((b - right_mean) ** 2 for b in right))
    if denominator == 0:
        return None, "nonfinite_correlation"
    value = numerator / denominator
    return (value, None) if math.isfinite(value) else (None, "nonfinite_correlation")


@lru_cache(maxsize=24)
def _prediction_rows(root_string: str, signature: tuple[int, int], model: str, target: str, fold: str | None) -> tuple[dict[str, Any], ...]:
    del signature
    path = _artifact_paths(Path(root_string))["predictions"]
    filters = [("model_name", "=", model), ("target_name", "=", target)]
    if fold is not None:
        filters.append(("fold_id", "=", fold))
    table = parquet.read_table(path, columns=["trade_date", "symbol", "fold_id", "target", "prediction"], filters=filters)
    return tuple(table.to_pylist())


def _filtered_prediction_rows(model: str, target: str, fold: str | None = None) -> tuple[dict[str, Any], ...]:
    manifest, _, prediction_path = _artifacts_or_503()
    filters = _filters(manifest)
    _validate_choice(model, filters["models"], "model")
    _validate_choice(target, filters["regression_targets"], "regression target")
    if fold is not None:
        _validate_choice(fold, FOLDS, "fold")
    stat = prediction_path.stat()
    return _prediction_rows(str(_artifact_root()), (stat.st_mtime_ns, stat.st_size), model, target, fold)


@router.get("/daily-ic")
def daily_ic(
    request: Request,
    model: str,
    target: str,
    fold: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    rolling_window: int = Query(default=20, ge=1, le=120),
) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "fold", "date_from", "date_to", "rolling_window"})
    start = _parse_date(date_from, "date_from")
    end = _parse_date(date_to, "date_to")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to")
    rows = _filtered_prediction_rows(model, target, fold)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if (start is None or row["trade_date"] >= start) and (end is None or row["trade_date"] <= end):
            grouped.setdefault(row["trade_date"], []).append(row)
    output = []
    finite_history: list[float] = []
    for trade_date, date_rows in sorted(grouped.items()):
        finite = [row for row in date_rows if isinstance(row["prediction"], (int, float)) and math.isfinite(row["prediction"]) and isinstance(row["target"], (int, float)) and math.isfinite(row["target"])]
        ic, reason = _spearman([row["prediction"] for row in finite], [row["target"] for row in finite])
        if ic is not None:
            finite_history.append(ic)
        rolling = statistics.fmean(finite_history[-rolling_window:]) if len(finite_history) >= rolling_window else None
        output.append({"trade_date": trade_date, "fold": date_rows[0]["fold_id"], "ic": ic, "rolling_ic": rolling, "eligible_count": len(finite), "undefined_reason": reason})
    values = [value for row in output for value in (row["ic"], row["rolling_ic"]) if value is not None]
    scale = {"min": min([0.0, *values]), "max": max([0.0, *values])}
    boundaries = []
    for fold_name in FOLDS:
        dates = [row["trade_date"] for row in output if row["fold"] == fold_name]
        if dates:
            boundaries.append({"fold": fold_name, "first_date": dates[0], "last_date": dates[-1]})
    return {"model": model, "target": target, "fold": fold, "rolling_window": rolling_window, "zero_reference": 0, "scale": scale, "dates": output, "fold_boundaries": boundaries}


@router.get("/decile-outcomes")
def decile_outcomes(request: Request, model: str, target: str, fold: str, buckets: int = Query(default=10, ge=5, le=20)) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "fold", "buckets"})
    rows = _filtered_prediction_rows(model, target, fold)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if isinstance(row["prediction"], (int, float)) and math.isfinite(row["prediction"]) and isinstance(row["target"], (int, float)) and math.isfinite(row["target"]):
            grouped.setdefault(row["trade_date"], []).append(row)
    bucket_rows: dict[int, list[tuple[float, float, str]]] = {number: [] for number in range(1, buckets + 1)}
    date_bucket_actuals: dict[str, dict[int, list[float]]] = {}
    excluded = 0
    for trade_date, date_rows in grouped.items():
        if len(date_rows) < buckets:
            excluded += 1
            continue
        ordered = sorted(date_rows, key=lambda row: (row["prediction"], row["symbol"]))
        for index, row in enumerate(ordered):
            bucket = min(buckets, index * buckets // len(ordered) + 1)
            bucket_rows[bucket].append((row["target"], row["prediction"], trade_date))
            date_bucket_actuals.setdefault(trade_date, {}).setdefault(bucket, []).append(row["target"])
    output = []
    for bucket, values in bucket_rows.items():
        actual = [item[0] for item in values]
        predictions = [item[1] for item in values]
        output.append({"bucket": bucket, "label": f"D{bucket}" if buckets == 10 else f"B{bucket}", "mean_actual": statistics.fmean(actual) if actual else None, "median_actual": statistics.median(actual) if actual else None, "mean_prediction": statistics.fmean(predictions) if predictions else None, "sample_count": len(values), "finite_date_count": len({item[2] for item in values})})
    first, last = output[0], output[-1]
    top_count = min(2, buckets)
    bottom_values = [value[0] for bucket in range(1, top_count + 1) for value in bucket_rows[bucket]]
    top_values = [value[0] for bucket in range(buckets - top_count + 1, buckets + 1) for value in bucket_rows[bucket]]
    bucket_means = [row["mean_actual"] for row in output]
    monotonicity, _ = _spearman(list(range(1, buckets + 1)), bucket_means)

    interval_dates = sorted(date_bucket_actuals)
    generator = random.Random(7007)
    bootstrap_values = []
    bootstrap_blocks, block_size = 500, 20
    for _ in range(bootstrap_blocks):
        sampled_dates = []
        while len(sampled_dates) < len(interval_dates):
            start = generator.randrange(len(interval_dates))
            sampled_dates.extend(interval_dates[(start + offset) % len(interval_dates)] for offset in range(block_size))
        low_sum = low_count = high_sum = high_count = 0
        for sampled_date in sampled_dates[:len(interval_dates)]:
            low = date_bucket_actuals[sampled_date].get(1, [])
            high = date_bucket_actuals[sampled_date].get(buckets, [])
            low_sum += sum(low); low_count += len(low)
            high_sum += sum(high); high_count += len(high)
        if low_count and high_count:
            bootstrap_values.append(high_sum / high_count - low_sum / low_count)
    mean_spread = last["mean_actual"] - first["mean_actual"] if last["mean_actual"] is not None and first["mean_actual"] is not None else None
    interval_lower = _percentile(bootstrap_values, 0.025) if bootstrap_values else None
    interval_upper = _percentile(bootstrap_values, 0.975) if bootstrap_values else None
    derived = {
        "high_minus_low_mean_spread": mean_spread,
        "high_minus_low_median_spread": last["median_actual"] - first["median_actual"] if last["median_actual"] is not None and first["median_actual"] is not None else None,
        "monotonicity_score": monotonicity,
        "top_two_minus_bottom_two_mean_spread": statistics.fmean(top_values) - statistics.fmean(bottom_values) if top_values and bottom_values else None,
        "spread_interval": {
            "lower_95": interval_lower,
            "upper_95": interval_upper,
            "crosses_zero": interval_lower <= 0 <= interval_upper if interval_lower is not None and interval_upper is not None else None,
            "bootstrap_blocks": bootstrap_blocks,
            "finite_bootstrap_count": len(bootstrap_values),
            "block_size": block_size,
            "seed": 7007,
        },
        "metadata": {
            "monotonicity": "Spearman correlation between ordered bucket number and bucket mean actual outcome",
            "spread": f"B{buckets} mean actual minus B1 mean actual",
            "top_bottom": "combined top-two bucket actual mean minus combined bottom-two bucket actual mean",
            "interval": "circular contiguous date-block bootstrap of the high-minus-low pooled mean spread",
        },
    }
    return {"model": model, "target": target, "fold": fold, "buckets": buckets, "excluded_dates": excluded, "derived": derived, "rows": output}


@router.get("/feature-stability")
def feature_stability(request: Request, model: str, target: str, importance_type: str = "permutation", limit: int = Query(default=15, ge=1, le=50)) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "importance_type", "limit"})
    manifest, importance_path, _ = _artifacts_or_503()
    _validate_choice(model, IMPORTANCE_MODELS, "model")
    _validate_choice(target, _filters(manifest)["regression_targets"] + _filters(manifest)["classification_targets"], "target")
    _validate_choice(importance_type, ("permutation", "gain", "split"), "importance type")
    column = f"{importance_type}_importance"
    rows = parquet.read_table(importance_path, filters=[("model_name", "=", model), ("target_name", "=", target)]).to_pylist()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["feature"], []).append(row)
    output = []
    for feature, feature_rows in grouped.items():
        values = [row[column] for row in feature_rows if isinstance(row[column], (int, float)) and math.isfinite(row[column])]
        mean = statistics.fmean(values)
        std = statistics.pstdev(values) if len(values) > 1 else 0.0
        positive, negative, zero = sum(v > 0 for v in values), sum(v < 0 for v in values), sum(v == 0 for v in values)
        if len(values) == 1: stability = "one_fold_only"
        elif positive and negative: stability = "mixed"
        elif positive == len(values) and std <= abs(mean): stability = "stable_positive"
        elif negative == len(values) and std <= abs(mean): stability = "stable_negative"
        else: stability = "unstable"
        output.append({"feature": feature, "mean": mean, "min": min(values), "max": max(values), "fold_std": std, "positive_folds": positive, "negative_folds": negative, "zero_folds": zero, "finite_folds": len(values), "stability": stability, "folds": [{"fold": row["fold_id"], "value": row[column]} for row in sorted(feature_rows, key=lambda item: item["fold_id"])]})
    output.sort(key=lambda item: (-item["mean"], item["feature"]))
    return {"model": model, "target": target, "importance_type": importance_type, "features": output[:limit]}


def _percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def _roc_auc(targets: list[float], probabilities: list[float]) -> float | None:
    positives = sum(value == 1 for value in targets)
    negatives = sum(value == 0 for value in targets)
    if positives == 0 or negatives == 0:
        return None
    ranks = _average_ranks(probabilities)
    positive_rank_sum = sum(rank for rank, target_value in zip(ranks, targets) if target_value == 1)
    return (positive_rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def _weighted_roc_auc(sorted_rows: list[dict[str, Any]], date_weights: Counter[str]) -> float | None:
    positive_total = sum(date_weights[row["trade_date"]] for row in sorted_rows if row["target"] == 1)
    negative_total = sum(date_weights[row["trade_date"]] for row in sorted_rows if row["target"] == 0)
    if positive_total == 0 or negative_total == 0:
        return None
    concordant = 0.0
    negatives_before = 0
    start = 0
    while start < len(sorted_rows):
        end = start + 1
        probability = sorted_rows[start]["prediction_probability"]
        while end < len(sorted_rows) and sorted_rows[end]["prediction_probability"] == probability:
            end += 1
        positive_weight = sum(date_weights[row["trade_date"]] for row in sorted_rows[start:end] if row["target"] == 1)
        negative_weight = sum(date_weights[row["trade_date"]] for row in sorted_rows[start:end] if row["target"] == 0)
        concordant += positive_weight * (negatives_before + 0.5 * negative_weight)
        negatives_before += negative_weight
        start = end
    return concordant / (positive_total * negative_total)


def _quantile_spread(rows: list[dict[str, Any]]) -> float | None:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["trade_date"], []).append(row)
    spreads = []
    for date_rows in grouped.values():
        if len(date_rows) < 10:
            continue
        ordered = sorted(date_rows, key=lambda row: (row["prediction"], row["symbol"]))
        count = max(1, len(ordered) // 5)
        spreads.append(
            statistics.fmean(row["target"] for row in ordered[-count:])
            - statistics.fmean(row["target"] for row in ordered[:count])
        )
    return statistics.fmean(spreads) if spreads else None


def _interval_estimate(metric: str, rows: list[dict[str, Any]]) -> tuple[float | None, int]:
    if metric == "mean_daily_ic":
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row["trade_date"], []).append(row)
        values = []
        for date_rows in grouped.values():
            value, _ = _spearman(
                [row["prediction"] for row in date_rows],
                [row["target"] for row in date_rows],
            )
            if value is not None:
                values.append(value)
        return (statistics.fmean(values) if values else None, len(values))
    if metric == "spearman":
        value, _ = _spearman(
            [row["prediction"] for row in rows],
            [row["target"] for row in rows],
        )
        return value, len(rows)
    if metric == "quantile_spread":
        return _quantile_spread(rows), len(rows)
    probabilities = [row["prediction_probability"] for row in rows]
    return _roc_auc([row["target"] for row in rows], probabilities), len(rows)


@lru_cache(maxsize=24)
def _interval_rows_cached(
    root_string: str,
    signature: tuple[int, int],
    model: str,
    target: str,
    fold: str | None,
) -> tuple[dict[str, Any], ...]:
    del signature
    path = _artifact_paths(Path(root_string))["predictions"]
    filters = [("model_name", "=", model), ("target_name", "=", target)]
    if fold is not None:
        filters.append(("fold_id", "=", fold))
    columns = ["trade_date", "symbol", "target", "prediction", "prediction_probability"]
    rows = parquet.read_table(path, columns=columns, filters=filters).to_pylist()
    return tuple(
        row for row in rows
        if isinstance(row["target"], (int, float))
        and math.isfinite(row["target"])
        and isinstance(row["prediction"], (int, float))
        and math.isfinite(row["prediction"])
    )


@lru_cache(maxsize=64)
def _metric_interval_cached(
    root_string: str,
    signature: tuple[int, int],
    model: str,
    target: str,
    metric: str,
    fold: str | None,
    bootstrap_blocks: int,
    block_size: int,
    seed: int,
) -> dict[str, Any]:
    rows = list(_interval_rows_cached(root_string, signature, model, target, fold))
    if metric == "roc_auc":
        rows = [row for row in rows if isinstance(row["prediction_probability"], (int, float)) and math.isfinite(row["prediction_probability"])]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["trade_date"], []).append(row)
    dates = sorted(grouped)
    if not dates:
        raise HTTPException(status_code=404, detail="No finite validation observations are available")
    date_values: dict[str, float | None] | None = None
    if metric in ("mean_daily_ic", "quantile_spread"):
        date_values = {}
        for trade_date, date_rows in grouped.items():
            if metric == "mean_daily_ic":
                date_values[trade_date], _ = _spearman(
                    [row["prediction"] for row in date_rows],
                    [row["target"] for row in date_rows],
                )
            else:
                date_values[trade_date] = _quantile_spread(date_rows)
        finite_date_values = [value for value in date_values.values() if value is not None]
        point = statistics.fmean(finite_date_values) if finite_date_values else None
        finite_count = len(finite_date_values)
    else:
        point, finite_count = _interval_estimate(metric, rows)
    probability_sorted_rows = sorted(rows, key=lambda row: row["prediction_probability"]) if metric == "roc_auc" else None
    if point is None:
        raise HTTPException(status_code=422, detail="Metric is undefined for this selection")
    generator = random.Random(seed)
    estimates = []
    for _ in range(bootstrap_blocks):
        sampled_dates = []
        while len(sampled_dates) < len(dates):
            start = generator.randrange(len(dates))
            sampled_dates.extend(dates[(start + offset) % len(dates)] for offset in range(block_size))
        selected_dates = sampled_dates[:len(dates)]
        if date_values is not None:
            sampled_values = [date_values[sampled_date] for sampled_date in selected_dates if date_values[sampled_date] is not None]
            estimate = statistics.fmean(sampled_values) if sampled_values else None
        elif probability_sorted_rows is not None:
            estimate = _weighted_roc_auc(probability_sorted_rows, Counter(selected_dates))
        else:
            sampled_rows = [row for sampled_date in selected_dates for row in grouped[sampled_date]]
            estimate, _ = _interval_estimate(metric, sampled_rows)
        if estimate is not None and math.isfinite(estimate):
            estimates.append(estimate)
    if not estimates:
        raise HTTPException(status_code=422, detail="Bootstrap interval is undefined for this selection")
    lower = _percentile(estimates, 0.025)
    upper = _percentile(estimates, 0.975)
    return {
        "metric": metric,
        "model": model,
        "target": target,
        "fold": fold,
        "point": point,
        "lower_95": lower,
        "upper_95": upper,
        "crosses_zero": lower <= 0 <= upper,
        "date_count": len(dates),
        "finite_count": finite_count,
        "bootstrap_blocks": bootstrap_blocks,
        "finite_bootstrap_count": len(estimates),
        "block_size": block_size,
        "seed": seed,
        "metadata": {
            "bootstrap": "circular contiguous date-block bootstrap over ordered validation dates",
            "quantile_spread": "mean across dates of top prediction quintile actual mean minus bottom prediction quintile actual mean; deterministic prediction/symbol ordering; minimum 10 rows per date",
        },
    }


@router.get("/metric-intervals")
def metric_intervals(
    request: Request,
    metric: str,
    model: str | None = None,
    target: str | None = None,
    fold: str | None = None,
    bootstrap_blocks: int = Query(default=1000, ge=200, le=2000),
    block_size: int = Query(default=20, ge=1, le=60),
    seed: int = 7007,
) -> dict[str, Any]:
    _reject_unknown_query_keys(request, {"model", "target", "metric", "fold", "bootstrap_blocks", "block_size", "seed"})
    manifest, _, prediction_path = _artifacts_or_503()
    filters = _filters(manifest)
    _validate_choice(metric, INTERVAL_METRICS, "metric")
    if model is None or target is None:
        raise HTTPException(status_code=422, detail="model and target are required for a bounded interval request")
    _validate_choice(model, filters["models"], "model")
    expected_targets = filters["classification_targets"] if metric == "roc_auc" else filters["regression_targets"]
    _validate_choice(target, expected_targets, "compatible target")
    if fold is not None:
        _validate_choice(fold, FOLDS, "fold")
    stat = prediction_path.stat()
    return _metric_interval_cached(
        str(_artifact_root()),
        (stat.st_mtime_ns, stat.st_size),
        model,
        target,
        metric,
        fold,
        bootstrap_blocks,
        block_size,
        seed,
    )
