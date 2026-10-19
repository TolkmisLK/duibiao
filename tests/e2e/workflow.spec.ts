import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

async function upload(page: Page, side: 'before' | 'after', text: string) {
  await page.locator(`#${side}-file`).setInputFiles({ name: `${side}.csv`, mimeType: 'text/csv', buffer: Buffer.from(text) });
  await expect(page.locator(`#${side}-file`)).toBeEnabled();
}

test('示例可筛选、查看字段前后值并导出完整报告', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?example=1');
  for (const [status, count] of Object.entries({ added: 1, removed: 1, modified: 3, unchanged: 2 })) {
    await expect(page.locator(`.summary-item.status-${status} strong`)).toHaveText(String(count));
  }
  await page.getByRole('button', { name: /^修改\s*3$/ }).click();
  await expect(page.locator('.result-row')).toHaveCount(3);
  await page.getByRole('searchbox', { name: '搜索比较结果' }).fill('002');
  await expect(page.locator('.result-row')).toHaveCount(1);
  await page.locator('.result-row summary').click();
  await expect(page.locator('.detail-table')).toContainText('会议室 A');
  await expect(page.locator('.detail-table')).toContainText('会议室 B');
  const jsonEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const json = await jsonEvent;
  const result = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(result.summary).toEqual({ added: 1, removed: 1, modified: 3, unchanged: 2 });
  expect(result.rows).toHaveLength(7);
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  expect(await readFile((await (await csvEvent).path())!, 'utf8')).toContain('修改前存在');
  expect(errors).toEqual([]);
});

test('真实 CSV 通过 Worker 读取，选项变化使旧报告失效，数据不会发出网络请求', async ({ page }) => {
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType()) || request.method() !== 'GET') requests.push(request.url());
  });
  await upload(page, 'before', '编号,值\n001,Alpha\n002,保持');
  await upload(page, 'after', '编号,值\n002,保持\n001, alpha ');
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-modified strong')).toHaveText('1');
  await page.getByRole('checkbox', { name: '忽略首尾空白' }).check();
  await expect(page.getByRole('button', { name: '导出 CSV' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '忽略大小写' }).check();
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-unchanged strong')).toHaveText('2');
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: '清空数据' }).click();
  await expect(page.getByRole('button', { name: '开始比较' })).toBeDisabled();
  await expect(page.locator('.result-row')).toHaveCount(0);
});

test('重复或空主键阻止报告，替换文件后可恢复', async ({ page }) => {
  await page.goto('./');
  await upload(page, 'before', '编号,值\n001,甲\n001,乙\n,丙');
  await upload(page, 'after', '编号,值\n001,甲');
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.issue-list')).toContainText('第 2、3 行');
  await expect(page.locator('.issue-list')).toContainText('空主键');
  await expect(page.getByRole('button', { name: '导出 CSV' })).toHaveCount(0);
  await upload(page, 'before', '编号,值\n001,甲');
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-unchanged strong')).toHaveText('1');
});

test('XLSX 可切换工作表并保留数字显示格式', async ({ page }) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['不相关'], ['内容']]), '说明');
  const sheet = XLSX.utils.aoa_to_sheet([['编号', '值'], [7, '更新']]);
  sheet.A2.z = '0000';
  XLSX.utils.book_append_sheet(book, sheet, '清单');
  await page.goto('./');
  await upload(page, 'before', '编号,值\n0007,旧值');
  await page.locator('#after-file').setInputFiles({ name: 'list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await expect(page.getByRole('combobox', { name: '工作表', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '工作表', exact: true }).selectOption('清单');
  await expect(page.getByRole('button', { name: '开始比较' })).toBeEnabled();
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-modified strong')).toHaveText('1');
  await expect(page.locator('.result-row summary')).toContainText('0007');
});

test('坏文件给出可恢复错误且不保留过期结果', async ({ page }) => {
  await page.goto('./?example=1');
  await upload(page, 'before', '编号,值\n001,"未闭合');
  await expect(page.getByRole('alert')).toContainText('CSV 格式错误');
  await expect(page.getByRole('button', { name: '导出 JSON' })).toHaveCount(0);
  await page.getByRole('button', { name: '试用示例清单' }).click();
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-added strong')).toHaveText('1');
});

test('空首页可跳过，显式选择坏工作表后可以恢复', async ({ page }) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '空白');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['编号', '值'], ['001', '更新']]), '清单');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['编号', '编号'], ['001', '002']]), '重复列');
  await page.goto('./');
  await upload(page, 'before', '编号,值\n001,旧值');
  await page.locator('#after-file').setInputFiles({ name: 'recover.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  const selector = page.getByRole('combobox', { name: '工作表', exact: true });
  await expect(selector).toHaveValue('清单');
  await expect(page.locator('.parse-warning')).toContainText('空白');
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-modified strong')).toHaveText('1');
  await selector.selectOption('重复列');
  await expect(page.getByRole('alert')).toContainText('重复列名');
  await expect(page.getByRole('button', { name: '开始比较' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导出 JSON' })).toHaveCount(0);
  await selector.selectOption('清单');
  await expect(page.getByRole('button', { name: '开始比较' })).toBeEnabled();
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.status-modified strong')).toHaveText('1');
});

test('大量结果分页并将单元格 HTML 作为普通文本显示', async ({ page }) => {
  await page.goto('./');
  const rows = Array.from({ length: 130 }, (_, index) => `${index},<img src=x onerror=alert(1)>`).join('\n');
  await upload(page, 'before', '编号,值');
  await upload(page, 'after', `编号,值\n${rows}`);
  await page.getByRole('button', { name: '开始比较' }).click();
  await expect(page.locator('.result-row')).toHaveCount(50);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.pagination')).toContainText('51–100 / 130');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.result-row')).toHaveCount(30);
  await expect(page.locator('.detail-table img')).toHaveCount(0);
  await page.locator('.result-row summary').first().click();
  await expect(page.locator('.result-row').first()).toContainText('<img src=x onerror=alert(1)>');
});

test('窄屏保持页面宽度并可操作结果', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?example=1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^新增\s*1$/ }).click();
  await expect(page.locator('.result-row')).toHaveCount(1);
  await page.locator('.result-row summary').click();
  await expect(page.locator('.detail-table')).toBeVisible();
});
