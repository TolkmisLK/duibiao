import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseFile } from '../../src/core/parse';
import { compareTables } from '../../src/core/compare';
import { buildReportCsv } from '../../src/core/report';
import type { CompareOptions } from '../../src/core/types';

const exact: CompareOptions = { trimWhitespace: false, ignoreCase: false };
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const csv = (text: string) => parseFile(bytes(text), 'input.csv');

function xlsx(sheet: XLSX.WorkSheet): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '数据');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['另一张']]), '其他');
  const output = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
  const copy = new Uint8Array(output.byteLength);
  copy.set(output);
  return copy.buffer;
}

describe('CSV parsing', () => {
  it('preserves BOM, quoted newlines, quotes and leading zero strings', () => {
    const table = csv('\uFEFF编号,说明\r\n001,"第一行\r\n第二行, ""引用"""\r\n002,普通\r\n');
    expect(table.columns).toEqual(['编号', '说明']);
    expect(table.rows.map(row => row.values['编号'])).toEqual(['001', '002']);
    expect(table.rows[0].values['说明']).toBe('第一行\r\n第二行, "引用"');
    expect(table.rows[1].rowNumber).toBe(4);
  });

  it('rejects malformed quoting, empty or duplicate headers and ragged wide rows', () => {
    expect(() => csv('编号,说明\n1,"未闭合')).toThrow(/CSV 格式错误/);
    expect(() => csv('编号,   \n1,2')).toThrow(/空列名/);
    expect(() => csv('编号, 编号 \n1,2')).toThrow(/重复列名/);
    expect(() => csv('编号,说明\n1,2,3')).toThrow(/多出列/);
  });

  it('pads short CSV rows with empty strings and keeps them for key validation', () => {
    const table = csv('编号,名称,位置\n001,设备\n002');
    expect(table.rows[0].values).toMatchObject({ 编号: '001', 名称: '设备', 位置: '' });
    expect(table.rows[1].values).toMatchObject({ 编号: '002', 名称: '', 位置: '' });
  });

  it('enforces row and column bounds without silently truncating', () => {
    expect(() => csv(`${Array.from({ length: 101 }, (_, i) => `列${i}`).join(',')}\n`)).toThrow(/100 列/);
    expect(() => csv(`编号\n${'1\n'.repeat(20_001)}`)).toThrow(/20,000 数据行/);
    const header = Array.from({ length: 100 }, (_, i) => `列${i}`).join(',');
    const data = Array(100).fill('x').join(',');
    expect(() => csv(`${header}\n${`${data}\n`.repeat(5_000)}`)).toThrow(/500,000 格/);
    expect(() => csv('编号\n' + 'x'.repeat(8 * 1024 * 1024))).toThrow(/8 MB/);
  });
});

describe('XLSX parsing', () => {
  it('uses displayed number/date text, selected sheet and formula cache', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['编号', '日期', '公式'], [7, 45293, 2]]);
    sheet.A2.z = '0000';
    sheet.B2.z = 'yyyy-mm-dd';
    sheet.C2.f = '1+1';
    const buffer = xlsx(sheet);
    const table = parseFile(buffer, 'data.xlsx');
    expect(table.sheets).toEqual(['数据', '其他']);
    expect(table.sheetName).toBe('数据');
    expect(table.rows[0].values['编号']).toBe('0007');
    expect(table.rows[0].values['日期']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.rows[0].values['公式']).toBe('2');
    expect(table.warnings.join(' ')).toMatch(/缓存|日期/);
    expect(parseFile(buffer, 'data.xlsx', '其他').columns).toEqual(['另一张']);
    expect(() => parseFile(buffer, 'data.xlsx', '不存在')).toThrow(/找不到工作表/);
  });

  it('defaults to the first valid sheet and reports skipped empty or invalid headers', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '空首页');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['编号', '编号'], ['001', 'x']]), '坏表头');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['编号', '名称'], ['001', '设备']]), '有效表');
    const output = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
    const buffer = Uint8Array.from(output).buffer;
    const table = parseFile(buffer, 'sheets.xlsx');
    expect(table.sheets).toEqual(['空首页', '坏表头', '有效表']);
    expect(table.sheetName).toBe('有效表');
    expect(table.rows[0].values['编号']).toBe('001');
    expect(table.warnings[0]).toMatch(/空首页.*工作表为空.*坏表头.*重复列名.*有效表/);
    expect(() => parseFile(buffer, 'sheets.xlsx', '空首页')).toThrow(/工作表为空/);
    expect(() => parseFile(buffer, 'sheets.xlsx', '坏表头')).toThrow(/重复列名/);
  });

  it('limits automatic candidate scanning and allows explicit late-sheet selection', () => {
    const book = XLSX.utils.book_new();
    for (let index = 0; index < 32; index++) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), `空表${index + 1}`);
    }
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['编号'], ['001']]), '有效末表');
    const output = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
    const buffer = Uint8Array.from(output).buffer;
    expect(() => parseFile(buffer, 'many.xlsx')).toThrow(/最多检查 32 张工作表/);
    expect(parseFile(buffer, 'many.xlsx', '有效末表').rows[0].values['编号']).toBe('001');
  });

  it('rejects uncached formulas and oversized ZIP directory declarations', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['编号', '计算'], ['001', null]]);
    sheet.B2 = { t: 'n', f: '1+1' };
    const raw = xlsx(sheet);
    expect(() => parseFile(raw, 'data.xlsx')).toThrow(/未缓存结果/);

    const modified = raw.slice(0);
    const view = new DataView(modified);
    let central = -1;
    for (let offset = 0; offset + 46 < modified.byteLength; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) { central = offset; break; }
    }
    expect(central).toBeGreaterThan(0);
    view.setUint32(central + 24, 65 * 1024 * 1024, true);
    expect(() => parseFile(modified, 'data.xlsx')).toThrow(/目录声明的展开大小超过 64 MB/);
  });

  it('rejects unsupported and broken files', () => {
    expect(() => parseFile(bytes('abc'), 'file.xls')).toThrow(/仅支持/);
    expect(() => parseFile(bytes('abc'), 'file.xlsx')).toThrow(/ZIP 容器/);
  });

  it('rejects a sheet beyond row bounds instead of stopping early', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['编号']]);
    sheet.A20002 = { t: 's', v: '001' };
    sheet['!ref'] = 'A1:A20002';
    const buffer = xlsx(sheet);
    expect(() => parseFile(buffer, 'data.xlsx')).toThrow(/20,000 数据行/);
    // The oversized first sheet must not prevent choosing a small second sheet.
    const other = parseFile(buffer, 'data.xlsx', '其他');
    expect(other.sheetName).toBe('其他');
    expect(other.columns).toEqual(['另一张']);
    expect(other.rows).toEqual([]);
  });

  it('accepts exactly 20,000 data rows and rejects a top-offset sheet if sheetRows truncates it', () => {
    const bounded = XLSX.utils.aoa_to_sheet([['编号']]);
    bounded.A20001 = { t: 's', v: '末行' };
    bounded['!ref'] = 'A1:A20001';
    const accepted = parseFile(xlsx(bounded), 'data.xlsx');
    expect(accepted.rows).toHaveLength(20_000);
    expect(accepted.rows.at(-1)?.values['编号']).toBe('末行');

    const offset = XLSX.utils.aoa_to_sheet([]);
    offset.A100 = { t: 's', v: '编号' };
    offset.A20100 = { t: 's', v: '末行' };
    offset['!ref'] = 'A100:A20100';
    expect(() => parseFile(xlsx(offset), 'data.xlsx')).toThrow(/截断读取/);
  });
});

