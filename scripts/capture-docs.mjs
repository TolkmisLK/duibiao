import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(process.env.SCREENSHOT_URL || 'http://127.0.0.1:14280/duibiao/?example=1');
  await page.getByRole('heading', { name: '变化，一目了然。' }).waitFor();
  await mkdir('docs/images', { recursive: true });
  await page.locator('.workspace').screenshot({ path: 'docs/images/workspace.png' });
  await page.locator('.result-row').filter({ hasText: '002' }).locator('summary').click();
  await page.locator('.results-section').screenshot({ path: 'docs/images/results.png' });
  console.log('已保存真实页面截图：workspace.png、results.png');
} finally {
  await browser.close();
}
