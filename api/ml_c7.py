"""Read-only access to the accepted C7 model-validation artifacts."""
from __future__ import annotations

import hashlib
import json
import math
import os
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
) -> tuple[dict[str, Any], Path]:
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
    return manifest, paths["importance"]


def load_artifacts() -> tuple[dict[str, Any], Path]:
    root = _artifact_root()
    paths = _artifact_paths(root)
    signatures = tuple(
        (name, path.stat().st_mtime_ns, path.stat().st_size)
        for name, path in sorted(paths.items())
    )
    return _load_artifacts_cached(str(root), signatures)


def _artifacts_or_503() -> tuple[dict[str, Any], Path]:
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
    manifest, _ = _artifacts_or_503()
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
    manifest, _ = _artifacts_or_503()
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
    manifest, _ = _artifacts_or_503()
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
    manifest, importance_path = _artifacts_or_503()
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
