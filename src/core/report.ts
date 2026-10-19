import type { CompareResult } from './types';

const STATUS: Record<string, string> = {
  added: '新增', removed: '删除', modified: '修改', unchanged: '未变化',
};

function safeCell(value: string): string {
  // Spreadsheet programs may evaluate imported cells, even after whitespace.
  const neutralized = /^[\t\r\n]|^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function buildReportCsv(result: CompareResult): string {
  if (result.issues.length) throw new Error('主键存在空值或重复值，不能导出不完整的差异报告。');
  const lines: string[][] = [['状态', '主键', '字段', '修改前', '修改后', '修改前存在', '修改后存在']];
  for (const row of result.rows) {
    if (!row.changes.length) {
      lines.push([STATUS[row.status], row.key, '', '', '', '', '']);
      continue;
    }
    for (const change of row.changes) {
      lines.push([
        STATUS[row.status], row.key, change.column, change.before ?? '', change.after ?? '',
        change.before === null ? '否' : '是', change.after === null ? '否' : '是',
      ]);
    }
  }
  return `\uFEFF${lines.map(line => line.map(safeCell).join(',')).join('\r\n')}\r\n`;
}
