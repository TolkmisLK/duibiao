import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { TableData, TableRow } from './types';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 500_000;
const MAX_AUTO_SHEETS = 32;

class SkippableSheetError extends Error {}

function checkSize(buffer: ArrayBuffer): void {
  if (buffer.byteLength === 0) throw new Error('文件为空。');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('文件超过 8 MB 限制。');
}

function checkShape(rows: number, columns: number): void {
  if (columns > MAX_COLUMNS) throw new Error('表格超过 100 列限制。');
  if (rows > MAX_ROWS) throw new Error('表格超过 20,000 数据行限制。');
  if ((rows + 1) * columns > MAX_CELLS) throw new Error('表格超过 500,000 格限制。');
}

function validateHeaders(headers: string[]): void {
  if (!headers.length) throw new Error('表格缺少表头。');
  checkShape(0, headers.length);
  const seen = new Set<string>();
  for (const header of headers) {
    const normalized = header.trim();
    if (!normalized) throw new Error('表头包含空列名，请先补全。');
    if (seen.has(normalized)) throw new Error(`表头包含重复列名：${normalized}`);
    seen.add(normalized);
  }
}

function makeRow(columns: string[], cells: string[], rowNumber: number): TableRow {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  columns.forEach((column, index) => { values[column] = cells[index] ?? ''; });
  return { rowNumber, values };
}

function parseCsv(buffer: ArrayBuffer, name: string): TableData {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('CSV 不是有效的 UTF-8 编码，请先转换编码。');
  }
  const text = source.replace(/^\uFEFF/, '');
  let headers: string[] | undefined;
  const rows: TableRow[] = [];
  let error: Error | undefined;
  let cursor = 0;
  let physicalLine = 1;
  Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: false,
    step(result, parser) {
      if (error) return;
      if (result.errors.length) {
        error = new Error(`CSV 格式错误：${result.errors[0].message}`);
        parser.abort();
        return;
      }
      const startLine = physicalLine;
      const nextCursor = result.meta.cursor;
      const consumed = text.slice(cursor, nextCursor);
      physicalLine += (consumed.match(/\r\n|\r|\n/g) ?? []).length;
      cursor = nextCursor;
      const cells = result.data;
      if (!headers) {
        headers = cells;
        try { validateHeaders(headers); } catch (cause) {
          error = cause as Error;
          parser.abort();
        }
        return;
      }
      // A completely blank physical line is ignored. Delimited empty cells remain data.
      if (cells.length === 1 && cells[0] === '') return;
      if (cells.length > headers.length) {
        error = new Error(`第 ${startLine} 行比表头多出列，请修正列宽。`);
        parser.abort();
        return;
      }
      rows.push(makeRow(headers, cells, startLine));
      try { checkShape(rows.length, headers.length); } catch (cause) {
        error = cause as Error;
        parser.abort();
      }
    },
  });
  if (error) throw error;
  if (!headers) throw new Error('CSV 缺少表头。');
  return { name, columns: headers, rows, warnings: [] };
}

// Reject oversized declared ZIP expansion before SheetJS reads workbook parts.
// Central-directory metadata is a screening check, not a strict memory cap.
function checkXlsxZip(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('XLSX 文件不是有效的 ZIP 容器。');
  }
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('XLSX ZIP 目录不完整。');
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (disk || centralDisk || diskEntries !== entries || entries === 0 || entries === 0xffff ||
      directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('不支持多卷或 ZIP64 XLSX 文件。');
  }
  if (directoryOffset + directorySize > eocd) throw new Error('XLSX ZIP 目录范围无效。');
  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('XLSX ZIP 目录条目损坏。');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 0x0001 || flags & 0x0040) throw new Error('不支持加密 XLSX 文件。');
    if (method !== 0 && method !== 8) throw new Error('XLSX 包含不支持的压缩方式。');
    if (uncompressed === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('不支持 ZIP64 XLSX 文件。');
    }
    if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('XLSX ZIP 本地条目损坏。');
    }
    total += uncompressed;
    if (total > MAX_UNZIPPED_BYTES) throw new Error('XLSX ZIP 目录声明的展开大小超过 64 MB 限制。');
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize) throw new Error('XLSX ZIP 目录大小不一致。');
}

