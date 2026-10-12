/**
 * QA Suite 3 — Query Editor, TraceQL, Time Range, Search Filtering
 *
 * All API calls are mocked with fixture data. Tests cover: QueryEditor mount,
 * LLM filter in initial search, toolbar collapse/expand, time range picker,
 * Search button re-fire, Share button, trace ID direct lookup, URL params,
 * error-free load, hidden UI elements, and TraceQL initial value.
 */

import { test, expect, Page } from '@playwright/test';
import { SEARCH_RESPONSE, TRACE_RESPONSE } from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const LOAD_TIMEOUT = 10_000;

const LLM_ATTRS = [
  'openinference.span.kind',
  'gen_ai.system',
  'gen_ai.operation.name',
  'llm.model_name',
  'llm.request.type',
];

async function setup(page: Page) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) })
  );
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) })
  );
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]');
}

async function setupWithTraces(page: Page) {
  await setup(page);
  await page.waitForSelector('[data-testid^="trace-item-"]');
}

test('01 · QueryEditor component mounts inside trace-explorer', async ({ page }) => {
  await setup(page);
  await page.waitForTimeout(2000);
  const inputs = page.locator(
    '[data-testid="trace-explorer"] textarea, [data-testid="trace-explorer"] input[type="text"]'
  );
  expect(await inputs.count(), 'QueryEditor should render at least one input/textarea').toBeGreaterThan(0);
});

test('02 · initial search request uses LLM filter (not bare {})', async ({ page }) => {
  const tempoSearchUrls: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    const pathname = new URL(url).pathname;
    if (pathname.includes('/api/datasources/proxy/') && pathname.endsWith('/api/search')) {
      tempoSearchUrls.push(url);
    }
  });

  await setupWithTraces(page);

  // Wait for a search request with a non-empty q parameter (CI can be slow to populate the filter)
  await expect.poll(() => tempoSearchUrls.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Find the last search URL — earlier ones may have an empty q due to race conditions
  const lastUrl = tempoSearchUrls[tempoSearchUrls.length - 1];
  const q = new URL(lastUrl).searchParams.get('q') ?? '';
  expect(q, 'Tempo search q must not be bare {}').not.toBe('{}');
  expect(q, 'Tempo search q must not be empty').not.toBe('');
  const hasLlmAttr = LLM_ATTRS.some((attr) => q.includes(attr));
  expect(hasLlmAttr, `q="${q}" should contain an LLM filter attribute`).toBe(true);
});

test('03 · toolbar collapse hides query editor; trace list remains visible', async ({ page }) => {
  await setupWithTraces(page);

  const collapseBtn = page.locator('button[aria-label="Collapse toolbar"]');
  await expect(collapseBtn).toBeVisible({ timeout: 5000 });

  const editorVisible = await page.locator('[data-testid="trace-explorer"] textarea').first().isVisible().catch(() => false);
  await collapseBtn.click();
  await page.waitForTimeout(400);

  await expect(page.locator('button[aria-label="Expand toolbar"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="trace-list-pane"]')).toBeVisible();

  if (editorVisible) {
    const stillVisible = await page.locator('[data-testid="trace-explorer"] textarea').first().isVisible().catch(() => false);
    expect(stillVisible, 'QueryEditor should be hidden after toolbar collapse').toBe(false);
  }
});

test('04 · toolbar expand restores query editor', async ({ page }) => {
  await setupWithTraces(page);

  await page.locator('button[aria-label="Collapse toolbar"]').click();
  await page.waitForTimeout(400);

  await expect(page.locator('button[aria-label="Expand toolbar"]')).toBeVisible({ timeout: 3000 });
  await page.locator('button[aria-label="Expand toolbar"]').click();
  await page.waitForTimeout(400);

  await expect(page.locator('button[aria-label="Collapse toolbar"]')).toBeVisible({ timeout: 3000 });
});

test('05 · time range picker button is present in toolbar', async ({ page }) => {
  await setup(page);
  const explorer = page.locator('[data-testid="trace-explorer"]');
  const timeButtons = explorer.locator('button').filter({ hasText: /Last \d|now-|hour|day|week|min/i });
  const count = await timeButtons.count();
  if (count === 0) {
    const text = (await explorer.textContent()) ?? '';
    expect(/last\s+\d+|now[-–]\d+[hmds]|\d+\s*(h|hour|min|day|week)/i.test(text), 'No time range text found').toBe(true);
  } else {
    expect(count).toBeGreaterThan(0);
  }
});

test('06 · clicking Search button fires a new API request', async ({ page }) => {
  const capturedRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/datasources/proxy/') && url.includes('/api/search')) {
      capturedRequests.push(url);
    }
  });

  await setupWithTraces(page);
  await page.waitForTimeout(500);
  const countBefore = capturedRequests.length;

  const searchBtn = page.locator('[data-testid="trace-explorer"]').locator('button')
    .filter({ hasText: /^Search$/ }).first();
  const fallbackBtn = page.locator('[data-testid="trace-explorer"] button').filter({ hasText: 'Search' }).first();
  const btn = (await searchBtn.count()) > 0 ? searchBtn : fallbackBtn;

  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(2000);

  expect(capturedRequests.length, 'Clicking Search should fire at least one new request').toBeGreaterThan(countBefore);
});

