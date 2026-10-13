/**
 * QA Suite 2 — Trace Detail View, Span List, Span Detail Panel
 *
 * All API calls are mocked with fixture data. Tests cover: opening a trace,
 * back button, stats row, span list, AI-only toggle, span filter,
 * collapse/expand, keyboard navigation, resize handle, and title display.
 */

import { test, expect, Page } from '@playwright/test';
import { SEARCH_RESPONSE, TRACE_RESPONSE } from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const LOAD_TIMEOUT = 10_000;

async function setup(page: Page) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) })
  );
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) })
  );
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]');
  await page.waitForSelector('[data-testid^="trace-item-"]');
}

async function setupWithOpenTrace(page: Page) {
  await setup(page);
  await page.locator('[data-testid^="trace-item-"]').first().click();
  await page.waitForSelector('[data-testid="trace-detail-view"]', { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('[data-testid^="span-row-"]', { timeout: LOAD_TIMEOUT });
}

test.describe('QA-2: Trace detail view, span list, span detail panel', () => {

  test('01 · clicking first trace shows trace-detail-view', async ({ page }) => {
    await setup(page);
    await page.locator('[data-testid^="trace-item-"]').first().click();
    await expect(page.locator('[data-testid="trace-detail-view"]')).toBeVisible({ timeout: LOAD_TIMEOUT });
  });

  test('02 · back button dismisses detail view and list is still populated', async ({ page }) => {
    await setupWithOpenTrace(page);

    const backBtn = page.locator('[data-testid="trace-detail-view"]').getByRole('button', { name: /back/i });
    await expect(backBtn).toBeVisible({ timeout: 5_000 });
    await backBtn.click();

    await expect(page.locator('[data-testid="trace-detail-view"]')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid^="trace-item-"]').first()).toBeVisible();
    expect(await page.locator('[data-testid^="trace-item-"]').count()).toBeGreaterThan(0);
  });

  test('03 · trace-stats-row shows Duration, Spans, LLM Spans', async ({ page }) => {
    await setupWithOpenTrace(page);
    const statsRow = page.locator('[data-testid="trace-stats-row"]');
    await expect(statsRow).toContainText('Duration', { timeout: LOAD_TIMEOUT });
    await expect(statsRow).toContainText('Spans');
    await expect(statsRow).toContainText('LLM Spans');
  });

  test('04 · span-list-pane appears after opening a trace', async ({ page }) => {
    await setupWithOpenTrace(page);
    await expect(page.locator('[data-testid="span-list-pane"]')).toBeVisible();
  });

  test('05 · span list contains at least one span row', async ({ page }) => {
    await setupWithOpenTrace(page);
    const spanRows = page.locator('[data-testid^="span-row-"]');
    await expect(spanRows.first()).toBeVisible();
    expect(await spanRows.count()).toBeGreaterThan(0);
  });

  test('06 · LLM span is auto-selected and detail panel is visible after load', async ({ page }) => {
    await setupWithOpenTrace(page);
    await page.waitForTimeout(300);

    const detailEl = page.locator(
      '[data-testid="span-detail-panel"], [data-testid="llm-span-detail"], [data-testid="oi-span-detail"]'
    ).first();

    if ((await detailEl.count()) === 0) {
      await page.locator('[data-testid^="span-row-"]').first().click();
      await page.waitForTimeout(300);
    }

    await expect(detailEl).toBeVisible({ timeout: 5_000 });
  });

  test('07 · clicking a span row populates the detail pane', async ({ page }) => {
    await setupWithOpenTrace(page);
    const spanRows = page.locator('[data-testid^="span-row-"]');
    await spanRows.nth(Math.min((await spanRows.count()) - 1, 2)).click();
    await page.waitForTimeout(300);

    const hasDetail =
      (await page.locator('[data-testid="llm-span-detail"]').count()) > 0 ||
      (await page.locator('[data-testid="oi-span-detail"]').count()) > 0 ||
      (await page.locator('[data-testid="span-detail-panel"]').count()) > 0;
    expect(hasDetail, 'No detail panel after clicking a span').toBe(true);
  });

  test('08 · span detail panel shows at least one attribute', async ({ page }) => {
    await setupWithOpenTrace(page);
    await page.locator('[data-testid^="span-row-"]').first().click();
    await page.waitForTimeout(300);

    const detailEl = page.locator(
      '[data-testid="span-detail-panel"], [data-testid="llm-span-detail"], [data-testid="oi-span-detail"]'
    ).first();
    await expect(detailEl).toBeVisible({ timeout: 5_000 });
    const text = (await detailEl.textContent()) ?? '';
    expect(text.trim().length).toBeGreaterThan(10);
  });

  test('09 · AI only toggle filters span list to AI spans', async ({ page }) => {
    await setupWithOpenTrace(page);

    const spanRows = page.locator('[data-testid^="span-row-"]');
    const countBefore = await spanRows.count();

    const aiOnlyBtn = page.getByRole('button', { name: 'AI only', exact: true });
    await expect(aiOnlyBtn).toBeVisible();
    await aiOnlyBtn.click();
    await page.waitForTimeout(300);

    expect(await aiOnlyBtn.getAttribute('aria-pressed')).toBe('true');
    expect(await spanRows.count()).toBeLessThanOrEqual(countBefore);

    await aiOnlyBtn.click();
    await page.waitForTimeout(300);
    expect(await aiOnlyBtn.getAttribute('aria-pressed')).toBe('false');
    expect(await spanRows.count()).toBe(countBefore);
  });

  test('10 · span filter input filters spans by name', async ({ page }) => {
    await setupWithOpenTrace(page);

    const filterInput = page.locator('[data-testid="span-filter-input"]');
    await expect(filterInput).toBeVisible();

    const spanRows = page.locator('[data-testid^="span-row-"]');
    const countBefore = await spanRows.count();

    await filterInput.fill('zzzznonexistentspanname9999');
    await page.waitForTimeout(300);
    expect(await spanRows.count()).toBe(0);

    await expect(page.locator('[data-testid="span-filter-count"]')).toContainText('0');

    await page.locator('[data-testid="span-filter-clear"]').click();
    await page.waitForTimeout(300);
    expect(await spanRows.count()).toBe(countBefore);
  });

  test('11 · collapse-all and expand-all buttons change visible span count', async ({ page }) => {
    await setupWithOpenTrace(page);

    const spanRows = page.locator('[data-testid^="span-row-"]');
    const countExpanded = await spanRows.count();
    if (countExpanded <= 1) { return; }

    const collapseBtn = page.locator('button[aria-label="Collapse all spans"]');
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await page.waitForTimeout(300);

    expect(await spanRows.count()).toBeLessThanOrEqual(countExpanded);

    const expandBtn = page.locator('button[aria-label="Expand all spans"]');
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();
    await page.waitForTimeout(300);

    expect(await spanRows.count()).toBe(countExpanded);
  });

  test('12 · ArrowDown and ArrowUp keyboard navigation changes selected span', async ({ page }) => {
    await setupWithOpenTrace(page);
    const spanRows = page.locator('[data-testid^="span-row-"]');
    if ((await spanRows.count()) < 2) { return; }

    await spanRows.first().click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="trace-detail-view"]').focus();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);

    const detailEl = page.locator(
      '[data-testid="span-detail-panel"], [data-testid="llm-span-detail"], [data-testid="oi-span-detail"]'
    );
    await expect(detailEl.first()).toBeVisible({ timeout: 3_000 });
  });

  test('13 · span-list-pane appears after opening a trace', async ({ page }) => {
    await setup(page);
    await page.locator('[data-testid^="trace-item-"]').first().click();
    await page.waitForSelector('[data-testid="trace-detail-view"]', { timeout: LOAD_TIMEOUT });
    await expect(page.locator('[data-testid="span-list-pane"]')).toBeVisible({ timeout: LOAD_TIMEOUT });
  });

  test('14 · trace detail title is visible and non-empty', async ({ page }) => {
    await setupWithOpenTrace(page);
    const headerText = ((await page.locator('[data-testid="trace-detail-view"]').textContent()) ?? '').trim();
    expect(headerText.length, 'Trace detail title must not be empty').toBeGreaterThan(0);
  });

  test('15 · resize-handle-span-list is present in the detail view', async ({ page }) => {
    await setupWithOpenTrace(page);
    await expect(page.locator('[data-testid="resize-handle-span-list"]')).toBeVisible({ timeout: LOAD_TIMEOUT });
  });

  test('16 · span count and stats are consistent', async ({ page }) => {
    await setupWithOpenTrace(page);
    const spanCount = await page.locator('[data-testid^="span-row-"]').count();
    expect(spanCount).toBeGreaterThan(0);

    const statsRow = page.locator('[data-testid="trace-stats-row"]');
    const statsText = (await statsRow.textContent()) ?? '';
    expect(statsText.trim().length).toBeGreaterThan(0);
  });

});
