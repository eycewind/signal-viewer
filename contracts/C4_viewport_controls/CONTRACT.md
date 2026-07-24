# Signal Viewer – Contract C4: Chart Viewport Controls

## Background

Contract C3 added API-backed symbol selection with autocomplete, validation, persistence, and recoverable error handling.

The viewer currently loads the full adjusted OHLCV history for the selected symbol and renders all available bars. This contract adds chart navigation and visible-range controls without changing the underlying data, indicators, signals, or trading logic.

---

# Objective

Add chart viewport controls that let the user:

- select common date ranges,
- zoom horizontally,
- pan horizontally,
- reset the chart view,
- see the currently visible date range,
- keep all chart panes synchronized.

The implementation shall change only which portion of the already-loaded dataset is visible.

Indicators and signals must continue to be calculated from the full loaded history.

---

# Scope

## In Scope

- Date-range presets:
  - `1M`
  - `3M`
  - `6M`
  - `1Y`
  - `3Y`
  - `5Y`
  - `ALL`
- Horizontal mouse-wheel zoom.
- Horizontal click-and-drag pan.
- Reset-view control.
- Visible date-range display.
- Synchronized viewport across:
  - candlestick pane,
  - volume pane,
  - MACD pane,
  - RSI pane.
- Safe viewport behavior when switching symbols.
- Loading and rendering only the visible slice while preserving full-history calculations.
- Documentation and acceptance evidence.

## Out of Scope

- API date-range parameters.
- Partial-history loading.
- Backend changes.
- Watchlists.
- Multi-symbol comparison.
- Drawing tools.
- Vertical price-axis zoom.
- Indicator algorithm changes.
- Signal-generation changes.
- Strategy changes.
- Saving chart layouts.
- Mobile redesign.
- Performance optimization unrelated to viewport handling.
- Python-generated indicators or signals.

---

# Architectural Rule

The application shall retain the full OHLCV dataset in memory.

Indicators and signals shall be calculated from the full dataset.

The viewport shall affect rendering only.

Required flow:

```text
Full OHLCV data
      |
      +--> calculate indicators and signals
      |
      +--> derive visible viewport
                 |
                 +--> render visible bars across all panes
```

The implementation must not recalculate RSI, MACD, Bollinger Bands, SMA values, or trading signals using only the visible subset.

---

# Default Behavior

- The default viewport shall be `ALL`.
- Loading a symbol shall initially show the full available history unless a valid preset is already active.
- Existing chart behavior shall remain unchanged when `ALL` is selected.

---

# Range Presets

## Required Presets

```text
1M
3M
6M
1Y
3Y
5Y
ALL
```

## Preset Rules

- Presets shall use calendar dates where practical rather than fixed bar counts.
- Each preset shall show the most recent matching period ending at the newest available bar.
- `ALL` shall show the complete available history.
- The active preset shall be visually identifiable.
- Manual zoom or pan shall switch the visible mode to `Custom`.

Example:

```text
1Y => newest bar minus one calendar year through newest bar
ALL => oldest available bar through newest available bar
```

If a symbol has less history than the selected range, show all available history.

---

# Viewport State

The viewer shall maintain explicit viewport state.

At minimum, track:

- active preset,
- visible start index or date,
- visible end index or date,
- visible bar count,
- whether the viewport is preset-driven or custom.

The viewport shall be bounded by the available dataset.

Invalid or empty viewport states must not crash the chart.

---

# Zoom Requirements

## Mouse-Wheel Zoom

- Mouse-wheel input over the chart shall zoom horizontally.
- Zoom shall center around the cursor position where practical.
- Zooming in shall reduce the number of visible bars.
- Zooming out shall increase the number of visible bars.
- Zooming shall not exceed the available data range.
- A minimum visible-bar limit shall prevent unusable over-zoom.

Recommended minimum:

```text
20–30 bars
```

- Once manually zoomed, the active range mode shall become `Custom`.

## Zoom Constraints

- No vertical-axis zoom is required.
- Existing hover and crosshair behavior shall remain functional.
- Wheel handling shall not unintentionally scroll the page while actively zooming over the chart, where practical.

---

# Pan Requirements

## Horizontal Drag Pan

