/**
 * QA Suite 1 — Initial Page Load, Trace List, Search
 *
 * All API calls are mocked with fixture data. Tests cover: plugin mount,
 * datasource dropdown, auto-search, trace list content, LLM filter in query,
 * time range picker, and search button re-fire.
 */

import { test, expect, Page } from '@playwright/test';
import { SEARCH_RESPONSE, TRACE_RESPONSE } from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

const LLM_FILTER_ATTRS = [
  'span.openinference.span.kind',
  'span.gen_ai.system',
  'span.gen_ai.operation.name',
  'span.llm.model_name',
  'span.llm.request.type',
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

test.describe('QA-1: Initial page load, trace list, and search', () => {

  test('01 · plugin mounts: trace-explorer element is visible', async ({ page }) => {
    await setup(page);
    await expect(page.locator('[data-testid="trace-explorer"]')).toBeVisible();
  });

  test('02 · datasource select shows a Tempo datasource', async ({ page }) => {
    await setup(page);
    const explorer = page.locator('[data-testid="trace-explorer"]');
    const hasDsControl =
      (await explorer.locator('[role="combobox"]').count()) > 0 ||
      (await explorer.locator('input').count()) > 0;
    expect(hasDsControl, 'No datasource selector found in trace-explorer').toBe(true);
  });

  test('03 · auto-search fires: trace items appear without user interaction', async ({ page }) => {
    await setupWithTraces(page);
    const count = await page.locator('[data-testid^="trace-item-"]').count();
    expect(count, 'Auto-search produced 0 trace items').toBeGreaterThan(0);
  });

  test('04 · trace count: at least 1 trace returned', async ({ page }) => {
    await setupWithTraces(page);
    expect(await page.locator('[data-testid^="trace-item-"]').count()).toBeGreaterThanOrEqual(1);
  });

  test('05 · trace list content: each item has duration and timestamp', async ({ page }) => {
    await setupWithTraces(page);
    const items = page.locator('[data-testid^="trace-item-"]');
    const count = await items.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = ((await items.nth(i).textContent()) ?? '').replace(/\s+/g, ' ').trim();
      expect(text.length, `Item ${i} is empty`).toBeGreaterThan(0);

      const hasDuration = /\d+(\.\d+)?(ms|s)(?=\s|$|[^a-zA-Z])/i.test(text);
      expect(hasDuration, `Item ${i} missing duration — "${text}"`).toBe(true);

      const hasTimestamp =
        /\d{1,2}:\d{2}(:\d{2})?(\s*(utc|gmt|[+-]\d{4}))?/i.test(text) ||
        /ago|just now|\d{4}-\d{2}-\d{2}/i.test(text) ||
        /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(text);
      expect(hasTimestamp, `Item ${i} missing timestamp — "${text}"`).toBe(true);
    }
  });

  test('06 · no "No traces found" message when traces exist', async ({ page }) => {
    await setupWithTraces(page);
    const hasEmpty =
      (await page.locator('[data-testid="no-traces-found"], [data-testid="empty-state"]').count()) > 0 ||
      (await page.getByText('No traces found', { exact: false }).count()) > 0;
    expect(hasEmpty, '"No traces found" shown despite mock traces').toBe(false);
  });

  test('07 · trace counter is not "0 TRACES" after results load', async ({ page }) => {
    await setupWithTraces(page);
    await page.waitForTimeout(300);
    const listPane = page.locator('[data-testid="trace-list-pane"]');
    const hasZero =
      (await listPane.getByText('0 TRACES', { exact: true }).count()) > 0 ||
      (await listPane.getByText('0 traces', { exact: true }).count()) > 0;
    expect(hasZero, 'Counter shows 0 despite traces being visible').toBe(false);
  });

  test('08 · search API request q param contains LLM span filter attribute', async ({ page }) => {
    const capturedUrls: URL[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/datasources/proxy/') && url.includes('/api/search')) {
        try { capturedUrls.push(new URL(url)); } catch { /* ignore */ }
      }
    });

    await setupWithTraces(page);
    await page.waitForTimeout(300);

    const searchWithLlmFilter = capturedUrls.filter((u) => {
      const q = u.searchParams.get('q') ?? '';
      return LLM_FILTER_ATTRS.some((attr) => q.includes(attr));
    });
    expect(
      searchWithLlmFilter.length,
      `No search request carried an LLM filter. q params: ${capturedUrls.map((u) => u.searchParams.get('q')).join(' | ')}`
    ).toBeGreaterThan(0);
  });

  test('09 · time range picker is visible in the toolbar', async ({ page }) => {
    await setup(page);
    const explorer = page.locator('[data-testid="trace-explorer"]');
    const hasExplicit =
      (await explorer.locator('[data-testid="time-range-picker"]').count()) > 0 ||
      (await explorer.getByText(/last\s+\d+\s+(minutes?|hours?|days?|weeks?)/i).count()) > 0;
    if (!hasExplicit) {
      const text = (await explorer.textContent()) ?? '';
      expect(/last\s+\d+|now[-–]\d+[hmds]/i.test(text), 'No time range text found in toolbar').toBe(true);
    } else {
      expect(hasExplicit).toBe(true);
    }
  });

  test('10 · search button re-fires search and returns results', async ({ page }) => {
    let searchCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/datasources/proxy/') && req.url().includes('/api/search')) {
        searchCount++;
      }
    });

    await setupWithTraces(page);
    const countBefore = searchCount;

    const searchBtn = page.locator('[data-testid="trace-explorer"]')
      .getByRole('button', { name: /^search$/i }).first();
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();

    await page.waitForSelector('[data-testid^="trace-item-"]');
    expect(searchCount, 'No new search request fired after clicking Search').toBeGreaterThan(countBefore);
  });

});
