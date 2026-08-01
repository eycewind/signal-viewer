# Signal Viewer – Contract C5: C7 ML Model Analysis

## Status

Planning contract. Implementation and merge require review and acceptance of this contract.

## Objective

Add a separate, read-only `ML Model Analysis` mode beside the existing `Chart Viewer` so accepted C7 validation results can be explored visually without changing existing market-data, indicator, or signal behavior.

The mode presents predictive validation diagnostics only. It must not present trading signals, portfolio results, backtests, or profitability claims.

## Source-of-truth boundary

Only these accepted C7 outputs are in scope:

- `/home/hassan/psx-ml-research/artifacts/predictions/c7/validation_predictions.parquet`
- `/home/hassan/psx-ml-research/artifacts/models/c7/feature_importance.parquet`
- `/home/hassan/psx-ml-research/artifacts/models/c7/MODEL_MANIFEST.json`

The equivalent reports may be used for human verification, not as API data sources.

All sources are opened read-only. Nothing is copied into `psx_watcher.db`, and neither `/home/hassan/psx-stock-watcher` nor its database may be modified.

The API must reject or exclude every row, fold, date range, path, or parameter associated with the locked 2026 holdout. It must also verify `holdout_accessed == false` in the manifest before serving C7 data.

## Inspected artifact schemas

`validation_predictions.parquet` has 5,324,172 rows, 742 dates, and 367 symbols with these columns:

```text
trade_date: string
symbol: string
fold_id: string
split_role: string
universe_name: string
target_name: string
target: double
prediction: double
prediction_probability: double
model_name: string
model_version: integer
device: string
```

`feature_importance.parquet` has 972 rows with these columns:

```text
target_name: string
fold_id: string
model_name: string
feature: string
gain_importance: double
split_importance: double
permutation_importance: double
```

The manifest supplies aggregate and per-fold metrics, target/model/fold enumerations, artifact hashes, selected parameters, runtime statistics, device details, and prediction-distribution diagnostics.

## Architecture

```text
Read-only C7 Parquet + manifest
             |
             v
FastAPI validation, filtering, and aggregation
             |
             v
Bounded JSON responses
             |
             v
React ML Model Analysis charts
```

Use DuckDB or PyArrow in the backend. Browser code must never read Parquet or receive an unbounded prediction set. Aggregations may be cached in process by canonicalized query parameters; cache entries must be derived only from the accepted validation artifacts.

Configure the C7 root independently from `PSX_DB_PATH`, for example with `PSX_ML_C7_ROOT`. Resolve and allow-list the three expected files beneath that root; do not accept arbitrary client-supplied paths.

## Product behavior

Top-level navigation is:

```text
Chart Viewer | ML Model Analysis
```

`Chart Viewer` remains the default and retains all accepted behavior. ML controls and state are isolated from chart-viewer symbol, viewport, indicator, and signal state. The ML interface is graph-first; compact tables may support exact-value inspection.

Every ML page displays this conclusion or a faithful concise equivalent:

> Nonlinear models found weak ranking structure, especially at 5–10 sessions, but results were not stable enough to establish a practical model. No profitability claim is made.

## API contract

All endpoints live under `/ml/c7`. Invalid enum values, malformed dates, reversed date ranges, invalid rolling windows, invalid bucket counts, and excessive sample sizes return HTTP 422. Missing configured artifacts return 503 without leaking filesystem paths.

### `GET /ml/c7/summary`

Returns source metadata, available filters, row/date/symbol counts, holdout status, and overview metric series. Overview metrics come directly from manifest aggregate/per-fold metrics and include, when applicable: mean/median daily IC, positive-IC fraction, Spearman, quantile spread, RMSE, MAE, ROC AUC, log loss, and Brier score. Non-applicable metrics are `null`, not zero.

### `GET /ml/c7/fold-metrics`

Parameters: `model`, `target`; optional `metric`.

Returns 2023, 2024, and 2025 values in stable fold order with finite/undefined IC counts. It must preserve nulls and expose the scale needed for a shared-axis fold comparison.

### `GET /ml/c7/daily-ic`

Parameters: `model`, regression `target`, `fold`, optional `date_from`, `date_to`, `rolling_window` (1–120; default 20).

