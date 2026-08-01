# Signal Viewer – Contract C6: Multi-Metric Model Comparison

## Background

Contract C5 introduced the separate read-only C7 ML Model Analysis interface and remains its governing foundation contract.

The initial overview allowed only one target and one metric to be studied at a time. That view is useful for drill-down, but it does not make the primary research comparison—models across targets and metrics—fast or visually effective.

## Objective

Make model-versus-target comparison the primary overview while retaining the existing C5 fold, feature-importance, and training-diagnostic views as detail views.

## Scope

- Separate regression and classification analysis families.
- Multi-select up to four compatible metrics.
- Multi-select the three nonlinear C7 models:
  - HistGradientBoosting CPU;
  - LightGBM deterministic CPU;
  - XGBoost GPU.
- Display one independently scaled comparison panel per selected metric.
- Compare selected models across the 5-, 10-, and 20-session targets in every panel.
- Selecting a plotted value updates the existing model, target, metric, fold, importance, and diagnostic drill-down.
- Preserve all C5 artifact, holdout, read-only, performance, and no-profitability-claim constraints.

## Presentation rules

- Metrics with incompatible units must never share a y-axis.
- Every metric panel must state whether higher or lower is preferable.
- Each panel must disclose its own visible scale.
- Model color must remain consistent across panels, but color cannot be the only identifier.
- Regression exposes ranking/error metrics; classification exposes classification metrics.
- At least one metric and one model must remain selected.
- No more than four metrics may be selected simultaneously.
- Exact values must be available through hover, focus, or selection.
- The layout must remain usable on narrow screens.

## Interaction contract

Default regression metrics:

```text
mean daily IC
quantile spread
RMSE
```

Default classification metrics:

```text
ROC AUC
log loss
```

Changing the analysis family resets the metric set to compatible defaults and selects a compatible target. Clicking a model/target point makes that combination the active drill-down selection without removing other comparison panels.

## Acceptance tests

- Regression and classification families expose only compatible metric choices.
- Users can select one through four metrics; a fifth selection is disabled and the final selected metric cannot be removed.
- Users can select any combination of the three nonlinear models; the final selected model cannot be removed.
- Each selected metric renders exactly one panel containing all selected models and all three compatible horizons.
- Values in every model/target cell match the C5 summary payload.
- Each panel computes its scale from only its finite displayed values and preserves negative values and zero references.
- Missing or non-applicable values render as unavailable rather than zero.
- Clicking or keyboard-activating a finite cell updates the fold comparison, feature importance, and diagnostics to the same model, target, and metric.
- Each panel labels metric direction and exposes exact values through accessible controls.
- Mobile layout retains all three target columns and provides identifiable model rows.
- Existing C5 navigation, holdout badge, research conclusion, fold comparison, feature importance, diagnostics, loading, and error behavior remain intact.
- Existing Chart Viewer functionality remains unchanged.
- Frontend lint and production build pass with no new warnings.

## Branch and merge conditions

Implementation branch: `feature/c6-ml-model-analysis`.

Do not merge until C5 is accepted and pushed, the C6 acceptance tests pass, the comparison UI is reviewed, and the user explicitly accepts C6.