describe('comparison and report', () => {
  it('ignores row order and reports schema and value changes', () => {
    const before = csv('编号,旧列,值\n001,旧,Alpha\n002,旧,Beta');
    const after = csv('编号,值,新列\n002,Beta,新\n001, alpha ,新');
    const result = compareTables(before, after, '编号', { trimWhitespace: true, ignoreCase: true });
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 2, unchanged: 0 });
    expect(result.addedColumns).toEqual(['新列']);
    expect(result.removedColumns).toEqual(['旧列']);
    expect(result.rows[0].changes.map(change => change.column)).toEqual(['旧列', '新列']);
    expect(result.rows[1].changes.map(change => change.column)).toEqual(['旧列', '新列']);
    const reordered = compareTables(csv('编号,值\n001,a\n002,b'), csv('编号,值\n002,b\n001,a'), '编号', exact);
    expect(reordered.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 });
  });

  it('stops the entire comparison when either side has duplicate or empty normalized keys', () => {
    const before = csv('编号,值\n001,a\n 001 ,b\n,c');
    const after = csv('编号,值\n001,a\n002,b');
    const result = compareTables(before, after, '编号', { trimWhitespace: true, ignoreCase: false });
    expect(result.issues.map(issue => issue.kind)).toEqual(['empty', 'duplicate']);
    expect(result.issues[1].rowNumbers).toEqual([2, 3]);
    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 0 });
    expect(() => buildReportCsv(result)).toThrow(/不能导出/);
    expect(before.rows[1].values['编号']).toBe(' 001 ');
  });

  it('handles __proto__ as data without prototype pollution', () => {
    const before = csv('__proto__,值\n001,a');
    const after = csv('__proto__,值\n001,b');
    expect(Object.getPrototypeOf(before.rows[0].values)).toBeNull();
    const result = compareTables(before, after, '__proto__', exact);
    expect(result.summary.modified).toBe(1);
    expect(result.rows[0].key).toBe('001');
  });

  it('quotes CSV and neutralizes spreadsheet formula prefixes in all fields', () => {
    const before = csv('编号,说明\n001,原值');
    const after = csv('编号,说明\n001," =1+1,\n"');
    const result = compareTables(before, after, '编号', exact);
    result.rows[0].key = '+danger';
    result.rows[0].changes[0].column = '@列';
    result.rows[0].changes[0].before = '\t=cmd';
    result.rows[0].changes[0].after = '\r-危险,"引号"';
    const report = buildReportCsv(result);
    expect(report.startsWith('\uFEFF')).toBe(true);
    const parsed = Papa.parse<string[]>(report.replace(/^\uFEFF/, '')).data;
    expect(parsed[1]).toEqual(['修改', "'+danger", "'@列", "'\t=cmd", "'\r-危险,\"引号\"", '是', '是']);
  });
});
