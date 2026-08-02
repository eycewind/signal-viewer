export const PRIMARY_MODELS = ["hist_gradient_boosting_cpu", "lightgbm_cpu", "xgboost_gpu"];

export const METRICS_BY_TYPE = {
  regression: ["mean_daily_ic", "median_daily_ic", "positive_ic_fraction", "spearman", "quantile_spread", "rmse", "mae"],
  classification: ["roc_auc", "log_loss"],
};

export const DEFAULT_METRICS = {
  regression: ["mean_daily_ic", "quantile_spread", "rmse"],
  classification: ["roc_auc", "log_loss"],
};

export function toggleBoundedSelection(current, value, maximum = Infinity) {
  if (current.includes(value)) {
    return current.length === 1 ? current : current.filter(item => item !== value);
  }
  return current.length >= maximum ? current : [...current, value];
}

export function comparisonScale(values, { includeZero = false } = {}) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);
  const scaleMin = includeZero ? Math.min(0, dataMin) : dataMin;
  const scaleMax = includeZero ? Math.max(0, dataMax) : dataMax;
  const padding = Math.max((scaleMax - scaleMin) * 0.08, Math.abs(scaleMax) * 0.02, 0.000001);
  const min = scaleMin - padding;
  const max = scaleMax + padding;
  return {
    dataMin,
    dataMax,
    min,
    max,
    span: max - min || 1,
    zeroPercent: min <= 0 && max >= 0 ? ((0 - min) / (max - min || 1)) * 100 : null,
  };
}
