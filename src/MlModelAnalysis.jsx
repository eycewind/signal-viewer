import React, { useEffect, useMemo, useState } from "react";
import { fetchMlDailyIc, fetchMlDecileOutcomes, fetchMlFeatureImportance, fetchMlFeatureStability, fetchMlFoldMetrics, fetchMlMetricInterval, fetchMlRuntime, fetchMlSummary } from "./api";
import { comparisonScale, DEFAULT_METRICS, METRICS_BY_TYPE, PRIMARY_MODELS, toggleBoundedSelection } from "./modelComparison";
import "./ml-analysis.css";

const METRIC_LABELS = {
  mean_daily_ic: "Mean daily IC",
  median_daily_ic: "Median daily IC",
  positive_ic_fraction: "Positive-IC fraction",
  spearman: "Spearman",
  quantile_spread: "Quantile spread",
  rmse: "RMSE",
  mae: "MAE",
  roc_auc: "ROC AUC",
  log_loss: "Log loss",
  brier_score: "Brier score",
};
const FOLD_MARKS = { fold_2023: "●", fold_2024: "■", fold_2025: "▲" };
const MODEL_COLORS = {
  hist_gradient_boosting_cpu: "#76a7d7",
  lightgbm_cpu: "#e1b85b",
  xgboost_gpu: "#c28bd8",
};
const ZERO_REFERENCE_METRICS = new Set(["mean_daily_ic", "median_daily_ic", "spearman", "quantile_spread"]);
const INTERVAL_METRICS = new Set(["mean_daily_ic", "spearman", "quantile_spread", "roc_auc"]);

function formatValue(value, metric) {
  if (value == null) return "Undefined";
  const percentMetrics = new Set(["positive_ic_fraction", "roc_auc"]);
  return percentMetrics.has(metric) ? `${(value * 100).toFixed(1)}%` : Number(value).toFixed(4);
}

function statusText(error) {
  return error instanceof Error ? error.message : "Unable to load model analysis.";
}

