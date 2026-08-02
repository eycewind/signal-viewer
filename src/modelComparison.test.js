import assert from "node:assert/strict";
import test from "node:test";
import { comparisonScale, DEFAULT_METRICS, METRICS_BY_TYPE, PRIMARY_MODELS, toggleBoundedSelection } from "./modelComparison.js";

test("analysis families expose compatible defaults", () => {
  assert.deepEqual(DEFAULT_METRICS.regression, ["mean_daily_ic", "quantile_spread", "rmse"]);
  assert.deepEqual(DEFAULT_METRICS.classification, ["roc_auc", "log_loss"]);
  assert.ok(DEFAULT_METRICS.regression.every(metric => METRICS_BY_TYPE.regression.includes(metric)));
  assert.ok(DEFAULT_METRICS.classification.every(metric => METRICS_BY_TYPE.classification.includes(metric)));
  assert.equal(PRIMARY_MODELS.length, 3);
});

test("bounded selection retains one item and limits metrics to four", () => {
  assert.deepEqual(toggleBoundedSelection(["rmse"], "rmse", 4), ["rmse"]);
  assert.deepEqual(toggleBoundedSelection(["a", "b", "c", "d"], "e", 4), ["a", "b", "c", "d"]);
  assert.deepEqual(toggleBoundedSelection(["a", "b"], "a", 4), ["b"]);
});

test("comparison scale uses only finite displayed values and preserves zero", () => {
  const scale = comparisonScale([-0.2, 0.4, null, Number.NaN, Number.POSITIVE_INFINITY]);
  assert.equal(scale.dataMin, -0.2);
  assert.equal(scale.dataMax, 0.4);
  assert.ok(scale.min < -0.2);
  assert.ok(scale.max > 0.4);
  assert.ok(scale.zeroPercent > 0 && scale.zeroPercent < 100);
  assert.equal(comparisonScale([null, Number.NaN]), null);
});

test("comparison scale can anchor signed metrics around zero", () => {
  const scale = comparisonScale([0.02, 0.03], { includeZero: true });
  assert.equal(scale.dataMin, 0.02);
  assert.equal(scale.dataMax, 0.03);
  assert.ok(scale.min < 0);
  assert.ok(scale.max > 0.03);
  assert.ok(scale.zeroPercent > 0 && scale.zeroPercent < 100);
});
