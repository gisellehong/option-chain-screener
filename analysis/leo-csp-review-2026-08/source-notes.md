# Source notes

- Audience: product stakeholders / strategy decision.
- Delivery mode: portable HTML; Markdown retained as editable supporting source.
- Required structure mapping:
  - Title → title block.
  - Executive Summary → visible second block.
  - Key findings with visual evidence → Delta chart, entry table, exit table, method comparison table.
  - Recommended next steps → recommendations block.
  - Further questions → further-questions block.
  - Caveats and assumptions → final caveats block.
- Primary sources: four supplied IBKR screenshots; local Moomoo snapshot archives from July 30 through August 6, 2026; `src/data/screenerConfigs.ts`; `src/lib/scoring.ts`; `README.md` tracking definition.
- Omitted visual: no time-series chart because the source contains discrete fills and only a few paired exits, not enough comparable time points for an honest trend.
- Chart map:
  - Section: Strike selection.
  - Question: How aggressive were entry strikes versus the current Middle-case threshold?
  - Family/type: Comparison / horizontal bar.
  - Fields: contract, absolute Delta; signed Delta, IV, DTE, evidence status retained for tooltip/source table.
  - Claim: 8 of 9 estimable entries exceed |Delta| 0.25.
  - Palette: single-root identity blue; neutral dashed 0.25 reference.
  - Delivery: `report.html`, chart id `entry_delta`.
- External search note: the TSM August 3, 2026 historical-price search returned no usable non-Chinese result; no external price was substituted for the missing local source.

