# Signal Viewer - Contract C7: ML Model Evidence Views

## Background

Contracts C5 and C6 introduced the read-only C7 ML Model Analysis surface and the model-versus-target comparison overview.

The current viewer is useful for aggregate comparison, but it still does not provide enough evidence to design the next ML experiment. In particular, aggregate fold metrics hide time dependence, ranking shape, statistical uncertainty, and fold-level feature instability.

This contract adds four immediate evidence views:

- daily IC timeline with rolling mean;
- prediction-decile outcomes by fold;
- confidence intervals and explicit zero reference;
- feature importance with numerical precision and fold stability.

## Architect Record For Executioner

The following local C6 refinement edits may exist in the working tree before Executioner starts:

- `src/MlModelAnalysis.jsx` may include shared-versus-independent scale controls, visible cell values, zero labels for signed aggregate metrics, and six-decimal feature-importance labels.
- `src/modelComparison.js` and `src/modelComparison.test.js` may contain frontend selection and scale helpers.
- `package.json` may include `npm test`.
- `contracts/C6_multi_metric_model_comparison/CONTRACT.md` may describe shared metric scale as the C6 default.

These edits are not the C7 delivery. Executioner must not count them as satisfying this contract except where they are directly reused without weakening the requirements below.

## Objective

Turn the ML viewer from an aggregate score browser into an evidence tool that shows whether a model is consistently useful, when it works, how its ranking behaves, and whether its apparent drivers are stable.

## Non-Negotiable Constraints

- Preserve all C5 read-only artifact constraints.
- Do not access, infer from, load, summarize, or display 2026 holdout data.
- Do not write to watcher databases or ML artifact directories.
- Do not copy the full prediction parquet into the repository.
- Do not make profitability, trading, or deployment claims.
- Undefined daily statistics remain `null` with reasons. Never coerce undefined values to zero.
- All API responses must be bounded and deterministic.
- Existing Chart Viewer behavior must remain unchanged.
- Existing C5/C6 ML controls must remain usable.

## Data Sources

Read only from the accepted C7 artifacts already governed by C5:

```text
/home/hassan/psx-ml-research/artifacts/predictions/c7/validation_predictions.parquet
/home/hassan/psx-ml-research/artifacts/models/c7/feature_importance.parquet
/home/hassan/psx-ml-research/artifacts/models/c7/MODEL_MANIFEST.json
```

Validation rows include:

```text
trade_date
symbol
fold_id
split_role
universe_name
target_name
target
prediction
prediction_probability
model_name
model_version
device
```

## Backend Scope

All endpoints live under `/ml/c7`.

### `GET /daily-ic`

Parameters:

- `model`: required enum;
- `target`: required regression target enum;
- `fold`: optional fold enum;
- `date_from`: optional ISO date;
- `date_to`: optional ISO date;
- `rolling_window`: integer 1-120, default 20.

Behavior:

- For each validation date, compute cross-sectional Spearman IC between `prediction` and `target`.
- Compute rolling mean IC over finite daily IC values only.
- Preserve validation fold identity for each date.
- Return undefined dates as `ic: null` with a compact reason such as `insufficient_rows`, `constant_target`, `constant_prediction`, or `nonfinite_correlation`.
- Include `zero_reference: 0`.
- Include scale bounds that preserve zero.

Response shape:

```json
{
  "model": "lightgbm_cpu",
  "target": "fwd_open_to_close_ret_10s_adj",
  "rolling_window": 20,
  "zero_reference": 0,
  "scale": { "min": -0.12, "max": 0.16 },
  "dates": [
    {
      "trade_date": "2023-01-03",
      "fold": "fold_2023",
      "ic": 0.0312,
      "rolling_ic": null,
      "eligible_count": 243,
      "undefined_reason": null
    }
  ],
  "fold_boundaries": [
    { "fold": "fold_2024", "first_date": "2024-01-01", "last_date": "2024-12-31" }
  ]
}
```

### `GET /decile-outcomes`

Parameters:

- `model`: required enum;
- `target`: required regression target enum;
- `fold`: required fold enum;
- `buckets`: integer 5-20, default 10.

Behavior:

- Within each trade date, rank rows by prediction and assign equal-frequency prediction buckets.
- Aggregate by fold and bucket.
- Return average actual future return, median actual future return, sample count, finite date count, and average prediction.
- Preserve bucket order from lowest prediction bucket to highest prediction bucket.
- Dates with too few finite rows for requested buckets are excluded and counted.

Response shape:

```json
{
  "model": "lightgbm_cpu",
  "target": "fwd_open_to_close_ret_10s_adj",
  "fold": "fold_2024",
  "buckets": 10,
  "excluded_dates": 3,
  "rows": [
    {
      "bucket": 1,
      "label": "D1",
      "mean_actual": -0.0021,
      "median_actual": -0.0014,
      "mean_prediction": -0.0082,
      "sample_count": 12844,
      "finite_date_count": 214
    }
  ]
}
```

### `GET /metric-intervals`

Parameters:

- `model`: optional enum;
- `target`: optional target enum;
- `metric`: required enum from `mean_daily_ic`, `spearman`, `quantile_spread`, `roc_auc`;
- `fold`: optional fold enum;
- `bootstrap_blocks`: integer 200-2000, default 1000;
- `block_size`: integer 1-60, default 20;
- `seed`: integer, default fixed contract seed `7007`.

Behavior:

- Compute deterministic date-block bootstrap confidence intervals.
- Return point estimate, lower 95%, upper 95%, sample date count, finite observation count, and whether interval crosses zero.
- For classification ROC AUC, bootstrap by date blocks over validation dates and compute the metric over concatenated rows in each resample.
- For quantile spread, use the same bucket definition as the existing aggregate metric or document the exact calculation in the response metadata.
- Never bootstrap across 2026 holdout.