Groups the filtered cross-section by trade date and computes Spearman rank correlation between prediction and target. A date is undefined when population, target variation, prediction variation, or correlation finiteness is insufficient. Undefined values remain `null` with a reason; they are excluded from rolling means and never coerced to zero.

### `GET /ml/c7/quantiles`

Parameters: `model`, regression `target`, `fold`; optional `buckets` (5–20; default 10), date range.

Assigns deterministic within-date prediction percentile buckets, then returns bucket-level target mean, median, count, and uncertainty/support fields. Ties use a documented deterministic secondary order. This is outcome-by-prediction-group analysis, not a portfolio return.

### `GET /ml/c7/feature-importance`

Parameters: `model` (`lightgbm_cpu` or `xgboost_gpu`), `target`; optional `fold`, `limit` (1–50; default 20).

Returns permutation importance by fold and fold summary (mean and variation), plus gain/split values where present. Sorting is deterministic and negative values are retained.

### `GET /ml/c7/calibration`

Parameters: `model`, classification `target`, `fold`; optional `buckets` (5–20; default 10), date range.

Returns probability bucket bounds/centres, observation count, mean predicted probability, observed positive rate, prevalence, and perfect-calibration coordinates. It uses `prediction_probability`; missing probabilities are not silently replaced by `prediction`.

### `GET /ml/c7/runtime`

Parameters: optional `model`, `target`, `fold`.

Returns manifest runtime and diagnostics including rounds, best iteration, early-stopping metric/scores, last evaluated iteration, prediction standard deviation, unique prediction count, near-constant flag, fit/predict seconds, rows, threads, and device.

### `GET /ml/c7/symbol/{symbol}/predictions`

Parameters: `model`, regression `target`; optional `fold`, date range.

Returns bounded, date-ordered validation predictions for one normalized symbol, including actual return, prediction, within-date percentile/rank, fold, and that date's daily IC. The response contains model observations only and does not label them buy/sell.

### `GET /ml/c7/date/{date}/cross-section`

Parameters: `model`, regression `target`, `fold`; optional `sample_size` (50–1000; default 400).

Returns total population, aggregate/bin summaries, and a deterministic sample for predicted-versus-actual display. Sampling is stable for identical canonical parameters and covers the prediction-rank range; it is not a random browser-side subset.

## Direct versus derived data

Available directly from accepted artifacts:

- overview and fold metrics;
- prediction/actual rows by date or symbol;
- feature importance by model, target, fold, and feature;
- runtime, device, rounds, early stopping, and distribution diagnostics;
- classification probabilities and labels.

Backend-derived at request time or in a read-only cache:

- daily IC and undefined reason;
- rolling daily IC;
- within-date percentile/rank;
- prediction quantile outcome summaries;
- calibration buckets and prevalence;
- deterministic scatter sampling/bin summaries;
- fold-to-fold feature-importance summaries.

No additional research artifact is required for the agreed views. If latency targets cannot be met, a later reviewed phase may generate versioned aggregate Parquet files outside the production database; those files must be reproducible from the accepted C7 validation artifact and keyed by its hash.

## UI views

1. Overview: small-multiple/heatmap comparison across models, targets, horizons, and folds, with metric selector and exact-value detail on click.
2. Daily IC: raw and rolling lines, zero reference, visible undefined-date marks, date brushing, and model/target/fold/window controls.
3. Fold comparison: shared-axis grouped points/bars with fold variation emphasized; never use independently scaled fold panels.
4. Quantiles: ordered bucket chart with uncertainty/support and click detail.
5. Symbol overlay: existing OHLC remains intact; ML values appear in a separately labelled lower panel/marker layer with distinct shape and legend.
6. Predicted versus actual: deterministic sampled scatter plus aggregate trend/bins and sample/population counts.
7. Feature importance: fold-colored dot/range plot showing permutation importance and fold variation.
8. Calibration: observed rate versus mean probability with prevalence and perfect-calibration reference lines.
9. Diagnostics: rounds and prediction-spread visuals, with one/two-round and near-constant cases visually called out.

Charts support keyboard focus and click/tap detail. Color is not the sole fold/model encoding. Loading, empty, undefined, and error states are explicit.

## Phased implementation

### Phase 1 – Backend foundation and overview

