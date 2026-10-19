# Duibiao

Duibiao is a browser-based table diff tool. It aligns two CSV or basic XLSX tables by one selected key column, then shows added, removed, modified, and unchanged rows with before/after field values.

[中文说明](../README.md) · [中文使用指南](USER-GUIDE.zh-CN.md) · [Web app](https://tolkmislk.github.io/duibiao/) · [Source](https://github.com/TolkmisLK/duibiao)

## Use it

1. Choose the old and new files. CSV must be UTF-8 and comma-delimited. For XLSX, the app checks up to the first 32 worksheets, skips empty sheets or sheets with invalid headers, selects the first valid sheet, and explains what it skipped.
2. Select a shared column with the same meaning on both sides, such as `Device ID`.
3. Run the comparison, review key diagnostics and row changes, then export CSV or JSON.

You can explicitly select another worksheet. If that sheet is invalid, the selector remains available so you can return to a valid one. Oversized worksheets and damaged XLSX files fail immediately instead of being skipped.

Matching is text-based and exact by default, so `001` and `1` are different keys. Optional settings can ignore surrounding whitespace or letter case in both keys and compared field values.

## Scope and limits

- UTF-8 comma-delimited CSV and basic XLSX value comparison; XLSX formulas use cached results and are not recalculated.
- Up to 8 MB per file, 20,000 data rows, 100 columns, and 500,000 cells per selected sheet. Available browser memory may impose a lower practical limit.
- Files are parsed in the current browser page and are not uploaded by the app. Page data is cleared on refresh or close; downloaded reports remain on the user's device.
- Source files are read-only. CSV exports prefix formula-like values to reduce spreadsheet formula injection risk.
- Complex formatting, charts, macros, comments, and merged-cell semantics are not preserved or compared faithfully.

## Development

Node.js 22.12 or newer is required.

```bash
npm ci
npm run dev
npm run test
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Built with React, TypeScript, Vite 8, Papa Parse, SheetJS, Vitest, and Playwright. See [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and the [MIT License](../LICENSE).