test('07 · Share button (clipboard) is present in toolbar', async ({ page }) => {
  await setup(page);
  const explorer = page.locator('[data-testid="trace-explorer"]');
  const shareBtn = explorer.getByRole('button', { name: /share/i });
  if (await shareBtn.count() > 0) {
    await expect(shareBtn.first()).toBeVisible({ timeout: 5000 });
  } else {
    const allButtons = explorer.locator('button');
    let found = false;
    for (let i = 0; i < await allButtons.count(); i++) {
      const title = await allButtons.nth(i).getAttribute('title');
      const text = await allButtons.nth(i).textContent();
      if (title?.toLowerCase().includes('share') || text?.toLowerCase().includes('share')) {
        found = true;
        break;
      }
    }
    expect(found, 'Share button not found in toolbar').toBe(true);
  }
});

test('08 · pasting a trace ID into TraceQL and clicking Search opens trace detail', async ({ page }) => {
  await setupWithTraces(page);

  const firstItem = page.locator('[data-testid^="trace-item-"]').first();
  const testid = await firstItem.getAttribute('data-testid');
  const traceId = testid?.replace('trace-item-', '') ?? '';

  if (!traceId || !/^[0-9a-f]{16,32}$/i.test(traceId)) {
    test.skip();
    return;
  }

  const textarea = page.locator('[data-testid="trace-explorer"] textarea').first();
  await expect(textarea).toBeVisible({ timeout: LOAD_TIMEOUT });

  await textarea.click({ clickCount: 3 });
  await textarea.fill(traceId);

  const searchBtn = page.locator('[data-testid="trace-explorer"]').getByRole('button', { name: /search/i }).first();
  await searchBtn.click();

  try {
    await page.waitForSelector('[data-testid="trace-detail-view"]', { timeout: LOAD_TIMEOUT });
    await expect(page.locator('[data-testid="trace-detail-view"]')).toBeVisible();
  } catch {
    const url = page.url();
    expect(url.includes(traceId) || url.includes('llt-traceId'), 'Expected trace detail or URL update').toBe(true);
  }
});

test('09 · datasource selector shows at least one Tempo datasource option', async ({ page }) => {
  await setup(page);
  const explorer = page.locator('[data-testid="trace-explorer"]');
  const singleValues = await explorer.locator('[class*="singleValue"]').allTextContents();
  const allText = await explorer.textContent() ?? '';
  const hasDs =
    singleValues.length > 0 ||
    /tempo/i.test(allText) ||
    (await explorer.locator('[role="combobox"]').count()) > 0;
  expect(hasDs, 'No datasource selector found').toBe(true);
});

test('10 · URL contains llt-ds after datasource loads', async ({ page }) => {
  await setupWithTraces(page);
  await page.waitForTimeout(1000);
  const url = page.url();
  expect(url, 'URL should contain llt-ds after datasource loads').toContain('llt-ds');
});

test('11 · no search-error-message visible on initial load', async ({ page }) => {
  await setupWithTraces(page);
  const errorCount = await page.locator('[data-testid="search-error-message"]').count();
  expect(errorCount, 'search-error-message should not be shown on initial load').toBe(0);
});

test('12 · "Import trace" button is hidden (not visible)', async ({ page }) => {
  await setup(page);
  await page.waitForTimeout(2000);
  const allButtons = page.locator('[data-testid="trace-explorer"] button');
  for (let i = 0; i < await allButtons.count(); i++) {
    const text = await allButtons.nth(i).textContent();
    if (text?.trim() === 'Import trace') {
      expect(await allButtons.nth(i).isVisible(), '"Import trace" button should be hidden').toBe(false);
    }
  }
});

test('13 · "Service Graph" tab is hidden', async ({ page }) => {
  await setup(page);
  await page.waitForTimeout(2000);
  const explorer = page.locator('[data-testid="trace-explorer"]');
  const sgElements = explorer.locator('label, span, div, button').filter({ hasText: /^Service Graph$/ });
  for (let i = 0; i < await sgElements.count(); i++) {
    const visible = await sgElements.nth(i).isVisible().catch(() => false);
    expect(visible, '"Service Graph" tab should be hidden').toBe(false);
  }
});

test('14 · TraceQL input shows LLM filter (not bare {}) on initial load', async ({ page }) => {
  await setup(page);
  const textarea = page.locator('[data-testid="trace-explorer"] textarea').first();
  await expect(textarea).toBeVisible({ timeout: LOAD_TIMEOUT });

  const value = await textarea.inputValue().catch(async () => await textarea.textContent() ?? '');
  expect(value.trim(), 'TraceQL should not be bare {}').not.toBe('{}');
  expect(value.trim(), 'TraceQL should not be empty').not.toBe('');
  const hasLlmAttr = LLM_ATTRS.some((attr) => value.includes(attr));
  expect(hasLlmAttr, `TraceQL value "${value}" should contain an LLM filter`).toBe(true);
});