function displayCell(cell: XLSX.CellObject | undefined, warnings: string[]): string {
  if (!cell) return '';
  if (cell.f !== undefined) {
    if (cell.v === undefined || cell.v === null) {
      throw new Error('XLSX 含有未缓存结果的公式，请在表格软件中重新计算并保存。');
    }
    if (!warnings.includes('公式使用文件中缓存的结果，本工具不重新计算公式。')) {
      warnings.push('公式使用文件中缓存的结果，本工具不重新计算公式。');
    }
  }
  if (cell.t === 'e') throw new Error('XLSX 包含公式或单元格错误，请先修正。');
  if (cell.w !== undefined) return String(cell.w);
  if (cell.v === undefined || cell.v === null) return '';
  return XLSX.utils.format_cell(cell);
}

function parseXlsxSheet(buffer: ArrayBuffer, name: string, sheets: string[], selected: string): TableData {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'array', sheets: selected, cellText: true, cellDates: false,
      // Header + maximum data rows + one sentinel row, so overflow is visible.
      sheetRows: MAX_ROWS + 2,
    });
  } catch {
    throw new Error('XLSX 文件损坏、加密或格式不受支持。');
  }
  const sheet = workbook.Sheets[selected];
  if (!sheet?.['!ref']) throw new SkippableSheetError('工作表为空。');
  // !fullref is set by SheetJS when sheetRows shortened the original range.
  // Reject even when a top offset makes the full range appear within our row count.
  if (sheet['!fullref']) throw new Error('工作表超出 20,000 数据行解析范围，不能截断读取。');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const columnCount = range.e.c - range.s.c + 1;
  const rowCount = range.e.r - range.s.r;
  checkShape(rowCount, columnCount);
  const warnings: string[] = ['XLSX 日期和数字按文件内显示格式读取；不同表格软件可能显示不同结果。'];
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const address = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + index });
    return displayCell(sheet[address], warnings);
  });
  try {
    validateHeaders(columns);
  } catch (cause) {
    throw new SkippableSheetError((cause as Error).message);
  }
  const rows: TableRow[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex++) {
    const cells = columns.map((_, columnIndex) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + columnIndex });
      return displayCell(sheet[address], warnings);
    });
    // Empty sheet rows are retained so that a blank key is surfaced during comparison.
    rows.push(makeRow(columns, cells, rowIndex + 1));
  }
  return { name, sheetName: selected, sheets, columns, rows, warnings };
}

function parseXlsx(buffer: ArrayBuffer, name: string, sheetName?: string): TableData {
  checkXlsxZip(buffer);
  let sheets: string[];
  try {
    sheets = XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames;
  } catch {
    throw new Error('XLSX 文件损坏、加密或格式不受支持。');
  }
  if (!sheets.length) throw new Error('XLSX 没有工作表。');
  if (sheetName !== undefined) {
    if (!sheets.includes(sheetName)) throw new Error(`找不到工作表：${sheetName}`);
    return parseXlsxSheet(buffer, name, sheets, sheetName);
  }
  const skipped: string[] = [];
  let firstError: Error | undefined;
  for (const selected of sheets.slice(0, MAX_AUTO_SHEETS)) {
    try {
      const table = parseXlsxSheet(buffer, name, sheets, selected);
      if (skipped.length) {
        table.warnings.unshift(`已跳过 ${skipped.join('；')}。已选择工作表「${selected}」。`);
      }
      return table;
    } catch (cause) {
      if (!(cause instanceof SkippableSheetError)) throw cause;
      const reason = `「${selected}」：${cause.message}`;
      skipped.push(reason);
      firstError ??= new Error(reason);
    }
  }
  if (sheets.length > MAX_AUTO_SHEETS) {
    throw new Error(`自动选择最多检查 ${MAX_AUTO_SHEETS} 张工作表；前序工作表为空或表头无效。请明确选择工作表。首个问题：${firstError?.message ?? '未知'}`);
  }
  throw firstError ?? new Error('XLSX 没有可读取的工作表。');
}

export function parseFile(buffer: ArrayBuffer, name: string, sheetName?: string): TableData {
  checkSize(buffer);
  if (/\.csv$/i.test(name)) return parseCsv(buffer, name);
  if (/\.xlsx$/i.test(name)) return parseXlsx(buffer, name, sheetName);
  throw new Error('仅支持 UTF-8 CSV 和 .xlsx 文件。');
}
