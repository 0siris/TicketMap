import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// This script only reads the running local application. It blocks browser write requests.
const base = 'http://127.0.0.1:4310';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', route => {
  if (!['GET', 'HEAD'].includes(route.request().method())) {
    writes.push(route.request().method());
    return route.abort();
  }
  return route.continue();
});
try {
  await mkdir('output/playwright', { recursive: true });
  const response = await page.request.get(`${base}/api/workspace?refresh=1`);
  if (!response.ok()) throw new Error(`Workspace API returned ${response.status()}`);
  const workspace = await response.json();
  if (!workspace.issues.length || !workspace.statuses.length) throw new Error('Empty GitLab snapshot');
  await page.goto(base);
  await page.getByRole('list', { name: 'Tickets', exact: true }).getByRole('button').first().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=graph]')?._cyreg?.cy?.nodes().length > 0);
  await page.screenshot({ path: 'output/playwright/live-network.png', fullPage: true });
  const parent = workspace.relations.find(edge => edge.kind === 'parent');
  const parentIssue = workspace.issues.find(issue => issue.id === parent?.source) ?? workspace.issues[0];
  await page.goto(`${base}/?view=hierarchy&issue=${parentIssue.iid}`);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/live-hierarchy.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/live-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('Mobile horizontal overflow');
  if (errors.length || writes.length) throw new Error(JSON.stringify({ errors, writes }));
  console.log(JSON.stringify({ issues: workspace.issues.length, relations: workspace.relations.length,
    statuses: workspace.statuses.length, browserErrors: errors.length, writes: writes.length,
    screenshots: 'output/playwright/live-{network,hierarchy,mobile}.png' }, null, 2));
} finally { await browser.close(); }