- Click-and-drag horizontally shall pan the current viewport.
- Dragging right shall move toward earlier history.
- Dragging left shall move toward newer history.
- Panning shall preserve the current visible bar count.
- Panning shall stop at the oldest and newest available bars.
- Once manually panned, the active range mode shall become `Custom`.

## Interaction Safety

- Normal clicks on existing controls must not start chart panning.
- Dragging shall not leave the viewer stuck in an active pan state.
- Mouse release outside the chart should end the pan action where practical.

---

# Synchronized Panes

All visible panes shall use the same horizontal viewport.

The following must remain aligned by date:

- price candles,
- volume bars,
- MACD,
- RSI,
- Bollinger Bands,
- SMA overlays,
- buy/sell markers,
- hover crosshair,
- visible date labels.

No pane may render a different start or end range.

---

# Reset Behavior

Add a reset-view control.

Recommended behavior:

- If a named preset is active, reset returns to that preset.
- If the viewport is `Custom`, reset returns to `ALL`.
- After reset, all panes must be synchronized.

A single clear button such as `Reset View` is sufficient.

---

# Symbol Switching Behavior

When the selected symbol changes:

- If a named preset is active, apply the same preset to the new symbol.
- If the current mode is `Custom`, reset the new symbol to `ALL`.
- Never reuse raw viewport indexes from the previous symbol.
- Recalculate the new viewport from the new symbol's own date range.
- Existing symbol-selection persistence behavior shall remain unchanged.

Example:

```text
Current preset: 1Y
OGDC -> DGKC
Result: DGKC opens at its latest 1Y
```

---

# Visible Range Display

Display the current visible range clearly.

Recommended format:

```text
Visible: 2025-07-10 -> 2026-07-10
Bars: 252
Mode: 1Y
```

For manual navigation:

```text
Mode: Custom
```

The display may be integrated into the existing symbol metadata area.

---

# Tasks

## T1 – Add Centralized Viewport State

### Objective

Create a single source of truth for the visible chart range.

### Requirements

- Add explicit viewport state.
- Keep the full loaded dataset unchanged.
- Derive the visible slice from viewport state.
- Ensure all panes consume the same visible range.
- Avoid duplicated range logic across components.

### Acceptance Evidence

Document:

- where viewport state is stored,
- how the visible slice is derived,
- how all panes share it.

Provide relevant code references.

---

## T2 – Implement Range Presets

### Objective

Add common date-range controls.

### Requirements

- Implement `1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y`, and `ALL`.
- Use calendar-date boundaries where practical.
- Visually identify the active preset.
- Handle symbols with shorter histories.
- Preserve full-history indicator and signal calculations.

### Acceptance Evidence

Demonstrate at least:

- `1M`,
- `1Y`,
- `ALL`.

For each, provide:

- active preset,
- visible start date,
- visible end date,
- visible bar count.

Attach one screenshot showing the range controls.

---

## T3 – Implement Mouse-Wheel Zoom

### Objective

Allow horizontal zoom over the chart.

### Requirements

- Zoom around the pointer position where practical.
- Enforce minimum visible-bar limits.
- Prevent zooming outside the dataset.
- Set mode to `Custom`.
- Preserve synchronized panes.

### Acceptance Evidence

Demonstrate:

- zoom in,
- zoom out,
- minimum zoom limit,
- synchronized price, volume, MACD, and RSI panes.

Provide browser-test output or screenshots.

---

## T4 – Implement Horizontal Pan

### Objective

Allow drag-based horizontal navigation.

### Requirements

- Support horizontal click-and-drag panning.
- Preserve the visible bar count.
- Clamp to dataset boundaries.
- End dragging safely on mouse release.
- Set mode to `Custom`.
- Preserve synchronized panes.

### Acceptance Evidence

Demonstrate:

- pan toward older data,
- pan toward newer data,
- oldest-boundary clamp,
- newest-boundary clamp.

Provide browser-test output or screenshots.

---

## T5 – Add Reset and Visible-Range Metadata

### Objective

Make viewport state clear and recoverable.

### Requirements

- Add a reset-view control.
- Display visible start date.
- Display visible end date.
- Display visible bar count.
- Display current preset or `Custom`.
- Ensure reset synchronizes all panes.

### Acceptance Evidence

Demonstrate:

1. select a preset,
2. manually zoom or pan,
3. confirm mode becomes `Custom`,
4. click reset,
5. confirm the expected reset range.

