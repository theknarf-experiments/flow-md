---
title: CSV data
tags: [reference]
order: 10
---

# CSV files as relations

Drop a `.csv` into the vault and every cell becomes a fact. The header row
names the columns; data rows are numbered from 1:

- `CsvCell(path, row, col, value)` — one fact per cell, value as a string.
- `CsvNumber(path, row, col, num)` — typed sidecar for numeric cells, so
  rules can compare and aggregate.

This vault contains [[budget|budget.csv]]. Every cell of it:

```datalog-query
CsvCell(path, row, col, value)
```

## Reassembling rows

A rule can pivot cells back into wide rows by joining on the row number:

```datalog
BudgetItem(item, cost, category) :-
  CsvCell(p, r, "item", item),
  CsvNumber(p, r, "cost", cost),
  CsvCell(p, r, "category", category).
```

```datalog-query
BudgetItem(item, cost, category)
```

## Joining CSV against notes

Anything over 300 is "big spend" — a threshold comparison on the typed
number column:

```datalog
BigSpend(item, cost) :- BudgetItem(item, cost, _), cost > 300.
```

```datalog-query
BigSpend(item, cost)
```

In the web app, `.csv` files also get a spreadsheet-ish editor (Tanstack
Table): click a cell to edit, add or delete rows — every change feeds the
facts above incrementally.
