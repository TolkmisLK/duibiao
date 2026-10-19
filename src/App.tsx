import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { compareTables } from './core/compare';
import { buildReportCsv } from './core/report';
import type { CompareOptions, CompareResult, DiffRow, DiffStatus, TableData } from './core/types';
import { parseInWorker } from './parse-client';
import { sampleTables } from './sample';

type Side = 'before' | 'after';
type Slot = { file?: File; table?: TableData; sheets?: string[]; selectedSheet?: string; pending: boolean; error?: string };
type Filter = 'all' | DiffStatus;

const emptySlot = (): Slot => ({ pending: false });
const statusLabels: Record<DiffStatus, string> = {
  added: '新增', removed: '删除', modified: '修改', unchanged: '不变',
};
const filterLabels: Record<Filter, string> = { all: '全部', ...statusLabels };
const initialOptions: CompareOptions = { trimWhitespace: false, ignoreCase: false };
const maxFileSize = 8 * 1024 * 1024;
const startupSample = new URLSearchParams(window.location.search).get('example') === '1' ? sampleTables() : null;

function escapeCsvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function makeSampleCsv(table: TableData): string {
  const lines = [table.columns, ...table.rows.map((row) => table.columns.map((column) => row.values[column] ?? ''))];
  return '\uFEFF' + lines.map((line) => line.map(escapeCsvCell).join(',')).join('\r\n');
}