Response shape:

```json
{
  "metric": "mean_daily_ic",
  "model": "lightgbm_cpu",
  "target": "fwd_open_to_close_ret_10s_adj",
  "fold": null,
  "point": 0.028,
  "lower_95": 0.011,
  "upper_95": 0.044,
  "crosses_zero": false,
  "date_count": 742,
  "finite_count": 739,
  "bootstrap_blocks": 1000,
  "block_size": 20,
  "seed": 7007
}
```

### `GET /feature-stability`

Parameters:

- `model`: required enum for models with feature importance;
- `target`: required target enum;
- `importance_type`: enum `permutation`, `gain`, `split`, default `permutation`;
- `limit`: integer 1-50, default 15.

Behavior:

- Return feature mean, min, max, fold standard deviation, positive-fold count, negative-fold count, zero-fold count, and stability label.
- Preserve signs for permutation importance.
- Show all numeric values at six-decimal precision in the UI, but API returns raw floats.
- Stability labels:
  - `stable_positive`: all finite folds positive and fold standard deviation is not larger than absolute mean;
  - `stable_negative`: all finite folds negative and fold standard deviation is not larger than absolute mean;
  - `mixed`: both positive and negative finite folds exist;
  - `one_fold_only`: only one finite fold;
  - `unstable`: otherwise.

Response shape:

```json
{
  "model": "lightgbm_cpu",
  "target": "fwd_open_to_close_ret_10s_adj",
  "importance_type": "permutation",
  "features": [
    {
      "feature": "eligible_symbol_count",
      "mean": 0.002001,
      "min": -0.0012,
      "max": 0.0067,
      "fold_std": 0.0034,
      "positive_folds": 2,
      "negative_folds": 1,
      "zero_folds": 0,
      "finite_folds": 3,
      "stability": "mixed",
      "folds": [
        { "fold": "fold_2023", "value": -0.0012 },
        { "fold": "fold_2024", "value": 0.0067 },
        { "fold": "fold_2025", "value": 0.0005 }
      ]
    }
  ]
}
```

## Frontend Scope

Add a C7 evidence section inside `ML Model Analysis` without removing the C6 overview.

### Daily IC Timeline

- Controls: model, regression target, fold/all, rolling window.
- Plot raw daily IC and rolling IC.
- Always show and label zero.
- Show fold boundaries.
- Undefined dates must be visible as gaps or marks with reasons available on hover/focus.
- Include compact summary: mean IC, positive-date percentage, worst date, best date, finite date count.

### Prediction-Decile Outcomes

- Controls: model, regression target, fold, bucket count.
- Plot D1 to D10 by default.
- Show mean actual return bars or line and median actual return as secondary marks.
- Include sample count per bucket.
- Make monotonicity or tail behavior easy to inspect visually.
- Do not label outcomes as trade returns or signals.

### Confidence Intervals

- Add interval display to aggregate comparison or adjacent evidence panel.
- For each selected model/target/metric, show point estimate and 95% interval.
- Visibly flag intervals crossing zero as weak/uncertain.
- Always label zero reference for signed metrics.

### Feature Importance Stability

- Replace or extend the existing feature-importance chart with:
  - six-decimal mean;
  - fold min and max;
  - fold standard deviation;
  - positive fold count;
  - stability badge;
  - signed permutation values.
- Include model and target selectors if the existing drill-down selection is not sufficient.
- Preserve current feature-importance fold range visualization if useful.

## Performance Requirements

- Summary view must not eagerly download all raw predictions.
- Daily IC and decile endpoints must filter and aggregate server-side.
- Endpoint responses should be compact enough for interactive use.
- Cache immutable artifact-derived computations in process when safe.
- Repeated requests with identical parameters must be deterministic.

## Acceptance Tests

- Daily IC endpoint returns ordered dates, rolling values, fold boundaries, zero-preserving scale, and undefined reasons without coercing nulls.
- Daily IC UI shows raw IC, rolling IC, labelled zero line, fold boundaries, and finite/undefined counts.
- Decile endpoint returns ordered buckets, sample counts, mean/median actual values, and excluded-date count for each fold.
- Decile UI makes low-to-high prediction bucket outcomes visible with exact values available.
- Metric interval endpoint returns deterministic 95% intervals for supported metrics and marks whether zero is crossed.
- Interval UI displays point estimate, lower/upper bounds, and weak/uncertain state when zero is crossed.
- Feature-stability endpoint returns six-decimal-capable raw values, fold min/max, fold standard deviation, signed fold values, and stability labels.
- Feature-stability UI displays six-decimal mean, fold range, positive-fold count, and stability badge.
- All new endpoints reject invalid models, targets, metrics, folds, date ranges, bucket counts, rolling windows, and bootstrap parameters with HTTP 422.
- No endpoint reads or exposes 2026 holdout rows.
- Existing C5/C6 ML views continue to render.
- Existing Chart Viewer behavior is unchanged.
- Frontend lint, frontend unit tests, production build, and relevant backend API smoke tests pass.

## Delivery Artifacts Required

Executioner must provide:

- implementation branch name;
- list of changed files;
- backend endpoint smoke-test commands and results;
- frontend test, lint, and build results;
- at least one screenshot or concise visual QA note for each new evidence view;
- explicit statement that 2026 holdout was not accessed;
- explicit statement that watcher DBs and ML artifacts were not written;
- any known limitations or performance tradeoffs.

## Branch And Merge Conditions

Recommended implementation branch: `feature/c7-ml-model-evidence-views`.

Do not merge until:

- C6 is accepted or the user explicitly chooses to build C7 on top of the current C6 branch;
- all C7 acceptance tests pass;
- Architect reviews Executioner's delivery and artifacts;
- user explicitly accepts C7.
