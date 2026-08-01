import React, { useEffect, useMemo, useState } from "react";
import { fetchMlFeatureImportance, fetchMlFoldMetrics, fetchMlRuntime, fetchMlSummary } from "./api";
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
  const [metric, setMetric] = useState("mean_daily_ic");
  const [model, setModel] = useState("lightgbm_cpu");
  const [target, setTarget] = useState("fwd_open_to_close_ret_10s_adj");
  const [folds, setFolds] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [importance, setImportance] = useState(null);
  const [detailError, setDetailError] = useState(null);

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

  const overviewRows = useMemo(
    () => summary?.series.filter(row => row.target === target) ?? [],
    [summary, target],
  );

  if (!active) return null;
  if (loading && !summary) return <AnalysisState label="Loading accepted C7 validation results…" />;
  if (summaryError) return <AnalysisState error label={statusText(summaryError)} />;
  if (!summary) return null;

  const allTargets = [...summary.filters.regression_targets, ...summary.filters.classification_targets];
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

      <div className="ml-controls" aria-label="Model analysis filters">
        <label>Model<select value={model} onChange={event => setModel(event.target.value)}>{summary.filters.models.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Target<select value={target} onChange={event => setTarget(event.target.value)}>{allTargets.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Metric<select value={metric} onChange={event => setMetric(event.target.value)}>{summary.overview_metrics.map(value => <option key={value} value={value}>{METRIC_LABELS[value] ?? value}</option>)}</select></label>
      </div>

      {detailError && <div className="ml-error" role="alert">{statusText(detailError)}</div>}

      <section className="analysis-panel" aria-labelledby="overview-title">
        <div className="panel-heading"><div><p className="section-number">01</p><h2 id="overview-title">Model overview</h2></div><p>Aggregate across the three validation folds</p></div>
        <div className="overview-grid">
          {overviewRows.map(row => <MetricTile key={row.model} row={row} metric={metric} selected={row.model === model} onSelect={() => setModel(row.model)} />)}
        </div>
      </section>

      <section className="analysis-panel" aria-labelledby="fold-title">
        <div className="panel-heading"><div><p className="section-number">02</p><h2 id="fold-title">Fold comparison</h2></div><p>One shared axis; nulls remain visible</p></div>
        {folds ? <FoldChart payload={folds} metric={metric} /> : <AnalysisState label="Loading fold metrics…" compact />}
      </section>

      <div className="analysis-columns">
        <section className="analysis-panel" aria-labelledby="importance-title">
          <div className="panel-heading"><div><p className="section-number">03</p><h2 id="importance-title">Feature importance</h2></div><p>Permutation mean and fold range</p></div>
          {importance ? <ImportanceChart features={importance.features} /> : <AnalysisState compact label={["lightgbm_cpu", "xgboost_gpu"].includes(model) ? "Loading importance…" : "Importance is available for LightGBM and XGBoost."} />}
        </section>
        <section className="analysis-panel" aria-labelledby="diagnostics-title">
          <div className="panel-heading"><div><p className="section-number">04</p><h2 id="diagnostics-title">Training diagnostics</h2></div><p>Rounds and prediction spread</p></div>
          {runtime ? <RuntimeChart rows={runtime.rows} /> : <AnalysisState compact label="Loading diagnostics…" />}
        </section>
      </div>
    </div>
  );
}

function MetricTile({ row, metric, selected, onSelect }) {
  const value = row.metrics[metric];
  return <button type="button" className={`metric-tile${selected ? " selected" : ""}`} onClick={onSelect} aria-label={`${row.model}: ${formatValue(value, metric)}`}>
    <span className="model-name">{row.model.replaceAll("_", " ")}</span>
    <strong>{formatValue(value, metric)}</strong>
    <span>{row.observation_count.toLocaleString()} observations</span>
  </button>;
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
    return <button key={item.feature} type="button" className="importance-row" title={`${item.feature}: ${item.permutation_mean.toFixed(6)}`}>
      <span>{item.feature.replaceAll("_", " ")}</span><i><u style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} /><b style={{ left: `${mean}%` }} /></i><strong>{item.permutation_mean.toFixed(4)}</strong>
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
