import type { CompareOptions, CompareResult, DiffRow, DiffStatus, KeyIssue, TableData, TableRow } from './types';

function normalize(value: string, options: CompareOptions): string {
  let result = options.trimWhitespace ? value.trim() : value;
  if (options.ignoreCase) result = result.toLowerCase();
  return result;
}

function keyIndex(table: TableData, side: 'before' | 'after', keyColumn: string, options: CompareOptions): {
  index: Map<string, TableRow>;
  issues: KeyIssue[];
} {
  const buckets = new Map<string, TableRow[]>();
  const issues: KeyIssue[] = [];
  for (const row of table.rows) {
    const key = normalize(row.values[keyColumn] ?? '', options);
    if (key === '') {
      issues.push({ side, kind: 'empty', key, rowNumbers: [row.rowNumber] });
      continue;
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const index = new Map<string, TableRow>();
  for (const [key, bucket] of buckets) {
    if (bucket.length > 1) {
      issues.push({ side, kind: 'duplicate', key, rowNumbers: bucket.map(row => row.rowNumber) });
    } else {
      index.set(key, bucket[0]);
    }
  }
  return { index, issues };
}

export function compareTables(before: TableData, after: TableData, keyColumn: string, options: CompareOptions): CompareResult {
  if (!before.columns.includes(keyColumn) || !after.columns.includes(keyColumn)) {
    throw new Error('主键列必须同时存在于两张表中。');
  }
  const columns = [...before.columns, ...after.columns.filter(column => !before.columns.includes(column))];
  const sharedColumns = before.columns.filter(column => after.columns.includes(column));
  const addedColumns = after.columns.filter(column => !before.columns.includes(column));
  const removedColumns = before.columns.filter(column => !after.columns.includes(column));
  const beforeKeys = keyIndex(before, 'before', keyColumn, options);
  const afterKeys = keyIndex(after, 'after', keyColumn, options);
  const issues = [...beforeKeys.issues, ...afterKeys.issues];
  const summary: Record<DiffStatus, number> = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const result: CompareResult = {
    keyColumn, columns, sharedColumns, addedColumns, removedColumns,
    rows: [], summary, issues, options: { ...options },
  };
  if (issues.length) return result;

  const orderedKeys = [...beforeKeys.index.keys(), ...[...afterKeys.index.keys()].filter(key => !beforeKeys.index.has(key))];
  const rows: DiffRow[] = [];
  for (const key of orderedKeys) {
    const oldRow = beforeKeys.index.get(key);
    const newRow = afterKeys.index.get(key);
    const changes = columns.flatMap(column => {
      const oldExists = oldRow !== undefined && before.columns.includes(column);
      const newExists = newRow !== undefined && after.columns.includes(column);
      const oldValue = oldExists ? (oldRow.values[column] ?? '') : null;
      const newValue = newExists ? (newRow.values[column] ?? '') : null;
      if (oldValue === null && newValue === null) return [];
      if (oldValue !== null && newValue !== null && normalize(oldValue, options) === normalize(newValue, options)) return [];
      return [{ column, before: oldValue, after: newValue }];
    });
    const status: DiffStatus = !oldRow ? 'added' : !newRow ? 'removed' : changes.length ? 'modified' : 'unchanged';
    summary[status]++;
    rows.push({ key, status, before: oldRow, after: newRow, changes });
  }
  result.rows = rows;
  return result;
}
