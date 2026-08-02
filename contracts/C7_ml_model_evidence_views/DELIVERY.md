# C7 ML Model Evidence Views - Delivery

## Implementation state

- Working branch: `feature/c6-ml-model-analysis`
- Recommended branch `feature/c7-ml-model-evidence-views` could not be created because `.git` is mounted read-only in the execution workspace.
- C7 is implemented on top of the accepted/current C6 working tree.

## Changed files

- `api/ml_c7.py`
- `src/api.js`
- `src/MlModelAnalysis.jsx`
- `src/ml-analysis.css`
- `contracts/C7_ml_model_evidence_views/DELIVERY.md`

The working tree also contains the architect-provided C6 refinements identified by the C7 contract. They are not counted as C7 delivery work.

## Delivered evidence views

- Daily cross-sectional Spearman IC, finite-only rolling IC, fold boundaries, zero reference, and undefined reasons.
- Deterministic prediction-bucket outcomes with mean, median, sample counts, finite-date counts, and excluded-date counts.
- Bucket-shape diagnostics with high-minus-low mean/median spread, bucket-mean monotonicity, top-two-minus-bottom-two spread, and a deterministic date-block 95% interval for the mean spread.
- Deterministic date-block 95% confidence intervals for `mean_daily_ic`, `spearman`, `quantile_spread`, and `roc_auc`.
- Feature-importance fold stability with signed values, six-decimal precision, range, standard deviation, fold sign counts, and stability labels.

Quantile spread uses the accepted research definition: for each date with at least 10 rows, sort deterministically by `(prediction, symbol)`, calculate top prediction quintile actual mean minus bottom prediction quintile actual mean, then average those date-level spreads.

## Backend smoke tests

Environment:

```bash
source scripts/activate_local_tools.sh
export PSX_ML_C7_ROOT=/home/hassan/psx-ml-research
```

HTTP interval smoke test:

```bash
curl -fsS 'http://127.0.0.1:8000/ml/c7/metric-intervals?model=lightgbm_cpu&target=fwd_open_to_close_ret_10s_adj&metric=mean_daily_ic&fold=fold_2024&bootstrap_blocks=200&block_size=20&seed=7007'
```

Result excerpt:

```text
point=0.0514526553
lower_95=0.0053193282
upper_95=0.0965126031
crosses_zero=false
date_count=246
finite_bootstrap_count=200
```

Repeated identical calls returned byte-equivalent data for all four supported metrics. A Spearman fixture produced `lower_95=-0.0471245`, `upper_95=0.1729148`, and `crosses_zero=true`. Fold-2024 ROC AUC produced `point=0.529980`, `lower_95=0.474757`, and `upper_95=0.581714`.

Validation checks returned HTTP 422 for:

- `bootstrap_blocks=199`;
- ROC AUC with a regression target;
- unsupported metric `rmse`.

## Frontend verification

```text
npm test       PASS (1 test file)
npm run lint   PASS (no warnings)
npm run build  PASS (22 modules transformed)
git diff --check PASS
```

## Visual QA notes

- Daily IC: raw and rolling lines are distinct; zero is visible; fold separators remain visible; finite/undefined totals are displayed.
- Prediction buckets: ordered low-to-high buckets remain legible with mean bars, median marks, exact hover values, and sample counts.
- Bucket diagnostics: the four ranking-shape statistics sit directly above the graph; the high-minus-low interval shows exact bounds and visibly identifies zero crossing.
- Confidence intervals: point and interval use separate marks; zero is labelled; lower/point/upper values are shown to six decimals; intervals crossing zero use the amber `Weak / uncertain` state.
- Feature stability: fold range, six-decimal mean and standard deviation, positive-fold count, and stability badge are visible without relying on color alone.
- Narrow layout: evidence panels stack vertically and retain the 11px ML typography floor.

No automated browser screenshot was captured because a browser automation session was not available in the execution environment. The concise visual-QA record above is provided as allowed by the contract.

## Safety statement

- The 2026 holdout was not accessed, loaded, summarized, inferred from, or displayed.
- `holdout_accessed == false` was verified through the accepted manifest guard.
- No watcher database was written or modified.
- No ML artifact file or directory was written or modified.
- All source artifacts were opened read-only through the existing C5 allow-list and integrity guard.

## Performance notes

- The UI requests 200 bootstrap replicates for interactive interval inspection; the endpoint contract default remains 1,000 and accepts 200-2,000.
- Immutable identical requests are cached in process.
- Mean daily IC and quantile spread bootstrap date-level sufficient statistics rather than rescanning rows per replicate.
- ROC AUC uses deterministic date weights over probability-sorted rows.
- Spearman remains the most expensive interval because each block resample requires a rank correlation over the resampled observations. Cold artifact verification and first-time prediction filtering may take several seconds; warm identical requests return from cache.