function download(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TablePreview({ table }: { table: TableData }) {
  return (
    <div className="preview">
      <div className="preview-heading"><span>数据预览</span><span>{table.columns.length} 列 · {table.rows.length} 行</span></div>
      <div className="table-scroll" tabIndex={0} aria-label={`${table.name} 数据预览，可横向滚动`}>
        <table className="data-table preview-table">
          <thead><tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{table.rows.slice(0, 3).map((row) => <tr key={row.rowNumber}>{table.columns.map((column) => <td key={column}>{row.values[column] || <span className="muted">—</span>}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {table.rows.length > 3 && <p className="preview-foot">仅预览前 3 行，比较时会读取全部数据。</p>}
    </div>
  );
}

function UploadPanel({ side, slot, onFile, onSheet, onClear, disabled }: {
  side: Side;
  slot: Slot;
  onFile: (side: Side, file: File) => void;
  onSheet: (side: Side, sheet: string) => void;
  onClear: (side: Side) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const name = side === 'before' ? '旧表' : '新表';
  const index = side === 'before' ? '01' : '02';
  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(side, file);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onFile(side, file);
  };
  return (
    <section className="upload-panel" aria-labelledby={`${side}-heading`}>
      <div className="panel-top"><span className="step-number">{index}</span><div><h3 id={`${side}-heading`}>{name}</h3><p>{side === 'before' ? '变更前的清单' : '变更后的清单'}</p></div></div>
      <div className={`drop-zone${dragging ? ' is-dragging' : ''}${slot.file || slot.table ? ' has-file' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}>
        <div className="upload-mark" aria-hidden="true">↥</div>
        <div className="drop-copy">
          <strong>{slot.pending ? '正在读取…' : slot.table?.name ?? slot.file?.name ?? '把文件拖到这里'}</strong>
          <span>{slot.file || slot.table ? '可以重新选择文件替换' : '或从电脑选择一份清单'}</span>
        </div>
        <input ref={inputRef} id={`${side}-file`} className="visually-hidden" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onChoose} disabled={disabled} aria-label={`选择${name}文件`} />
        <button className="button button-outline" type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>{slot.file || slot.table ? '替换文件' : '选择文件'}</button>
        <span className="drop-meta">CSV 或 XLSX · 单文件不超过 8 MB</span>
      </div>
      {slot.error && <p className="field-error" role="alert">{slot.error}</p>}
      {(slot.file || slot.table) && <>
        <div className="file-controls">
          {slot.sheets && slot.sheets.length > 1 && slot.file && <label className="sheet-control">工作表
            <select value={slot.selectedSheet ?? slot.sheets[0]} disabled={disabled} onChange={(event) => onSheet(side, event.target.value)}>{slot.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select>
          </label>}
          <button className="text-button" type="button" onClick={() => onClear(side)} disabled={disabled}>移除此表</button>
        </div>
      </>}
      {slot.table && <>{slot.table.warnings.length > 0 && <div className="parse-warning" role="status">{slot.table.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div>}<TablePreview table={slot.table} /></>}
    </section>
  );
}

function RowDetails({ row, columns }: { row: DiffRow; columns: string[] }) {
  const changed = new Set(row.changes.map((change) => change.column));
  return (
    <div className="detail-scroll">
      <table className="detail-table"><thead><tr><th scope="col">字段</th><th scope="col">旧表</th><th scope="col">新表</th></tr></thead>
        <tbody>{columns.map((column) => {
          const before = row.before?.values[column];
          const after = row.after?.values[column];
          return <tr key={column} className={changed.has(column) ? 'changed-cell' : ''}><th scope="row">{column}{changed.has(column) && <span className="change-word">已变更</span>}</th><td>{before == null ? <span className="muted">（不存在）</span> : before === '' ? <span className="muted">（空）</span> : before}</td><td>{after == null ? <span className="muted">（不存在）</span> : after === '' ? <span className="muted">（空）</span> : after}</td></tr>;
        })}</tbody></table>
    </div>
  );
}

function Results({ result }: { result: CompareResult }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const valid = result.issues.length === 0;
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return result.rows.filter((row) => (filter === 'all' || row.status === filter) && (!needle || [row.key, ...Object.values(row.before?.values ?? {}), ...Object.values(row.after?.values ?? {})].some((value) => value.toLocaleLowerCase().includes(needle))));
  }, [filter, query, result]);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages);
  const pageRows = rows.slice((currentPage - 1) * 50, currentPage * 50);

  if (!valid) return (
    <section className="results-section issues-section" aria-labelledby="issues-title">
      <div className="section-kicker">需要处理</div><h2 id="issues-title" tabIndex={-1}>主键有冲突，暂时无法给出可靠结果</h2>
      <p className="section-intro">请检查下列行，或改选能唯一标识每一行的字段。解决后重新比较。</p>
      <ul className="issue-list">{result.issues.slice(0, 20).map((issue, index) => <li key={`${issue.side}-${issue.kind}-${issue.key}-${index}`}><strong>{issue.side === 'before' ? '旧表' : '新表'} · {issue.kind === 'empty' ? '空主键' : '重复主键'}</strong><span>{issue.kind === 'duplicate' ? `值「${issue.key}」` : '主键为空'} · 第 {issue.rowNumbers.join('、')} 行</span></li>)}</ul>
      {result.issues.length > 20 && <p className="muted">另有 {result.issues.length - 20} 项问题。请先处理已显示的问题，再重新比较。</p>}
    </section>
  );

  return (
    <section className="results-section" aria-labelledby="results-title">
      <div className="result-heading"><div><div className="section-kicker">比较完成</div><h2 id="results-title" tabIndex={-1}>变化，一目了然。</h2><p className="section-intro">以「{result.keyColumn}」匹配每一行。行顺序不同不会被算作修改。</p></div>
        <div className="export-actions"><button type="button" className="button button-outline" onClick={() => download(buildReportCsv(result), '对表-差异报告.csv', 'text/csv;charset=utf-8')}>导出 CSV</button><button type="button" className="button button-outline" onClick={() => download(JSON.stringify(result, null, 2), '对表-差异报告.json', 'application/json;charset=utf-8')}>导出 JSON</button></div>
      </div>
      <div className="summary-grid" aria-label="比较统计">{(['added', 'removed', 'modified', 'unchanged'] as const).map((status) => <div key={status} className={`summary-item status-${status}`}><span className="summary-label">{statusLabels[status]}</span><strong>{result.summary[status]}</strong><span className="summary-unit">行</span></div>)}</div>
      {(result.addedColumns.length > 0 || result.removedColumns.length > 0) && <div className="column-note"><strong>字段结构有变化</strong>{result.addedColumns.length > 0 && <span>新增列：{result.addedColumns.join('、')}</span>}{result.removedColumns.length > 0 && <span>删除列：{result.removedColumns.join('、')}</span>}<small>新增或删除的列会在行详情中展示；请结合字段结构变化判断结果。</small></div>}
      <div className="results-toolbar"><div className="filter-list" aria-label="按状态筛选">{(['all', 'added', 'removed', 'modified', 'unchanged'] as const).map((value) => <button type="button" key={value} className={`filter-button${filter === value ? ' is-active' : ''}`} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{filterLabels[value]}<span>{value === 'all' ? result.rows.length : result.summary[value]}</span></button>)}</div>
        <label className="search-field"><span className="visually-hidden">搜索比较结果</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索编号或字段内容" /></label>
      </div>
      <div className="result-list" aria-live="polite"><div className="result-list-head"><span>编号 / 状态</span><span>变化摘要</span></div>
        {pageRows.length ? pageRows.map((row, index) => <details className="result-row" key={`${row.status}-${row.key}-${index}`}><summary><span className="row-identity"><strong>{row.key}</strong><span className={`status-chip status-${row.status}`}>{statusLabels[row.status]}</span></span><span className="row-excerpt">{row.status === 'modified' ? row.changes.map((change) => change.column).join('、') : row.status === 'added' ? '仅在新表中' : row.status === 'removed' ? '仅在旧表中' : '内容一致'}</span><span className="row-chevron" aria-hidden="true">⌄</span></summary><RowDetails row={row} columns={result.columns} /></details>) : <div className="no-results">没有符合条件的行。试试其他状态或搜索词。</div>}
      </div>
      <div className="pagination"><span>显示 {rows.length ? (currentPage - 1) * 50 + 1 : 0}–{Math.min(currentPage * 50, rows.length)} / {rows.length} 行</span><div><button type="button" className="page-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {pages} 页</span><button type="button" className="page-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
    </section>
  );
}

export default function App() {
  const [before, setBefore] = useState<Slot>(() => startupSample ? { table: startupSample[0], pending: false } : emptySlot());
  const [after, setAfter] = useState<Slot>(() => startupSample ? { table: startupSample[1], pending: false } : emptySlot());
  const [keyColumn, setKeyColumn] = useState(startupSample ? '设备编号' : '');
  const [options, setOptions] = useState<CompareOptions>(initialOptions);
  const [result, setResult] = useState<CompareResult | null>(() => startupSample ? compareTables(startupSample[0], startupSample[1], '设备编号', initialOptions) : null);
  const [message, setMessage] = useState(startupSample ? '示例清单已载入并比较。' : '请选择两份文件，或试用示例清单。');
  const [compareError, setCompareError] = useState('');
  const generation = useRef<Record<Side, number>>({ before: 0, after: 0 });
  const busy = before.pending || after.pending;
  const commonColumns = useMemo(() => before.table?.columns.filter((column) => after.table?.columns.includes(column)) ?? [], [before.table, after.table]);
  const chosenKey = commonColumns.includes(keyColumn) ? keyColumn : commonColumns[0] ?? '';

  const invalidate = () => { setResult(null); setCompareError(''); };
  const setSlot = (side: Side, slot: Slot | ((previous: Slot) => Slot)) => (side === 'before' ? setBefore : setAfter)(slot);
  const readFile = async (side: Side, file: File, sheetName?: string, sheets?: string[]) => {
    const id = ++generation.current[side];
    invalidate();
    setSlot(side, { file, sheets, selectedSheet: sheetName, pending: true });
    const extension = file.name.toLocaleLowerCase();
    if (!/\.(csv|xlsx)$/.test(extension)) {
      setSlot(side, { file, sheets, selectedSheet: sheetName, pending: false, error: '请选择 .csv 或 .xlsx 文件。' });
      setMessage('文件格式不支持，请重新选择。');
      return;
    }
    if (file.size > maxFileSize) {
      setSlot(side, { file, sheets, selectedSheet: sheetName, pending: false, error: '文件超过 8 MB，请缩小文件后重试。' });
      setMessage('文件过大，请重新选择。');
      return;
    }
    setMessage(`正在读取${side === 'before' ? '旧表' : '新表'}…`);
    try {
      const table = await parseInWorker(file, sheetName);
      if (generation.current[side] !== id) return;
      setSlot(side, { file, table, sheets: table.sheets ?? sheets, selectedSheet: table.sheetName ?? sheetName, pending: false });
      setMessage(`${side === 'before' ? '旧表' : '新表'}已读取，共 ${table.rows.length} 行。`);
    } catch (error) {
      if (generation.current[side] !== id) return;
      const reason = error instanceof Error ? error.message : '读取失败，请重新选择。';
      setSlot(side, { file, sheets, selectedSheet: sheetName, pending: false, error: reason });
      setMessage(`${side === 'before' ? '旧表' : '新表'}读取失败：${reason}`);
    }
  };
  const clearSide = (side: Side) => {
    ++generation.current[side];
    setSlot(side, emptySlot());
    invalidate();
    setMessage(`${side === 'before' ? '旧表' : '新表'}已移除。`);
  };
  const loadSample = () => {
    ++generation.current.before;
    ++generation.current.after;
    const [oldTable, newTable] = sampleTables();
    setBefore({ table: oldTable, pending: false });
    setAfter({ table: newTable, pending: false });
    setKeyColumn('设备编号');
    setOptions(initialOptions);
    invalidate();
    setMessage('示例清单已载入。请选择主键并开始比较。');
  };
  const clearAll = () => {
    ++generation.current.before;
    ++generation.current.after;
    setBefore(emptySlot()); setAfter(emptySlot()); setKeyColumn(''); setOptions(initialOptions); invalidate();
    setMessage('数据已清空。');
  };
  const runComparison = () => {
    if (!before.table || !after.table || !chosenKey || busy) return;
    setCompareError('');
    try {
      const next = compareTables(before.table, after.table, chosenKey, options);
      setResult(next);
      setMessage(next.issues.length ? `发现 ${next.issues.length} 项主键问题，请检查后重新比较。` : `比较完成，新增 ${next.summary.added} 行，删除 ${next.summary.removed} 行，修改 ${next.summary.modified} 行。`);
      window.setTimeout(() => document.getElementById(next.issues.length ? 'issues-title' : 'results-title')?.focus(), 0);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '比较失败，请检查数据后重试。';
      setCompareError(reason);
      setMessage(`比较失败：${reason}`);
    }
  };
  const setOption = (name: keyof CompareOptions, value: boolean) => { setOptions((previous) => ({ ...previous, [name]: value })); invalidate(); };

  return <div className="site-shell">
    <header className="site-header"><div className="header-inner"><a className="brand" href="/duibiao/" aria-label="对表首页"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>对表</span></a><nav aria-label="主导航"><a href="#guide">使用说明</a><a href="https://github.com/TolkmisLK/duibiao" target="_blank" rel="noreferrer">源码 <span aria-hidden="true">↗</span></a></nav></div></header>
    <main>
      <section className="hero" aria-labelledby="main-title"><div className="eyebrow"><span className="eyebrow-line" /> 清单差异比较工具</div><h1 id="main-title">把两份清单，<em>对清楚。</em></h1><p>上传旧表和新表，选定唯一编号。新增、删除、修改的每一行，都能找到来处。</p><div className="hero-actions"><button className="button button-primary" type="button" onClick={loadSample}>试用示例清单 <span aria-hidden="true">↗</span></button><a className="quiet-link" href="#workspace">上传自己的文件 <span aria-hidden="true">↓</span></a></div><div className="hero-note"><span className="local-dot" /> 文件在浏览器本地处理，不会上传到服务器</div></section>
      <section className="workspace" id="workspace" aria-labelledby="workspace-title"><div className="section-heading"><div><div className="section-kicker">开始对表</div><h2 id="workspace-title">先放入两份清单</h2><p className="section-intro">支持 CSV、XLSX。首行应为列名，建议两份表使用相同的编号列。</p></div><div className="workspace-actions"><button className="text-button" type="button" onClick={() => download(makeSampleCsv(sampleTables()[0]), '示例-旧表.csv', 'text/csv;charset=utf-8')}>下载旧表示例</button><button className="text-button" type="button" onClick={() => download(makeSampleCsv(sampleTables()[1]), '示例-新表.csv', 'text/csv;charset=utf-8')}>下载新表示例</button><button className="text-button" type="button" onClick={clearAll} disabled={!before.table && !after.table && !before.error && !after.error && !busy}>清空数据</button></div></div>
        <div className="upload-grid"><UploadPanel side="before" slot={before} onFile={readFile} onSheet={(side, sheet) => { if (before.file) void readFile(side, before.file, sheet, before.sheets); }} onClear={clearSide} disabled={busy} /><UploadPanel side="after" slot={after} onFile={readFile} onSheet={(side, sheet) => { if (after.file) void readFile(side, after.file, sheet, after.sheets); }} onClear={clearSide} disabled={busy} /></div>
        <section className="settings" aria-labelledby="settings-title"><div className="settings-heading"><span className="step-number">03</span><div><h3 id="settings-title">设置比较方式</h3><p>主键用于对应旧表和新表中的同一行。</p></div></div>
          <div className="settings-body"><div className="key-field"><label htmlFor="key-column">唯一编号列 <span className="required">必选</span></label><select id="key-column" value={chosenKey} onChange={(event) => { setKeyColumn(event.target.value); invalidate(); }} disabled={busy || !commonColumns.length}><option value="">{before.table && after.table ? '没有共同列' : '先上传两份清单'}</option>{commonColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select><p>请选择每行都有值且不重复的列，例如订单号或设备编号。</p>{before.table && after.table && !commonColumns.length && <p className="field-error">两份表没有同名列，无法选定主键。请检查表头。</p>}</div>
            <fieldset className="option-field"><legend>匹配规则 <span className="rule-default">默认精确比较</span></legend><label className="check-row"><input type="checkbox" checked={options.trimWhitespace} onChange={(event) => setOption('trimWhitespace', event.target.checked)} disabled={busy} /><span><strong>忽略首尾空白</strong><small>编号匹配和字段值比较都忽略两端空格。</small></span></label><label className="check-row"><input type="checkbox" checked={options.ignoreCase} onChange={(event) => setOption('ignoreCase', event.target.checked)} disabled={busy} /><span><strong>忽略大小写</strong><small>编号匹配和字段值比较都不区分英文字母大小写。</small></span></label></fieldset></div>
          <div className="compare-bar"><p>确认编号列后，开始比较全部数据。</p><button className="button button-primary compare-button" type="button" onClick={runComparison} disabled={busy || !before.table || !after.table || !chosenKey}>开始比较 <span aria-hidden="true">→</span></button></div>
          {compareError && <p className="field-error compare-error" role="alert">{compareError}</p>}
        </section>
      </section>
      {result && <Results key={result.keyColumn + JSON.stringify(result.options) + before.table?.name + after.table?.name} result={result} />}
      <section className="guide" id="guide" aria-labelledby="guide-title"><div><div className="section-kicker">使用说明</div><h2 id="guide-title">比较之前，了解这些</h2><p>一个清楚的差异报告，始于一列可靠的唯一编号。</p></div><div className="guide-list"><details><summary>我的文件会上传吗？</summary><p>不会。文件只在当前浏览器中读取和比较，原文件不会被修改。点击“清空数据”可移除当前页面中的数据；关闭页面也会结束本次使用。</p></details><details><summary>哪些变化会被比较？</summary><p>按所选主键匹配行，比较字段的文本值，并标记新增、删除、修改和不变。行顺序变化不算修改。单元格样式不比较，公式不会重新计算；表格会按文件中可读取的单元格值进行比较。</p></details><details><summary>导出的报告包含什么？</summary><p>比较完成后可导出 CSV 差异报告或 JSON 结果。CSV 适合在表格软件中查看，JSON 包含状态、字段变化和统计。发现空主键或重复主键时会暂停报告，避免误判。</p></details></div></section>
    </main><footer className="site-footer"><span className="footer-brand"><span className="brand-mark small" aria-hidden="true"><i /><i /></span>对表</span><span>把差异看明白。</span><a href="https://tolkmislk.github.io" target="_blank" rel="noreferrer">更多作品 ↗</a></footer>
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{message}</div>
  </div>;
}
