# BasketSim — Changelog

## Session: July 2026

### Architecture & Workflow
- **Two-stage workflow separation** — Data Collection and Run Analysis are now fully independent. Run Analysis loads only from the local DB with no network calls. Missing data shows a clear error panel with a "Go to Data Collection" button.
- **Gap detection in Run Analysis** — Before simulation starts, price data is scanned for gaps > 21 days. If found, an amber warning panel is shown directing the user to fill the gap before running.

---

### Local Database Tab

#### Charts & Visualization
- **Ticker switching bug fixed** — Changing the selected ticker now correctly updates all charts and data. Root causes: listener accumulation on the slider (fixed by cloning elements), `scales` outside `options` (Chart.js v3 bug), wrong chart registry (`_ldbCharts` vs `charts`).
- **Price history split into two charts** — Price chart (clean line, no overlay) and a separate Dividend Per Share chart below it.
- **Dividend per share chart** — Amber bars for individual payments + teal bars for annual totals (complete years only, at the last bar of each year). Incomplete/current year excluded. Both datasets share the same Y axis for correct height comparison.
- **Crosshair + circle marker** — Vertical dashed crosshair and filled circle on hover, applied to all charts site-wide.
- **Rich tooltips** — Price chart shows 52-week high/low and % change vs previous bar. Returns chart shows 3-month average and win rate. Drawdown chart shows streak length and window max drawdown.

#### Data Management
- **Find Gaps button** — Scans stored prices for gaps > 14 days. Shows a red panel listing each gap with date range and size.
- **Fetch gaps** — Each gap has a "Fetch [from] → [to]" button to fill only that missing range. "Fetch all N gaps" fills all gaps sequentially.
- **Clean dividends button** — Removes duplicate dividend entries caused by overlapping 6-month fetch chunks. Two deduplication rules: (a) same calendar month → keep first, (b) within 20 days and amounts within 15% → keep first. Applied automatically on save and load.
- **Dividend deduplication** — `cleanDivs()` runs on `dbSaveTicker` and `dbLoadTicker` to retroactively fix already-stored dirty data.

---

### Run Analysis Tab

#### Holdings & Cash Allocation
- **Cash allocation row** — Checkbox to enable cash allocation with % allocation and % annual yield (paid monthly). Cash is treated as a full portfolio allocation alongside stocks.
- **Normalized allocations** — Stocks and cash are all normalized together to sum to 100%. "Normalize to 100%" button includes cash in the normalization. Total display shows green when `stocks + cash = 100%`.
- **Cash earns monthly interest** — Interest paid on the last weekly bar of each calendar month (not every 4 weeks). Interest = `actualCash × (annualYield/12)`, taxed at dividend rate.
- **Cash in rebalance** — Cash is included in drift detection. Drift threshold applied consistently in both absolute and relative modes.
- **Holdings Snapshot CASH card** — When cash allocation is enabled, a CASH card appears in the Holdings Snapshot tab showing cash balance over time and monthly interest income (amber bars).

