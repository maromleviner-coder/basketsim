# BasketSim — Testing Plan

## Scope & Approach

BasketSim is a single-file HTML app (~5400 lines). Rather than testing through a real
browser (slow, hard to automate reliably for a single session), we extract the pure
logic functions and run them in Node.js with synthetic data. This covers the highest-risk
code: the simulation engine, dividend/date math, and formatting helpers — exactly the
areas where the bugs found so far have lived (double-writes, sign errors, off-by-one
date logic, scope bugs).

**What we test (Node, no browser):**
1. `simulate()` — the core engine. Fully testable in isolation since it takes all
   inputs as parameters and returns a plain result object.
2. `cleanDivs()` / `mergeByDate()` — dividend deduplication.
3. `generateWeeks()` / `utcDateStr()` / `addDays()` — date arithmetic.
4. `buildWindowIndex()` / `buildPriceWindowIndex()` — price/dividend lookup indexes.
5. `fmtReturn()` / `fmtM()` / `fmt()` / `fmt2()` — display formatting.
6. Cross-checks between fields in the `simulate()` return object (e.g. does
   `totalTaxPaid === totalTaxCGPaid + totalTaxDivPaid`, do annual sums match totals).

**What we test (static analysis, no browser):**
7. Syntax validity of the extracted `<script>` block (already done ad-hoc; now a
   permanent check).
8. Every `onclick="fnName(...)"` in the HTML has a matching `function fnName` defined.
9. Every `document.getElementById('X')` referenced in JS has a matching `id="X"`
   somewhere in the HTML (catches the exact class of scope/typo bugs we hit before).
10. No `//` comments inside multi-line string-concatenation expressions (the exact
    bug that broke the rebalance table).

**What we do NOT test automatically (needs manual/visual review):**
- Chart.js rendering correctness (canvas pixels) — visual only.
- Actual network fetch from Yahoo Finance — needs live network + real market data.
- LocalStorage DB persistence across page reloads — needs a real browser session.
- CSS layout / responsiveness.

For these, I'll list specific manual check steps at the end and flag anything I'm
unsure is a bug vs. intended behavior for us to review together.

---

## Test Cases

### A. Simulation Engine (`simulate()`)

| # | Test | Expected |
|---|---|---|
| A1 | Single stock, no rebalance, no cash, no dividends, flat price | `finalVal == totalInvested`, `totalReturn == 0`, `cagr == 0` |
| A2 | Single stock, price doubles over 1 year, no dividends | `totalReturn ≈ 100%`, `cagr ≈ 100%` |
| A3 | Two stocks 50/50, one doubles one halves, no rebalance | Final value = avg of the two multiples × capital |
| A4 | Dividend paid once, no reinvestment until rebalance | Dividend appears in `totalDivReceived`, cash balance increases by net amount, `divByStock` has the right ticker |
| A5 | Two dividends 3 days apart (simulating chunk-boundary duplicate) | Only ONE dividend counted after `cleanDivs`, not two |
| A6 | Cash allocation 20%, no yield | Initial cash == 20% of capital exactly; stock allocations sum to 80% of capital |
| A7 | Cash allocation 10%, yield 12%/yr | Interest fires exactly once per calendar month, monthly amount ≈ 1% of cash reserve (12/12) |
| A8 | Drift rebalance, absolute mode, threshold 5pp, target 50% | Rebalance fires when actual allocation is more than 5 percentage points from 50% |
| A9 | Drift rebalance, relative mode, threshold 10%, target 20% | Rebalance fires when actual allocation is more than 2pp from 20% (10% of 20) |
| A10 | Time rebalance quarterly, allocations already at target | Logged as "no action" — rebalEvents should NOT contain a phantom trade |
| A11 | Portfolio value never drops below start | `maxDD == 0`, `maxRecoveryDays == 0` |
| A12 | Portfolio drops 50% then recovers to exactly the pre-drop value | `maxRecoveryWeeks` matches the exact number of weeks between drop-start and recovery |
| A13 | Weekly tax arrays (`weeklyTaxCG`, `weeklyDiv`, `weeklyTaxDiv`) sum correctly | `sum(weeklyTaxCG) ≈ totalTaxCGPaid`, `sum(weeklyDiv) ≈ totalDivReceived` (minus cash interest), annual sums match totals |
| A14 | `totalTaxPaid == totalTaxCGPaid + totalTaxDivPaid` | Always true, by construction |
| A15 | Stock price data has a gap covering the full period | Returns should not crash; holdings should reflect graceful degradation (0 price handling) |

### B. Dividend Deduplication (`cleanDivs`)

| # | Test | Expected |
|---|---|---|
| B1 | Two entries, same month, same amount | 1 entry kept |
| B2 | Two entries, 3 days apart, amounts within 15% | 1 entry kept (rule b) |
| B3 | Two entries, 45 days apart, different months | Both kept (legitimately different dividends) |
| B4 | Empty array | Returns `[]`, no crash |
| B5 | Quarterly dividend pattern over 2 years (8 dividends, no duplicates) | All 8 kept unchanged |

### C. Date Arithmetic

| # | Test | Expected |
|---|---|---|
| C1 | `generateWeeks('2020-01-01','2020-12-31')` | ~52 weekly bars, all Mondays (or consistent weekday), strictly increasing |
| C2 | `addDays('2024-02-28', 1)` | `'2024-02-29'` (leap year handled) |
| C3 | `addDays('2023-12-31', 1)` | `'2024-01-01'` (year rollover) |
| C4 | `utcDateStr` round-trips with `generateWeeks` output | No off-by-one day errors |

### D. Formatting

| # | Test | Expected |
|---|---|---|
| D1 | `fmtReturn(138.3, 14.2)` | `"+138.3% (+14.2%/yr)"` |
| D2 | `fmtReturn(-25.5, -8.1)` | `"-25.5% (-8.1%/yr)"` |
| D3 | `fmtReturn(0, null)` | `"+0.0%"` (no CAGR suffix when null) |
| D4 | `fmtM(1250000)` | `"$1.25M"` |
| D5 | `fmtM(2500)` | `"$2.5k"` (or similar) |

### E. Static Analysis

| # | Test | Expected |
|---|---|---|
| E1 | Extract `<script>`, run `node --check` | No syntax errors |
| E2 | Every `onclick="fn(...)"` has a matching `function fn` | No dangling onclick handlers |
| E3 | Every `getElementById('X')` in JS has `id="X"` in HTML | No scope/typo bugs like we hit with `cashHighPct` |
| E4 | No `//` line-comment appears inside a `+'...'` concatenation chain (heuristic) | Catches the rebalance-table-blank bug class |
| E5 | No duplicate `function name(` declarations in the same scope | Catches redeclaration crashes like `cashAllocPct` |

---

## Execution Order

1. Build a Node test harness that extracts the `<script>` block and evals it in a
   sandboxed context with the minimum DOM stub needed (mostly none — `simulate()` and
   friends don't touch DOM).
2. Run static analysis checks (E1–E5) first — fastest, catches structural bugs.
3. Run pure-logic unit tests (A–D) — catches behavioral/math bugs.
4. Report all failures with the specific line/values that broke.
5. For anything ambiguous (test fails but might be intentional behavior), flag it
   separately for us to review together rather than "fixing" it unilaterally.

Let's go.
