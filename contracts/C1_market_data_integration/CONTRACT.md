# Signal Viewer – Contract C1: Market Data Integration

---

# Background

The Signal Viewer currently visualizes synthetically generated market data and reproduces trading signals in JavaScript for demonstration purposes.

The long-term architecture requires the viewer to become a visualization and auditing tool for the Python-based trading pipeline (`psx-stock-watcher`).

This contract begins that transition by replacing the synthetic dataset with real historical market data while preserving the existing user interface and interaction model.

---

# Objective

Replace the internally generated demonstration OHLCV dataset with real historical adjusted market data from the existing PSX database.

Signal generation shall remain in JavaScript for this contract.

No strategy changes are permitted.

---

# Scope

## In Scope

* Replace synthetic OHLCV data with real historical adjusted data.
* Load historical data from the existing PSX database.
* Preserve all existing viewer functionality.
* Preserve all existing chart interactions.
* Preserve existing JavaScript signal generation.

## Out of Scope

* Python-generated signals.
* Trading strategy modifications.
* Indicator implementation changes.
* Database schema modifications.
* Performance optimization.
* UI redesign.
* Multi-symbol support.
* Backtesting.
* Tradeability filtering.

---

# Architectural Constraints

The following constraints are mandatory.

1. Python remains the authoritative implementation of trading logic.

2. The viewer is an inspection and visualization tool only.

3. Any duplicated signal logic in JavaScript is temporary.

4. Changes shall be minimal and localized.

5. Existing functionality shall not regress.

---

# Tasks

## T1 — Replace Synthetic Data Source

### Objective

Replace the internally generated demonstration dataset with real historical adjusted OHLCV data.

### Requirements

* Synthetic data is no longer used during normal execution.
* Historical adjusted OHLCV data is loaded successfully.
* Existing chart components consume the new data source without functional regression.

### Acceptance Evidence

Executor shall provide:

* Summary of implementation approach.
* Files modified.
* Terminal output demonstrating successful execution.
* Screenshot showing historical market data rendered in the viewer.

---

## T2 — Preserve Existing Viewer Functionality

### Objective

Ensure that replacing the data source does not alter existing viewer capabilities.

### Requirements

The following shall continue functioning correctly:

* Candlestick chart
* Volume pane
* SMA overlay
* Bollinger Bands
* MACD
* RSI
* Buy markers
* Sell markers
* Hover inspection
* Parameter sliders
* Zoom/pan behavior (if implemented)

### Acceptance Evidence

Executor shall provide:

* Confirmation that each feature was verified.
* Screenshots demonstrating normal operation.

---

## T3 — Maintain Existing Signal Logic

### Objective

Continue using the existing JavaScript implementation for signal generation until Python-generated signals are introduced in a future contract.

### Requirements

* No strategy rules shall be modified.
* No indicator calculations shall be intentionally changed.
* Signals shall continue to render correctly using the existing JavaScript implementation.

### Acceptance Evidence

Executor shall describe:

* Whether any signal-related code was modified.
* If modified, why the change was necessary.

---

## T4 — Build Verification

### Objective

Verify that the project builds and runs successfully after all changes.

### Requirements

* Project installs successfully.
* Development server starts successfully.
* Viewer renders without runtime errors.

### Acceptance Evidence

Executor shall paste terminal output for:

* Dependency installation
* Development server startup

Any warnings or errors shall be documented.

---

# Completion Criteria

This contract is complete when:

* All tasks satisfy their acceptance requirements.
* DELIVERY.md contains all required evidence.
* The viewer renders historical adjusted market data.
* Existing functionality is preserved.
* No unrelated architectural changes have been introduced.

---

# Delivery Requirements

The executor shall create a `DELIVERY.md` file in this contract directory.

The delivery document shall include:

* Executive summary
* Implementation approach
* Files modified
* Task-by-task completion notes
* Acceptance evidence for every task
* Terminal output
* Screenshots
* Known limitations (if any)
* Deviations from the contract (if any)

---

# Executor Notes

This contract is intentionally limited in scope.

Do not redesign the application.

Do not optimize code outside the required implementation.

Do not refactor unrelated components.

Prefer the smallest implementation that satisfies the contract while preserving the long-term architecture.