#### Drift Rebalance Mode
- **Absolute vs Relative drift** — Two radio buttons: Absolute (percentage points, same band for every stock) or Relative (% of each stock's target, proportional bands). Example with 10% relative: 50% target → ±5pp band, 20% target → ±2pp band.
- **Live drift preview** — When drift rebalance is enabled, a preview line shows exact trigger bands for every stock currently in the basket, updating live as the threshold changes.

#### Simulation Engine Fixes
- **Dividend index** — Each dividend is now assigned to exactly one weekly bar (nearest by milliseconds, within 7 days). Previous `buildWindowIndex(±4 days)` caused the same dividend to fire on two consecutive bars, doubling cash received.
- **Monthly injection** — Cash allocation portion of monthly additions goes directly to cash balance.
- **No-op rebalance logging** — When a time-based rebalance fires but nothing needs to be traded, logs "no action needed" with current allocation percentages and deviations from target.
- **Rebalance event log detail** — Instead of "0 sold, 1 bought", now shows actual shares and dollar values per ticker: e.g. `sold: QQQ -12.456sh (-$5,430.20) | bought: SCHD +45.123sh (+$1,578.22)`.
- **Annual tax tracking fixed** — `weeklyTaxCG`, `weeklyDiv`, `weeklyTaxDiv` were being double-written (sparse index assignment AND `.push()`). Removed all `.push()` calls; sparse `wi`-indexed assignment is now the single source of truth.
- **CAGR added** — Every return percentage now shows `+138.3% (+14.2%/yr)` via a shared `fmtReturn()` helper. Displayed in backtest metrics, save modal, compare table, and optimizer result cards.

---

### Backtest & Charts Tab

#### Portfolio Chart
- **Log / Linear toggle** — Two buttons in the top-right of the portfolio chart card switch between linear and logarithmic Y axis. Log scale makes early-year movements visible when the portfolio grows 10×+ over the period. Tax charts always use linear scale (log fails with zero values).

#### Max Recovery Period
- **Algorithm** — For every week `i`, finds the first week `j > i` where the portfolio recovers back to `portfolioValues[i]` after a dip. The longest such span is the maximum recovery period.
- **Metric card** — "Max recovery" shown in amber in the summary metrics row (e.g. `3.2y` or `847d`).
- **Purple band on chart** — Shaded purple region from recovery start to end on the portfolio chart.
- **Diamond markers** — Purple diamond at recovery start and end; tooltip shows dates and duration.
- **Legend entry** — Shows full recovery period dates and duration.

#### Event Log
- **All events shown** — Removed the 300-event truncation. All events stored and rendered.
- **Filter + pagination** — Text filter, type dropdown (DIV/REB/BUY/SPLIT), Show All checkbox. Default shows 200 newest events with "Show more" button (+200 per click). Count in header reflects filters.

---

### Rebalance History Table

#### CASH DEPLOY Row
- **Alloc before → after** — Shows cash % of portfolio before and after the rebalance (amber → teal).
- **Target %** — Shows the configured cash allocation target.
- **Deployed amount** — VALUE Δ column shows `cashBefore - cashAfter` (actual net cash outflow), displayed in red.
- **Remaining cash** — PRICE column shows cash balance remaining after deployment.

---

### Optimizer Tab

- **New "Find Optimized Params" button** in Run Analysis — opens the Optimizer panel.
- **Optimizer sidebar nav item** added.
- **Search algorithm** — Random search + hill climbing (perturb every 10 iterations). Yields to browser every 10 iterations to keep UI responsive.
- **Parameters optimized** — Stock allocations, rebalance method (time frequency + drift threshold + mode), cash allocation percentage.
- **Constraints** — Min/max allocation per stock, min/max cash allocation, min alloc per stock.
- **Walk-forward windows** — Window length (months) and jump size (months). Scores each candidate on the worst-case result across all windows (maximin strategy). Default 0 = full period.
- **Three result cards** — Updated live during search:
  - 🏆 **Best Value** — highest full-period final value
  - ⚡ **Best Recovery** — shortest worst-window recovery period
  - ⚖️ **Best Balanced** — best worst-window combined score (slider-weighted value vs recovery)
- **Full period row** — Each card shows both worst-window stats and full-period return/recovery/final value.
- **Score weighting slider** — "Max value ◄────► Min recovery" from 0–100%, default 50%.
- **Time limit** — Default 5 minutes, user-configurable.
- **Stop button** — Halts search; best results found so far are kept.
- **Date clamping** — Effective dates computed from DB coverage before search starts.
- **Apply this result** — Pushes optimal settings back to Run Analysis. Stock allocations are scaled to `(100 - cashPct)%` so the total display is 100%. Uses a candidate store (`_optCandStore`) with string keys to avoid JSON-in-onclick attribute quoting bugs.

---

### Bug Fixes

| Bug | Fix |
|---|---|
| Duplicate dividends from ±4-day fetch window | Exact-nearest week assignment (7-day max) |
| Dividend shown on every weekly bar of a month | `divByPriceIdx` sparse array via nearest-bar matching |
| Tax charts empty | `weeklyTaxCG/Div/Div` arrays never populated → fixed write points |
| Tax charts empty (log scale) | Tax charts always use linear scale |
| Portfolio crashes to $0 due to data gap | Gap detector in `runBacktest` aborts with clear error |
| `applyOptResult` onclick broken | Candidate store pattern avoids JSON-in-onclick |
| `showTab('optimizer')` did nothing | Removed `display:none` inline style conflicting with CSS class |
| Rebalance table blank after CASH row changes | `r` not in scope in `_applyRebalTable` → `_rebalCashAllocPct` module var |
| Tax chart Y axis broken | Removed accidental propagation of `_chartScale` to tax charts |
| CAGR `simYears` variable conflict | Renamed internal variable |
| Cash interest on wrong dates | Changed from `wi%4===0` to last bar of each calendar month |
| Cash reserve interest on portfolio % not actual cash | Changed to `Math.max(0, cash)` (actual balance) |
| `weeklyTaxCG/Div` double-write | Removed all `.push()` calls; sparse `wi` index only |

---

### GitHub
Repository: [https://github.com/maromleviner-coder/basketsim](https://github.com/maromleviner-coder/basketsim)