- Add read-only artifact configuration, dependency, schema/source validation, holdout guard, and bounded error handling.
- Implement summary, fold-metrics, runtime, and feature-importance endpoints.
- Add top-level navigation and overview/fold/diagnostic views without altering Chart Viewer behavior.

### Phase 2 – Derived cross-sectional analysis

- Implement daily IC, rolling IC, quantiles, calibration, and deterministic cross-section aggregation.
- Add timeline, quantile, scatter, and calibration charts.
- Measure response time and add bounded in-process caching if needed.

### Phase 3 – Symbol integration and hardening

- Implement symbol predictions with within-date rank and daily IC.
- Add the separate model panel/markers to the existing symbol chart.
- Complete accessibility, responsive behavior, performance budgets, documentation, and end-to-end regression evidence.

## Acceptance tests

### Artifact and safety tests

- API opens only allow-listed files under the configured C7 root and never writes them.
- Missing files, schema mismatch, hash mismatch, or `holdout_accessed != false` fails closed with 503.
- Returned data contains only `split_role == validation`, canonical universe rows, folds 2023–2025, and dates no later than 2025-12-31.
- Requests mentioning 2026, holdout/final roles, unknown folds, or arbitrary paths are rejected and do not query data.
- Existing SQLite access remains read-only and no code writes or copies ML data to it.

### Aggregation tests

- Summary and fold values match selected manifest fixtures exactly, including null/non-applicable metrics.
- Daily IC matches a hand-calculated Spearman fixture; constant prediction, constant target, insufficient population, and non-finite cases return null plus the correct reason.
- Rolling IC excludes undefined dates and respects date/fold filters without leaking adjacent folds.
- Quantile assignment is deterministic with ties, every eligible fixture row appears once, counts sum correctly, and ordered aggregates match hand calculations.
- Calibration buckets use probabilities, counts sum correctly, observed rates/prevalence match fixtures, and empty buckets are explicit or consistently omitted.
- Feature importance preserves negative values, filters correctly, and computes fold mean/variation from the selected rows.
- Symbol results are date ordered and rank/daily-IC values match the same-date cross-section.
- Cross-section sampling is identical across repeated requests, bounded by `sample_size`, and reports the unsampled population count.

### Validation and response-bound tests

- Unknown model/target/fold/symbol/date and incompatible regression/classification endpoints return the documented 404 or 422 response.
- Reversed ranges, malformed dates, windows/buckets/sample limits outside bounds, and unsupported query keys do not trigger unbounded scans or oversized responses.
- No endpoint returns all 5.3 million prediction rows; endpoint-specific maximum row counts are asserted.

### UI and regression tests

- Navigation defaults to Chart Viewer and switches modes without losing or corrupting existing chart state.
- Existing symbol selection, OHLC, volume, MACD, RSI, SMA/Bollinger overlays, signals, marker details, crosshair, presets, pan, and zoom continue to pass their accepted checks.
- Each required ML view renders from fixture API responses and exposes exact clicked values.
- Fold charts use a common scale and visibly retain sign/null differences.
- Undefined IC dates, prevalence, perfect calibration, zero references, sample size, and model-vs-signal distinction are visible and labelled.
- Empty/loading/API-failure states do not crash or leave stale values from a prior filter.
- A production build and frontend lint pass; backend unit/integration tests pass.

## Performance requirements

- Initial ML navigation must not download raw prediction rows.
- Summary-style responses target less than 250 KB; sampled cross-section responses target less than 1 MB.
- Default API requests should complete within two seconds on the development machine after warm-up; any exception must be measured and reviewed before acceptance.
- Browser memory remains proportional to the selected visualization, not the full artifact.

## Branch and merge conditions

Implementation branch: `feature/c5-ml-model-analysis`.

Do not merge until:

- this contract is reviewed and accepted;
- all phases required for the accepted scope are implemented;
- API aggregation, filtering, invalid-parameter, response-bound, and holdout-exclusion tests pass;
- existing Chart Viewer regression checks pass;
- lint/build and backend tests pass;
- visual evidence covers every required chart and important empty/undefined state;
- a reviewer confirms no watcher repository/database changes and no profitability or trading-signal claim;
- the user explicitly accepts the delivery.