Attach one screenshot showing range metadata.

---

## T6 – Handle Symbol Changes

### Objective

Apply predictable viewport behavior when switching symbols.

### Requirements

- Preserve named presets across symbol changes.
- Reset custom viewports to `ALL` on symbol changes.
- Recompute viewport boundaries using the new symbol's data.
- Do not carry raw indexes between symbols.
- Preserve existing C3 symbol-selection behavior.

### Acceptance Evidence

Demonstrate:

1. select `1Y` on OGDC,
2. switch to DGKC,
3. confirm DGKC opens in `1Y`,
4. manually zoom to `Custom`,
5. switch symbols,
6. confirm the new symbol opens in `ALL`.

---

## T7 – Regression Verification

### Objective

Confirm that chart navigation does not break existing features.

### Requirements

Verify that the viewer still supports:

- symbol autocomplete,
- valid and invalid symbol handling,
- local-storage symbol persistence,
- candlesticks,
- volume,
- MACD,
- RSI,
- Bollinger Bands,
- SMA overlays,
- buy/sell markers,
- signal and trade summaries,
- parameter sliders,
- hover/crosshair behavior,
- production build.

### Acceptance Evidence

Run:

```bash
npm run build
```

Provide successful output.

Also provide one runtime screenshot showing:

- a non-default symbol,
- a non-`ALL` viewport,
- all chart panes aligned,
- existing controls and indicators visible.

---

# Files and Project Structure

Likely files to modify:

```text
src/App.jsx
src/App.css
src/SymbolSelector.jsx
README.md
contracts/C4_chart_viewport_controls/DELIVERY.md
```

A focused helper or hook is acceptable, for example:

```text
src/useChartViewport.js
src/chartViewport.js
```

Do not split the implementation into many files unless the separation is clearly useful.

No changes should be required in:

```text
api/
stock-watcher/
```

Backend changes are outside C4.

---

# Testing Requirements

At minimum, verify:

- default `ALL` view,
- each required preset,
- calendar-based range selection,
- symbols with shorter available history,
- zoom in,
- zoom out,
- minimum zoom clamp,
- pan older,
- pan newer,
- boundary clamping,
- synchronized panes,
- visible range metadata,
- reset behavior,
- preset preservation across symbol changes,
- custom-view reset across symbol changes,
- existing symbol selection,
- existing indicators and signals,
- production build.

Automated browser checks are encouraged.

Manual visual verification is still required for pane alignment and interaction quality.

---

# DELIVERY.md Requirements

Create:

```text
contracts/C4_chart_viewport_controls/DELIVERY.md
```

The delivery shall begin with one of:

```text
Status: COMPLETE
Status: BLOCKED
Status: FAILED
```

For every task, report separately:

- implementation status,
- verification status,
- files changed,
- acceptance evidence,
- problems encountered,
- resolutions applied.

Include raw terminal or browser-test output where practical.

Required screenshots:

- range preset controls,
- a custom zoomed or panned viewport,
- a non-default symbol with synchronized panes,
- visible range metadata.

The delivery shall conclude with:

## Contract Verdict

Include:

- implementation result,
- verification result,
- unresolved issues,
- deviations from the contract,
- overall contract status.

Do not mark the contract `COMPLETE` unless all mandatory acceptance criteria have been verified.

---

# Completion Criteria

C4 is complete only when:

- all required range presets work,
- `ALL` remains the default,
- indicators and signals use the full loaded dataset,
- mouse-wheel horizontal zoom works,
- click-and-drag horizontal pan works,
- zoom and pan are bounded safely,
- all panes remain synchronized,
- visible range metadata is shown,
- reset behavior works,
- symbol switching follows the defined preset/custom rules,
- existing C3 symbol selection still works,
- existing chart and signal behavior remains intact,
- `npm run build` succeeds,
- no backend or strategy logic is changed.

---

# Executor Notes

- Read the C3 implementation and delivery before coding.
- Inspect the current chart rendering and event-handling structure before proposing changes.
- Keep one centralized viewport model.
- Do not calculate indicators from only the visible bars.
- Do not add backend date filtering.
- Do not redesign the viewer.
- Do not add watchlists, drawings, or strategy features.
- Stop and report clearly if the current chart implementation cannot support synchronized navigation without major refactoring.