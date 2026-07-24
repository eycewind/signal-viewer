export const RANGE_PRESETS = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "ALL"];
export const MIN_VISIBLE_BARS = 24;

const PRESET_OFFSETS = {
  "1M": { months: 1 },
  "3M": { months: 3 },
  "6M": { months: 6 },
  "1Y": { years: 1 },
  "3Y": { years: 3 },
  "5Y": { years: 5 },
};

function firstDateIndexAtOrAfter(bars, timestamp) {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const middleTime = Date.parse(`${bars[middle].date}T00:00:00Z`);
    if (middleTime < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function presetViewport(bars, preset) {
  const total = bars.length;
  if (!total || preset === "ALL" || !PRESET_OFFSETS[preset]) {
    return { start: 0, end: total, mode: "ALL" };
  }

  const newest = new Date(`${bars[total - 1].date}T00:00:00Z`);
  const { months = 0, years = 0 } = PRESET_OFFSETS[preset];
  newest.setUTCFullYear(newest.getUTCFullYear() - years);
  newest.setUTCMonth(newest.getUTCMonth() - months);
  const start = firstDateIndexAtOrAfter(bars, newest.getTime());
  return { start: Math.min(start, total - 1), end: total, mode: preset };
}

export function boundedViewport(viewport, total) {
  if (!total) return { start: 0, end: 0, mode: viewport.mode || "ALL" };
  const end = Math.max(1, Math.min(total, viewport.end));
  const start = Math.max(0, Math.min(end - 1, viewport.start));
  return { ...viewport, start, end };
}

export function zoomViewport(viewport, total, anchorRatio, deltaY) {
  const current = boundedViewport(viewport, total);
  const count = current.end - current.start;
  const minimum = Math.min(MIN_VISIBLE_BARS, total);
  if (deltaY < 0 && count <= minimum) {
    return { ...current, mode: "Custom" };
  }
  const targetCount = Math.max(
    minimum,
    Math.min(total, Math.round(count * (deltaY < 0 ? 0.8 : 1.25)))
  );
  if (targetCount === count) return { ...current, mode: "Custom" };

  const ratio = Math.max(0, Math.min(1, anchorRatio));
  const anchor = current.start + ratio * Math.max(0, count - 1);
  const maximumStart = total - targetCount;
  const start = Math.max(0, Math.min(maximumStart, Math.round(anchor - ratio * (targetCount - 1))));
  return { start, end: start + targetCount, mode: "Custom" };
}

export function panViewport(viewport, total, barDelta) {
  const current = boundedViewport(viewport, total);
  const count = current.end - current.start;
  const maximumStart = total - count;
  const start = Math.max(0, Math.min(maximumStart, current.start + Math.round(barDelta)));
  return { start, end: start + count, mode: "Custom" };
}