export default function MlModelAnalysis({ active }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysisType, setAnalysisType] = useState("regression");
  const [selectedMetrics, setSelectedMetrics] = useState(DEFAULT_METRICS.regression);
  const [selectedModels, setSelectedModels] = useState(PRIMARY_MODELS);
  const [scaleMode, setScaleMode] = useState("shared");
  const [metric, setMetric] = useState("mean_daily_ic");
  const [model, setModel] = useState("lightgbm_cpu");
  const [target, setTarget] = useState("fwd_open_to_close_ret_10s_adj");
  const [folds, setFolds] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [importance, setImportance] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [evidenceFold, setEvidenceFold] = useState("fold_2024");
  const [icFold, setIcFold] = useState("");
  const [evidenceModel, setEvidenceModel] = useState("lightgbm_cpu");
  const [evidenceTarget, setEvidenceTarget] = useState("fwd_open_to_close_ret_10s_adj");
  const [rollingWindow, setRollingWindow] = useState(20);
  const [bucketCount, setBucketCount] = useState(10);
  const [dailyEvidence, setDailyEvidence] = useState(null);
  const [decileEvidence, setDecileEvidence] = useState(null);
  const [stabilityEvidence, setStabilityEvidence] = useState(null);
  const [evidenceError, setEvidenceError] = useState(null);
  const [metricInterval, setMetricInterval] = useState(null);
  const [intervalError, setIntervalError] = useState(null);

  useEffect(() => {
    if (!active || summary) return;
    const controller = new AbortController();
    setLoading(true);
    setSummaryError(null);
    fetchMlSummary({ signal: controller.signal })
      .then(payload => {
        setSummary(payload);
        if (!payload.filters.models.includes(model)) setModel(payload.filters.models[0]);
        if (!payload.filters.regression_targets.includes(target)) setTarget(payload.filters.regression_targets[0]);
      })
      .catch(error => { if (error.name !== "AbortError") setSummaryError(error); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [active, summary, model, target]);

  useEffect(() => {
    if (!active || !summary) return;
    const controller = new AbortController();
    setDetailError(null);
    setFolds(null);
    setRuntime(null);
    setImportance(null);
    Promise.all([
      fetchMlFoldMetrics({ model, target, metric }, { signal: controller.signal }),
      fetchMlRuntime({ model, target }, { signal: controller.signal }),
      ["lightgbm_cpu", "xgboost_gpu"].includes(model)
        ? fetchMlFeatureImportance({ model, target, limit: 12 }, { signal: controller.signal })
        : Promise.resolve(null),
    ]).then(([foldPayload, runtimePayload, importancePayload]) => {
      setFolds(foldPayload);
      setRuntime(runtimePayload);
      setImportance(importancePayload);
    }).catch(error => { if (error.name !== "AbortError") setDetailError(error); });
    return () => controller.abort();
  }, [active, summary, model, target, metric]);

  useEffect(() => {
    if (!active || !summary || !evidenceTarget) return;
    const controller = new AbortController();
    setEvidenceError(null);
    setDailyEvidence(null);
    setDecileEvidence(null);
    Promise.all([
      fetchMlDailyIc({ model: evidenceModel, target: evidenceTarget, fold: icFold, rolling_window: rollingWindow }, { signal: controller.signal }),
      fetchMlDecileOutcomes({ model: evidenceModel, target: evidenceTarget, fold: evidenceFold, buckets: bucketCount }, { signal: controller.signal }),
      ["lightgbm_cpu", "xgboost_gpu"].includes(evidenceModel)
        ? fetchMlFeatureStability({ model: evidenceModel, target: evidenceTarget, importance_type: "permutation", limit: 12 }, { signal: controller.signal })
        : Promise.resolve(null),
    ]).then(([daily, deciles, stability]) => {
      setDailyEvidence(daily); setDecileEvidence(deciles); setStabilityEvidence(stability);
    }).catch(error => { if (error.name !== "AbortError") setEvidenceError(error); });
    return () => controller.abort();
  }, [active, summary, evidenceModel, evidenceTarget, evidenceFold, icFold, rollingWindow, bucketCount]);

  useEffect(() => {
    if (!active || !summary || !INTERVAL_METRICS.has(metric)) {
      setMetricInterval(null);
      setIntervalError(null);
      return;
    }
    const controller = new AbortController();
    setMetricInterval(null);
    setIntervalError(null);
    fetchMlMetricInterval({ model, target, metric, bootstrap_blocks: 200, block_size: 20, seed: 7007 }, { signal: controller.signal })
      .then(setMetricInterval)
      .catch(error => { if (error.name !== "AbortError") setIntervalError(error); });
    return () => controller.abort();
  }, [active, summary, model, target, metric]);

  const comparisonTargets = useMemo(
    () => analysisType === "regression"
      ? summary?.filters.regression_targets ?? []
      : summary?.filters.classification_targets ?? [],
    [analysisType, summary],
  );
  const comparisonRows = useMemo(
    () => summary?.series.filter(row => comparisonTargets.includes(row.target) && selectedModels.includes(row.model)) ?? [],
    [summary, comparisonTargets, selectedModels],
  );
  const sharedMetricScales = useMemo(() => {
    const rows = summary?.series.filter(row => comparisonTargets.includes(row.target) && PRIMARY_MODELS.includes(row.model)) ?? [];
    return Object.fromEntries(selectedMetrics.map(value => [
      value,
      comparisonScale(
        rows.map(row => row.metrics[value]),
        { includeZero: ZERO_REFERENCE_METRICS.has(value) },
      ),
    ]));
  }, [summary, comparisonTargets, selectedMetrics]);

  function changeAnalysisType(nextType) {
    setAnalysisType(nextType);
    setSelectedMetrics(DEFAULT_METRICS[nextType]);
    const targets = nextType === "regression" ? summary.filters.regression_targets : summary.filters.classification_targets;
    setTarget(targets[0]);
    setMetric(DEFAULT_METRICS[nextType][0]);
  }

  function toggleMetric(value) {
    setSelectedMetrics(current => toggleBoundedSelection(current, value, 4));
  }

  function toggleModel(value) {
    setSelectedModels(current => toggleBoundedSelection(current, value));
  }

  function selectComparisonPoint(nextModel, nextTarget, nextMetric) {
    setModel(nextModel);
    setTarget(nextTarget);
    setMetric(nextMetric);
    if (nextTarget.startsWith("fwd_")) {
      setEvidenceModel(nextModel);
      setEvidenceTarget(nextTarget);
    }
  }

  if (!active) return null;
  if (loading && !summary) return <AnalysisState label="Loading accepted C7 validation results…" />;
  if (summaryError) return <AnalysisState error label={statusText(summaryError)} />;
  if (!summary) return null;

  return (
    <div className="ml-analysis">
      <header className="ml-header">
        <div>
          <p className="eyebrow">C7 validation diagnostics · read-only</p>
          <h1>ML Model Analysis</h1>
          <p>{summary.counts.prediction_rows.toLocaleString()} validation observations across {summary.counts.symbols} symbols and {summary.counts.dates} dates.</p>
        </div>
        <div className="holdout-badge"><span aria-hidden="true">✓</span> Holdout untouched</div>
      </header>

      <aside className="analysis-conclusion"><strong>Research conclusion</strong><span>{summary.conclusion}</span></aside>

      <div className="comparison-controls" aria-label="Comparison controls">
        <label className="analysis-type">Analysis family<select value={analysisType} onChange={event => changeAnalysisType(event.target.value)}><option value="regression">Future returns · regression</option><option value="classification">Up / down · classification</option></select></label>
        <fieldset><legend>Metrics <span>{selectedMetrics.length}/4 selected</span></legend><div className="check-grid">{METRICS_BY_TYPE[analysisType].map(value => <label key={value}><input type="checkbox" checked={selectedMetrics.includes(value)} disabled={(selectedMetrics.includes(value) && selectedMetrics.length === 1) || (!selectedMetrics.includes(value) && selectedMetrics.length >= 4)} onChange={() => toggleMetric(value)} /><span>{METRIC_LABELS[value]}</span></label>)}</div></fieldset>
        <fieldset><legend>Models</legend><div className="check-grid model-checks">{PRIMARY_MODELS.map(value => <label key={value}><input type="checkbox" checked={selectedModels.includes(value)} disabled={selectedModels.includes(value) && selectedModels.length === 1} onChange={() => toggleModel(value)} /><i style={{ background: MODEL_COLORS[value] }} /><span>{shortModelName(value)}</span></label>)}</div></fieldset>
        <fieldset className="scale-controls"><legend>Scale</legend><div className="check-grid"><label><input type="radio" name="ml-scale-mode" value="shared" checked={scaleMode === "shared"} onChange={event => setScaleMode(event.target.value)} /><span>Shared metric scale</span></label><label><input type="radio" name="ml-scale-mode" value="independent" checked={scaleMode === "independent"} onChange={event => setScaleMode(event.target.value)} /><span>Independent scale</span></label></div></fieldset>
      </div>

      {detailError && <div className="ml-error" role="alert">{statusText(detailError)}</div>}

      <section className="analysis-panel" aria-labelledby="overview-title">
        <div className="panel-heading"><div><p className="section-number">01</p><h2 id="overview-title">Models × targets</h2></div><p>Selected metrics · aggregate across validation folds</p></div>
        <p className="comparison-guidance">{scaleMode === "shared" ? "Shared metric scale uses all primary models for the visible horizons." : "Independent scale uses only the currently selected values in each panel."} Select any point to inspect that model, target, and metric across the 2023-2025 folds below.</p>
        <div className="comparison-grid">
          {selectedMetrics.map(value => <ComparisonPanel key={value} metric={value} targets={comparisonTargets} models={selectedModels} rows={comparisonRows} sharedScale={scaleMode === "shared" ? sharedMetricScales[value] : null} scaleMode={scaleMode} selection={{ model, target, metric }} onSelect={selectComparisonPoint} />)}
        </div>
      </section>

      <div className="drill-controls" aria-label="Selected comparison detail">
        <strong>Drill-down</strong>
        <label>Model<select value={model} onChange={event => setModel(event.target.value)}>{PRIMARY_MODELS.map(value => <option key={value} value={value}>{shortModelName(value)}</option>)}</select></label>
        <label>Target<select value={target} onChange={event => setTarget(event.target.value)}>{comparisonTargets.map(value => <option key={value} value={value}>{shortTargetName(value)}</option>)}</select></label>
        <label>Metric<select value={metric} onChange={event => setMetric(event.target.value)}>{METRICS_BY_TYPE[analysisType].map(value => <option key={value} value={value}>{METRIC_LABELS[value] ?? value}</option>)}</select></label>
      </div>

      <section className="analysis-panel" aria-labelledby="fold-title">
        <div className="panel-heading"><div><p className="section-number">02</p><h2 id="fold-title">Fold comparison</h2></div><p>One shared axis; nulls remain visible</p></div>
        {folds ? <FoldChart payload={folds} metric={metric} /> : <AnalysisState label="Loading fold metrics…" compact />}
      </section>

      <section className="analysis-panel evidence-section" aria-labelledby="evidence-title">
        <div className="panel-heading"><div><p className="section-number">03</p><h2 id="evidence-title">Validation evidence</h2></div><p>Time dependence · ranking shape · driver stability</p></div>
        <div className="evidence-controls">
          <label>Model<select value={evidenceModel} onChange={event => setEvidenceModel(event.target.value)}>{PRIMARY_MODELS.map(value => <option value={value} key={value}>{shortModelName(value)}</option>)}</select></label>
          <label>Regression target<select value={evidenceTarget} onChange={event => setEvidenceTarget(event.target.value)}>{summary.filters.regression_targets.map(value => <option value={value} key={value}>{shortTargetName(value)}</option>)}</select></label>
          <label>IC fold<select value={icFold} onChange={event => setIcFold(event.target.value)}><option value="">All folds</option>{summary.filters.folds.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Decile fold<select value={evidenceFold} onChange={event => setEvidenceFold(event.target.value)}>{summary.filters.folds.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Rolling window<input type="number" min="1" max="120" value={rollingWindow} onChange={event => setRollingWindow(Math.min(120, Math.max(1, Number(event.target.value))))} /></label>
          <label>Buckets<input type="number" min="5" max="20" value={bucketCount} onChange={event => setBucketCount(Math.min(20, Math.max(5, Number(event.target.value))))} /></label>
        </div>
        {evidenceError && <div className="ml-error" role="alert">{statusText(evidenceError)}</div>}
        <div className="evidence-grid">
          <article><h3>Daily IC timeline</h3>{dailyEvidence ? <DailyIcEvidence payload={dailyEvidence} /> : <AnalysisState compact label="Computing daily IC…" />}</article>
          <article><h3>Prediction-bucket outcomes</h3>{decileEvidence ? <DecileEvidence payload={decileEvidence} /> : <AnalysisState compact label="Computing bucket outcomes…" />}</article>
        </div>
        <article className="interval-card"><h3>95% date-block confidence interval</h3>{metricInterval ? <MetricIntervalEvidence payload={metricInterval} /> : intervalError ? <div className="ml-error" role="alert">{statusText(intervalError)}</div> : <AnalysisState compact label={INTERVAL_METRICS.has(metric) ? "Computing deterministic interval…" : "Select mean daily IC, Spearman, quantile spread, or ROC AUC to inspect uncertainty."} />}</article>
        <article className="stability-card"><h3>Feature-importance stability</h3>{stabilityEvidence ? <StabilityEvidence features={stabilityEvidence.features} /> : <AnalysisState compact label={evidenceModel === "hist_gradient_boosting_cpu" ? "Feature importance is unavailable for HistGradientBoosting." : "Loading fold stability…"} />}</article>
      </section>

      <div className="analysis-columns">
        <section className="analysis-panel" aria-labelledby="importance-title">
          <div className="panel-heading"><div><p className="section-number">04</p><h2 id="importance-title">Feature importance</h2></div><p>Permutation mean and fold range</p></div>
          {importance ? <ImportanceChart features={importance.features} /> : <AnalysisState compact label={["lightgbm_cpu", "xgboost_gpu"].includes(model) ? "Loading importance…" : "Importance is available for LightGBM and XGBoost."} />}
        </section>
        <section className="analysis-panel" aria-labelledby="diagnostics-title">
          <div className="panel-heading"><div><p className="section-number">05</p><h2 id="diagnostics-title">Training diagnostics</h2></div><p>Rounds and prediction spread</p></div>
          {runtime ? <RuntimeChart rows={runtime.rows} /> : <AnalysisState compact label="Loading diagnostics…" />}
        </section>
      </div>
    </div>
  );
}

function DailyIcEvidence({ payload }) {
  const finite = payload.dates.filter(row => row.ic != null);
  const min = payload.scale.min, max = payload.scale.max, span = max - min || 1;
  const points = payload.dates.map((row, index) => row.ic == null ? null : `${(index / Math.max(1, payload.dates.length - 1)) * 100},${100 - ((row.ic - min) / span) * 100}`).filter(Boolean).join(" ");
  const rolling = payload.dates.map((row, index) => row.rolling_ic == null ? null : `${(index / Math.max(1, payload.dates.length - 1)) * 100},${100 - ((row.rolling_ic - min) / span) * 100}`).filter(Boolean).join(" ");
  const mean = finite.length ? finite.reduce((sum, row) => sum + row.ic, 0) / finite.length : null;
  const positive = finite.length ? finite.filter(row => row.ic > 0).length / finite.length : null;
  return <><div className="evidence-summary"><span>Mean <b>{mean?.toFixed(4) ?? "—"}</b></span><span>Positive dates <b>{positive == null ? "—" : `${(positive * 100).toFixed(1)}%`}</b></span><span>Finite / undefined <b>{finite.length} / {payload.dates.length - finite.length}</b></span></div><svg className="ic-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Raw and rolling daily information coefficient"><line x1="0" x2="100" y1={100 - ((0 - min) / span) * 100} y2={100 - ((0 - min) / span) * 100} className="evidence-zero" /><polyline points={points} className="ic-raw" /><polyline points={rolling} className="ic-rolling" />{payload.fold_boundaries.slice(1).map(item => { const index = payload.dates.findIndex(row => row.trade_date === item.first_date); return <line key={item.fold} x1={(index / payload.dates.length) * 100} x2={(index / payload.dates.length) * 100} y1="0" y2="100" className="fold-boundary" />; })}</svg><div className="evidence-legend"><span>· Raw daily IC</span><strong>— Rolling IC</strong><em>— Zero</em></div></>;
}

function DecileEvidence({ payload }) {
  const values = payload.rows.flatMap(row => [row.mean_actual, row.median_actual]).filter(Number.isFinite);
  const bound = Math.max(...values.map(Math.abs), 0.000001);
  const derived = payload.derived;
  const highLabel = payload.rows.at(-1).label;
  const lowLabel = payload.rows[0].label;
  return <><div className="bucket-summary">
    <div><span>{highLabel} − {lowLabel} mean spread</span><strong>{derived.high_minus_low_mean_spread?.toFixed(6) ?? "—"}</strong><small className={derived.spread_interval.crosses_zero ? "uncertain" : ""}>95% CI {derived.spread_interval.lower_95?.toFixed(6) ?? "—"} → {derived.spread_interval.upper_95?.toFixed(6) ?? "—"}{derived.spread_interval.crosses_zero ? " · crosses zero" : ""}</small></div>
    <div><span>{highLabel} − {lowLabel} median spread</span><strong>{derived.high_minus_low_median_spread?.toFixed(6) ?? "—"}</strong></div>
    <div title={derived.metadata.monotonicity}><span>Monotonicity score</span><strong>{derived.monotonicity_score?.toFixed(4) ?? "—"}</strong><small>Spearman across bucket means</small></div>
    <div><span>Top-2 − bottom-2 spread</span><strong>{derived.top_two_minus_bottom_two_mean_spread?.toFixed(6) ?? "—"}</strong></div>
  </div><div className="decile-chart">{payload.rows.map(row => <button key={row.bucket} title={`${row.label}: mean ${row.mean_actual?.toFixed(6)}, median ${row.median_actual?.toFixed(6)}, n ${row.sample_count}`}><i className="decile-axis" /><b style={{ height: `${Math.abs(row.mean_actual / bound) * 45}%`, bottom: row.mean_actual >= 0 ? "50%" : "auto", top: row.mean_actual < 0 ? "50%" : "auto" }} /><u style={{ bottom: `${50 + (row.median_actual / bound) * 45}%` }} /><span>{row.label}</span><small>{row.sample_count.toLocaleString()}</small></button>)}</div><p className="evidence-note">Mean bars · median marks · {payload.excluded_dates} dates excluded · outcomes are predictive validation targets, not trading returns.</p></>;
}

function StabilityEvidence({ features }) {
  return <div className="stability-table">{features.map(item => <button key={item.feature} title={item.folds.map(fold => `${fold.fold}: ${fold.value.toFixed(6)}`).join(" · ")}><span>{item.feature.replaceAll("_", " ")}</span><strong>{item.mean.toFixed(6)}</strong><i>{item.min.toFixed(6)} → {item.max.toFixed(6)}</i><small>σ {item.fold_std.toFixed(6)} · +{item.positive_folds}/{item.finite_folds}</small><em className={`stability-${item.stability}`}>{item.stability.replaceAll("_", " ")}</em></button>)}</div>;
}

function MetricIntervalEvidence({ payload }) {
  const min = Math.min(0, payload.lower_95);
  const max = Math.max(0, payload.upper_95);
  const padding = Math.max((max - min) * .08, .000001);
  const scaleMin = min - padding, scaleMax = max + padding, span = scaleMax - scaleMin;
  const position = value => ((value - scaleMin) / span) * 100;
  return <div className={`interval-evidence${payload.crosses_zero ? " uncertain" : ""}`}>
    <div className="interval-summary"><strong>{shortModelName(payload.model)} · {shortTargetName(payload.target)} · {METRIC_LABELS[payload.metric] ?? payload.metric}</strong><span>{payload.crosses_zero ? "Weak / uncertain · interval crosses zero" : "Interval excludes zero"}</span></div>
    <div className="interval-track" role="img" aria-label={`Point ${payload.point.toFixed(6)}, 95 percent interval ${payload.lower_95.toFixed(6)} to ${payload.upper_95.toFixed(6)}`}><i className="interval-zero" style={{ left: `${position(0)}%` }}><u>0</u></i><b style={{ left: `${position(payload.lower_95)}%`, width: `${position(payload.upper_95) - position(payload.lower_95)}%` }} /><em style={{ left: `${position(payload.point)}%` }} /></div>
    <div className="interval-values"><span>Lower 95% <b>{payload.lower_95.toFixed(6)}</b></span><span>Point <b>{payload.point.toFixed(6)}</b></span><span>Upper 95% <b>{payload.upper_95.toFixed(6)}</b></span><span>Dates <b>{payload.date_count}</b></span><span>Bootstrap <b>{payload.finite_bootstrap_count}/{payload.bootstrap_blocks}</b></span></div>
  </div>;
}

function shortModelName(model) {
  return ({ hist_gradient_boosting_cpu: "HistGradientBoosting", lightgbm_cpu: "LightGBM", xgboost_gpu: "XGBoost" })[model] ?? model.replaceAll("_", " ");
}

function shortTargetName(target) {
  const match = target.match(/(5|10|20)s/);
  return match ? `${match[1]} sessions` : target;
}

function ComparisonPanel({ metric, targets, models, rows, sharedScale, scaleMode, selection, onSelect }) {
  const values = rows.map(row => row.metrics[metric]).filter(value => typeof value === "number");
  const scale = sharedScale ?? comparisonScale(values, { includeZero: ZERO_REFERENCE_METRICS.has(metric) });
  const min = scale?.min ?? 0;
  const max = scale?.max ?? 1;
  const span = scale?.span ?? 1;
  const zero = scale?.zeroPercent ?? null;
  return <article className="comparison-panel">
    <header><div><h3>{METRIC_LABELS[metric] ?? metric}</h3><span>{metric === "rmse" || metric === "mae" || metric === "log_loss" ? "lower is better" : "higher is better"}</span></div><strong>{scaleMode === "shared" ? "Shared" : "Independent"} scale {scale ? `${min.toFixed(3)} -> ${max.toFixed(3)}` : "unavailable"}</strong></header>
    <div className="target-headings">{targets.map(item => <span key={item}>{shortTargetName(item)}</span>)}</div>
    <div className="comparison-matrix">{models.map(modelName => <React.Fragment key={modelName}>
      <span className="comparison-model"><i style={{ background: MODEL_COLORS[modelName] }} />{shortModelName(modelName)}</span>
      {targets.map(targetName => {
        const row = rows.find(item => item.model === modelName && item.target === targetName);
        const value = row?.metrics[metric];
        const position = typeof value === "number" ? ((value - min) / span) * 100 : null;
        const selected = selection.model === modelName && selection.target === targetName && selection.metric === metric;
        return <button type="button" key={targetName} className={`comparison-cell${selected ? " selected" : ""}`} onClick={() => onSelect(modelName, targetName, metric)} disabled={position == null} title={`${shortModelName(modelName)} · ${shortTargetName(targetName)}: ${formatValue(value, metric)}`}>
          {zero != null && <i className="comparison-zero" style={{ left: `${zero}%` }} />}
          {position == null ? <em>--</em> : <b style={{ left: `${position}%`, background: MODEL_COLORS[modelName] }}><u>{formatValue(value, metric)}</u></b>}
        </button>;
      })}
    </React.Fragment>)}</div>
  </article>;
}

function FoldChart({ payload, metric }) {
  const min = payload.scale?.min ?? -1;
  const max = payload.scale?.max ?? 1;
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  return <div className="fold-chart" role="img" aria-label={`${METRIC_LABELS[metric] ?? metric} by validation fold`}>
    <div className="fold-axis"><span style={{ left: `${zero}%` }} className="zero-line">0</span></div>
    {payload.folds.map(item => {
      const value = item.metrics[metric];
      const position = value == null ? null : ((value - min) / span) * 100;
      return <button type="button" className="fold-row" key={item.fold} title={`${item.year}: ${formatValue(value, metric)}`}>
        <span className="fold-label"><i>{FOLD_MARKS[item.fold]}</i>{item.year}</span>
        <span className="fold-track">{position == null ? <em>undefined</em> : <b style={{ left: `${position}%` }}>{FOLD_MARKS[item.fold]}</b>}</span>
        <strong>{formatValue(value, metric)}</strong>
        <small>{item.finite_ic_date_count ?? "—"} finite IC dates</small>
      </button>;
    })}
    <div className="axis-labels"><span>{min.toFixed(3)}</span><span>{max.toFixed(3)}</span></div>
  </div>;
}

function ImportanceChart({ features }) {
  if (!features.length) return <AnalysisState compact label="No importance rows for this selection." />;
  const bound = Math.max(...features.flatMap(item => [Math.abs(item.permutation_min), Math.abs(item.permutation_max)]), 0.000001);
  return <div className="importance-chart">{features.map(item => {
    const left = 50 + (item.permutation_min / bound) * 48;
    const right = 50 + (item.permutation_max / bound) * 48;
    const mean = 50 + (item.permutation_mean / bound) * 48;
    return <button key={item.feature} type="button" className="importance-row" title={`${item.feature}: mean ${item.permutation_mean.toFixed(6)}, fold range ${item.permutation_min.toFixed(6)} to ${item.permutation_max.toFixed(6)}`}>
      <span>{item.feature.replaceAll("_", " ")}</span><i><u style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} /><b style={{ left: `${mean}%` }} /></i><strong>{item.permutation_mean.toFixed(6)}<small>{item.permutation_min.toFixed(6)} to {item.permutation_max.toFixed(6)}</small></strong>
    </button>;
  })}</div>;
}

function RuntimeChart({ rows }) {
  if (!rows.length) return <AnalysisState compact label="No runtime diagnostics for this selection." />;
  const maxRounds = Math.max(...rows.map(row => row.rounds ?? 0), 1);
  return <div className="runtime-chart">{rows.map(row => <div className={`runtime-row${row.rounds <= 2 || row.constant_or_near_constant_prediction ? " warning" : ""}`} key={`${row.fold}-${row.model}-${row.target}`}>
    <span>{FOLD_MARKS[row.fold]} {row.fold.replace("fold_", "")}</span><i><b style={{ width: `${Math.max(1, (row.rounds / maxRounds) * 100)}%` }} /></i><strong>{row.rounds} rounds</strong><small>σ {row.prediction_std?.toFixed(4) ?? "—"}</small>
  </div>)}</div>;
}

function AnalysisState({ label, error = false, compact = false }) {
  return <div className={`analysis-state${error ? " error" : ""}${compact ? " compact" : ""}`} role={error ? "alert" : "status"}>{label}</div>;
}
