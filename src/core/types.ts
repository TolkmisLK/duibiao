export interface TableRow { rowNumber: number; values: Record<string, string>; }
export interface TableData { name: string; sheetName?: string; sheets?: string[]; columns: string[]; rows: TableRow[]; warnings: string[]; }
export interface CompareOptions { trimWhitespace: boolean; ignoreCase: boolean; }
export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';
export interface CellChange { column: string; before: string | null; after: string | null; }
export interface DiffRow { key: string; status: DiffStatus; before?: TableRow; after?: TableRow; changes: CellChange[]; }
export interface KeyIssue { side: 'before' | 'after'; kind: 'empty' | 'duplicate'; key: string; rowNumbers: number[]; }
export interface CompareResult { keyColumn: string; columns: string[]; sharedColumns: string[]; addedColumns: string[]; removedColumns: string[]; rows: DiffRow[]; summary: Record<DiffStatus, number>; issues: KeyIssue[]; options: CompareOptions; }
