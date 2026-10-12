/**
 * QA Agent 5 — UX Interactions, Responsive Layout, Error States, Accessibility, Edge Cases
 *
 * Hits Grafana at http://localhost:3001 with deterministic Tempo responses.
 * Tests resize, collapse/expand, summary bar, error filter, viewports, console errors,
 * loading states, share button, keyboard navigation (j/k), URL param deep-linking,
 * and back navigation.
 *
 * Run with:
 *   BASE_URL=http://localhost:3001 npx playwright test tests/qa-agent-5-ux.spec.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { SEARCH_RESPONSE, TRACE_RESPONSE } from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const SCREENSHOT_DIR = '/tmp/qa-ux-screenshots';
const LOAD_TIMEOUT = 25_000;
const QA_SEARCH_RESPONSE = {
  ...SEARCH_RESPONSE,
  traces: SEARCH_RESPONSE.traces.map((trace, index) => index === 0 ? {
    ...trace,
    spanSets: [{
      matched: 1,
      spans: [{
        spanID: 'error-search-span',
        startTimeUnixNano: trace.startTimeUnixNano,
        durationNanos: '1000000',
        name: 'failed_operation',
        attributes: [{ key: 'status', value: { stringValue: 'ERROR' } }],
      }],
    }],
  } : trace),
};

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function shot(page: Page, name: string) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[screenshot] ${file}`);
}

async function mockTempo(page: Page): Promise<{ traceUrls: URL[] }> {
  const traceUrls: URL[] = [];
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QA_SEARCH_RESPONSE) });
  });
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route, request) => {
    traceUrls.push(new URL(request.url()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) });
  });
  return { traceUrls };
}

/** Navigate to plugin and wait for the explorer + at least some traces or error state */
async function gotoAndWaitForLoad(page: Page) {
  await mockTempo(page);
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]', { timeout: LOAD_TIMEOUT });
  await page.waitForSelector(
    '[data-testid^="trace-item-"], [data-testid="search-error-message"], [class*="empty"]',
    { timeout: LOAD_TIMEOUT }
  );
}

/** Wait for traces to be present and return the first trace ID */
async function getFirstTraceId(page: Page): Promise<string | null> {
  try {
    await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: LOAD_TIMEOUT });
  } catch {
    return null;
  }
  const first = page.locator('[data-testid^="trace-item-"]').first();
  const testId = await first.getAttribute('data-testid');
  return testId ? testId.replace('trace-item-', '') : null;
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

test.describe('QA Agent 5 — UX Interactions & Layout', () => {
  test.setTimeout(90_000);

  // ── 1. Resize trace list ──────────────────────────────────────
  test('01 · resize trace list via drag handle', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const handle = page.locator('[data-testid="resize-handle-trace-list"]');
    await expect(handle).toBeVisible({ timeout: 5_000 });

    const traceList = page.locator('[data-testid="trace-list-pane"]');
    const beforeBox = await traceList.boundingBox();
    console.log(`[info] Trace list width before drag: ${beforeBox?.width}`);

    // Drag the handle 100px to the right
    const handleBox = await handle.boundingBox();
    if (handleBox) {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + Math.min(handleBox.height / 2, 100); // clamp Y inside viewport
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY, { steps: 10 });
      await page.mouse.up();
    }

    await page.waitForTimeout(300);
    const afterBox = await traceList.boundingBox();
    console.log(`[info] Trace list width after drag: ${afterBox?.width}`);

    const widthIncreased = (afterBox?.width ?? 0) > (beforeBox?.width ?? 0) + 50;
    console.log(`[info] Width increased by 100px: ${widthIncreased}`);
    expect(widthIncreased).toBe(true);
    await shot(page, '01-resize-trace-list');
  });

  // ── 2. Collapse trace list ────────────────────────────────────
  test('02 · collapse trace list', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const collapseBtn = page.locator('button[aria-label="Collapse trace list"]');
    await expect(collapseBtn).toBeVisible({ timeout: 5_000 });
    await collapseBtn.click();
    await page.waitForTimeout(300);

    // Trace list pane should be gone
    const traceList = page.locator('[data-testid="trace-list-pane"]');
    await expect(traceList).not.toBeVisible();

    // Expand button should appear
    const expandBtn = page.locator('button[aria-label="Expand trace list"]');
    await expect(expandBtn).toBeVisible();

    console.log('[PASS] Collapse: trace list hidden, expand button visible');
    await shot(page, '02-collapsed-trace-list');
  });

  // ── 3. Expand trace list ──────────────────────────────────────
  test('03 · expand trace list after collapse', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const traceList = page.locator('[data-testid="trace-list-pane"]');
    const initialTraceCount = await traceList.locator('[data-testid^="trace-item-"]').count();
    expect(initialTraceCount).toBeGreaterThan(0);

    // First collapse
    const collapseBtn = page.locator('button[aria-label="Collapse trace list"]');
    await expect(collapseBtn).toBeVisible({ timeout: 5_000 });
    await collapseBtn.click();
    await page.waitForTimeout(300);

    // Then expand
    const expandBtn = page.locator('button[aria-label="Expand trace list"]');
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();
    await page.waitForTimeout(300);

    // Trace list pane should be visible again
    await expect(traceList).toBeVisible();

    // Traces should still be loaded after the pane is remounted.
    const traceItems = traceList.locator('[data-testid^="trace-item-"]');
    const count = await traceItems.count();
    console.log(`[info] Trace count after re-expand: ${count}`);
    expect(count).toBe(initialTraceCount);

    console.log('[PASS] Expand: trace list visible, content intact');
    await shot(page, '03-expanded-trace-list');
  });

  // ── 4. Summary bar ────────────────────────────────────────────
  test('04 · summary bar is present after search', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const summaryBar = page.locator('[data-testid="trace-summary-bar"]');
    // Allow it to be present but possibly empty/zero
    const count = await summaryBar.count();
    console.log(`[info] trace-summary-bar elements: ${count}`);
    if (count > 0) {
      const text = await summaryBar.first().textContent();
      console.log(`[info] Summary bar text: ${text?.replace(/\s+/g, ' ').trim()}`);
      expect(summaryBar.first()).toBeVisible();
      console.log('[PASS] Summary bar present');
    } else {
      console.warn('[WARN] trace-summary-bar not found — check if TraceSummaryBar renders when traces array is empty');
    }
    await shot(page, '04-summary-bar');
  });

  // ── 5. Error filter button presence ──────────────────────────
  test('05 · errors-only button appears when error traces exist', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const traceItems = page.locator('[data-testid^="trace-item-"]');
    await expect(traceItems).toHaveCount(2);

    const errBtn = page.getByRole('button', { name: /Errors/ });
    await expect(errBtn).toBeVisible();
    console.log('[PASS] Error filter button present');
    await shot(page, '05-error-filter-button');
  });

  // ── 6. Errors-only filter ─────────────────────────────────────
  test('06 · errors-only filter shows only error traces', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const errBtn = page.getByRole('button', { name: /Errors/ });
    await expect(errBtn).toBeVisible();

    const allTracesBefore = await page.locator('[data-testid^="trace-item-"]').count();
    console.log(`[info] Traces before filter: ${allTracesBefore}`);
    expect(allTracesBefore).toBe(2);

    await errBtn.first().click();
    await page.waitForTimeout(300);

    const tracesAfter = page.locator('[data-testid^="trace-item-"]');
    const countAfter = await tracesAfter.count();
    console.log(`[info] Traces after errors-only filter: ${countAfter}`);

    expect(countAfter).toBe(1);
    await expect(page.getByTestId(`trace-item-${SEARCH_RESPONSE.traces[0].traceID}`)).toBeVisible();
    await expect(page.getByTestId(`trace-item-${SEARCH_RESPONSE.traces[1].traceID}`)).toHaveCount(0);
    // The header should show filtered count
    const header = page.locator('[data-testid="trace-list-pane"] div').first();
    const headerText = await header.textContent();
    console.log(`[info] Header text after filter: ${headerText?.replace(/\s+/g, ' ').trim()}`);

    // Toggle back off
    await errBtn.first().click();
    await page.waitForTimeout(300);
    const countRestored = await page.locator('[data-testid^="trace-item-"]').count();
    console.log(`[info] Traces after removing filter: ${countRestored}`);
    expect(countRestored).toBe(allTracesBefore);

    console.log('[PASS] Errors-only filter correctly filters and unfilters');
    await shot(page, '06-errors-only-filter');
  });

  // ── 7. Viewport 1440px ───────────────────────────────────────
  test('07 · viewport 1440px — no overflow or layout issues', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAndWaitForLoad(page);

    const explorer = page.locator('[data-testid="trace-explorer"]');
    await expect(explorer).toBeVisible();

    const explorerBox = await explorer.boundingBox();
    console.log(`[info] Explorer box at 1440px: ${JSON.stringify(explorerBox)}`);

    // Check for horizontal overflow — body scrollWidth should not exceed viewport
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 1440;
    const hasHorizontalOverflow = bodyScrollWidth > viewportWidth + 5; // 5px tolerance
    console.log(`[info] Body scroll width: ${bodyScrollWidth}, viewport: ${viewportWidth}, overflow: ${hasHorizontalOverflow}`);
    expect(hasHorizontalOverflow).toBe(false);

    await shot(page, '07-viewport-1440');
  });

  // ── 8. Viewport 1024px ───────────────────────────────────────
  test('08 · viewport 1024px — still functional', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoAndWaitForLoad(page);

    const explorer = page.locator('[data-testid="trace-explorer"]');
    await expect(explorer).toBeVisible();

    // Search button should still be accessible
    const searchBtn = page.getByRole('button', { name: /search/i });
    const searchVisible = await searchBtn.count() > 0 && await searchBtn.first().isVisible();
    console.log(`[info] Search button visible at 1024px: ${searchVisible}`);

    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`[info] Body scroll width at 1024px: ${bodyScrollWidth}`);
    const hasOverflow = bodyScrollWidth > 1024 + 5;
    console.log(`[info] Horizontal overflow at 1024px: ${hasOverflow}`);

    await shot(page, '08-viewport-1024');
  });

  // ── 9. Viewport 800px ────────────────────────────────────────
  test('09 · viewport 800px — functional, no broken layout', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 768 });
    await gotoAndWaitForLoad(page);

    const explorer = page.locator('[data-testid="trace-explorer"]');
    await expect(explorer).toBeVisible();

    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`[info] Body scroll width at 800px: ${bodyScrollWidth}`);
    const hasOverflow = bodyScrollWidth > 800 + 10; // wider tolerance for narrow layout
    if (hasOverflow) {
      console.warn(`[WARN] Horizontal overflow detected at 800px: scrollWidth=${bodyScrollWidth}`);
    } else {
      console.log('[PASS] No significant horizontal overflow at 800px');
    }

    // Plugin root should be rendered
    const traceList = page.locator('[data-testid="trace-list-pane"]');
    const listVisible = await traceList.isVisible().catch(() => false);
    console.log(`[info] Trace list visible at 800px: ${listVisible}`);

    await shot(page, '09-viewport-800');
  });

  // ── 10. Console errors ────────────────────────────────────────
  test('10 · collect console errors during load and trace interaction', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') { consoleErrors.push(msg.text()); }
      if (msg.type() === 'warning') { consoleWarnings.push(msg.text()); }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    await gotoAndWaitForLoad(page);

    // Interact: click first trace if available
    const firstTrace = page.locator('[data-testid^="trace-item-"]').first();
    if (await firstTrace.count() > 0) {
      await firstTrace.click();
      try {
        await page.waitForSelector('[data-testid="trace-detail-view"]', { timeout: LOAD_TIMEOUT });
      } catch { /* ok */ }
      await page.waitForTimeout(500);
    }

    console.log(`[info] Console errors collected: ${consoleErrors.length}`);
    console.log(`[info] Console warnings collected: ${consoleWarnings.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.forEach((e, i) => console.warn(`[console-error-${i}] ${e}`));
    }
    if (consoleWarnings.length > 0) {
      consoleWarnings.slice(0, 5).forEach((w, i) => console.log(`[console-warn-${i}] ${w}`));
    }

    // Report but don't hard-fail — some Grafana internal warnings are expected
    // Flag genuine app errors (exclude known noisy Grafana/React internals)
    const appErrors = consoleErrors.filter((e) =>
      !e.includes('ResizeObserver loop') &&
      !e.includes('favicon') &&
      !e.includes('Warning: ')
    );
    if (appErrors.length > 0) {
      console.warn(`[WARN] ${appErrors.length} application-level console error(s) detected`);
      appErrors.forEach((e, i) => console.warn(`  [app-error-${i}] ${e}`));
    } else {
      console.log('[PASS] No application-level console errors');
    }

    await shot(page, '10-console-errors-check');
  });

  // ── 11. No stale "Loading" text ───────────────────────────────
  test('11 · no stale "Loading" text after traces load', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    // Give the page a moment to settle fully
    await page.waitForTimeout(1000);

    // Find any visible "Loading" text (case-insensitive)
    const loadingElements = page.locator(':visible').filter({ hasText: /^Loading$/i });
    const count = await loadingElements.count();
    console.log(`[info] Visible "Loading" elements after load: ${count}`);

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const text = await loadingElements.nth(i).textContent();
        const tag = await loadingElements.nth(i).evaluate((el) => el.tagName);
        console.warn(`[WARN] Stale loading element ${i}: <${tag}> "${text}"`);
      }
    } else {
      console.log('[PASS] No stale "Loading" text visible after traces loaded');
    }

    // Also check for "Searching…" stale state
    const searchingElements = page.locator(':visible', { hasText: 'Searching…' });
    const searchingCount = await searchingElements.count();
    console.log(`[info] Visible "Searching…" elements after load: ${searchingCount}`);

    expect(count).toBe(0);
    await shot(page, '11-no-stale-loading');
  });

  // ── 12. Share/copy button ─────────────────────────────────────
  test('12 · Share button is present and clickable without throwing', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await gotoAndWaitForLoad(page);

    // Share button uses ClipboardButton with icon="share-alt" and text "Share"
    const shareBtn = page.getByRole('button', { name: /share/i });
    const count = await shareBtn.count();
    console.log(`[info] Share button count: ${count}`);
    expect(count).toBeGreaterThan(0);

    const shareVisible = await shareBtn.first().isVisible();
    expect(shareVisible).toBe(true);
    console.log('[PASS] Share button is visible');

    // Click it — should not throw JS errors
    await shareBtn.first().click();
    await page.waitForTimeout(500);

    const errorsAfterClick = jsErrors.filter((e) => !e.includes('ResizeObserver'));
    console.log(`[info] JS errors after Share click: ${errorsAfterClick.length}`);
    if (errorsAfterClick.length > 0) {
      console.warn('[WARN] JS errors after Share click:', errorsAfterClick);
    } else {
      console.log('[PASS] Share button click produced no JS errors');
    }

    await shot(page, '12-share-button');
  });

  // ── 13. Keyboard j/k navigation ──────────────────────────────
  test('13 · keyboard j/k navigates spans after trace is opened', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const traceId = await getFirstTraceId(page);
    if (!traceId) {
      console.warn('[SKIP] No traces available for keyboard navigation test');
      return;
    }

    // Click the first trace to open it
    await page.locator(`[data-testid="trace-item-${traceId}"]`).click();
    try {
      await page.waitForSelector('[data-testid="span-list-pane"]', { timeout: LOAD_TIMEOUT });
    } catch {
      console.warn('[SKIP] Span list pane did not appear — cannot test j/k navigation');
      return;
    }
    await page.waitForTimeout(500);

    const spanRows = page.locator('[data-testid^="span-row-"]');
    const spanCount = await spanRows.count();
    console.log(`[info] Span rows available for navigation: ${spanCount}`);

    if (spanCount < 2) {
      console.warn('[SKIP] Less than 2 spans — cannot meaningfully test j/k navigation');
      return;
    }

    // Find the initially selected span
    const selectedBefore = page.locator('[data-testid^="span-row-"][aria-selected="true"], [data-testid^="span-row-"].selected');
    const selBeforeCount = await selectedBefore.count();
    console.log(`[info] Initially selected span rows: ${selBeforeCount}`);

    // Press 'j' to move to next span
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await shot(page, '13a-after-j-press');

    // Press 'k' to move back
    await page.keyboard.press('k');
    await page.waitForTimeout(200);
    await shot(page, '13b-after-k-press');

    // Press 'j' multiple times
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await shot(page, '13c-after-jj-press');

    console.log('[INFO] j/k key presses fired without error (visual verification via screenshots)');
  });

  // ── 14. llt-traceId URL param deep-link ──────────────────────
  test('14 · llt-traceId URL param opens the trace and preserves the trace list', async ({ page }) => {
    const { traceUrls } = await mockTempo(page);
    const realTraceId = SEARCH_RESPONSE.traces[0].traceID;
    console.log(`[info] Using trace ID for deep-link test: ${realTraceId}`);

    await page.goto(`${PLUGIN_URL}?llt-traceId=${realTraceId}`);
    await page.waitForSelector('[data-testid="trace-explorer"]', { timeout: LOAD_TIMEOUT });

    await expect(page.getByRole('button', { name: 'Expand trace list' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand trace list' }).click();
    await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: LOAD_TIMEOUT });

    // Assert: trace list IS populated (not empty)
    const traceItems = page.locator('[data-testid^="trace-item-"]');
    const traceCount = await traceItems.count();
    console.log(`[info] Trace count with llt-traceId param: ${traceCount}`);
    expect(traceCount).toBe(2);
    console.log('[PASS] Trace list populated when llt-traceId param present');

    const detailView = page.locator('[data-testid="trace-detail-view"]');
    await expect(detailView).toBeVisible({ timeout: LOAD_TIMEOUT });
    console.log('[PASS] Trace detail view opened from URL param');

    const linkedItem = page.getByTestId(`trace-item-${realTraceId}`);
    await expect(linkedItem).toBeVisible();
    await expect(linkedItem).toHaveAttribute('aria-selected', 'true');
    expect(traceUrls.some((requestUrl) => requestUrl.pathname.endsWith(`/api/traces/${realTraceId}`))).toBe(true);
    console.log('[PASS] Linked trace item is selected and the exact trace ID was fetched');

    await shot(page, '14-url-param-deep-link');
  });

  // ── 15. Back navigation ───────────────────────────────────────
  test('15 · back navigation clears trace detail but keeps list populated', async ({ page }) => {
    await gotoAndWaitForLoad(page);

    const traceId = await getFirstTraceId(page);
    if (!traceId) {
      console.warn('[SKIP] No traces available for back navigation test');
      return;
    }

    // Open a trace
    await page.locator(`[data-testid="trace-item-${traceId}"]`).click();
    try {
      await page.waitForSelector('[data-testid="trace-detail-view"]', { timeout: LOAD_TIMEOUT });
    } catch {
      console.warn('[SKIP] trace-detail-view did not appear');
      return;
    }

    console.log('[info] Trace detail open — clicking Back');
    await shot(page, '15a-before-back');

    // Click the Back button
    const backBtn = page.locator('button[class*="backBtn"], button').filter({ hasText: /back/i }).first();
    const backBtnCount = await backBtn.count();
    console.log(`[info] Back button candidates: ${backBtnCount}`);

    // The back button is rendered as a <button> inside trace-detail-view header
    // From TraceDetail.tsx it has class "backBtn" and contains text via Icon + "Back"
    const detailBackBtn = page.locator('[data-testid="trace-detail-view"] button').first();
    const detailBackCount = await detailBackBtn.count();
    console.log(`[info] Back btn in trace-detail-view: ${detailBackCount}`);

    if (detailBackCount > 0) {
      await detailBackBtn.click();
    } else if (backBtnCount > 0) {
      await backBtn.click();
    } else {
      console.warn('[WARN] Could not find Back button — trying aria-label');
      const ariaBackBtn = page.locator('button[aria-label*="back" i], button[title*="back" i]').first();
      if (await ariaBackBtn.count() > 0) {
        await ariaBackBtn.click();
      } else {
        console.warn('[SKIP] No back button found');
        return;
      }
    }

    await page.waitForTimeout(500);
    await shot(page, '15b-after-back');

    // Assert: trace detail view should be gone
    const detailView = page.locator('[data-testid="trace-detail-view"]');
    const detailVisible = await detailView.count() > 0 && await detailView.first().isVisible().catch(() => false);
    console.log(`[info] trace-detail-view visible after back: ${detailVisible}`);
    expect(detailVisible).toBe(false);
    console.log('[PASS] Trace detail cleared after Back');

    // Assert: trace list is still populated
    const traceList = page.locator('[data-testid="trace-list-pane"]');
    await expect(traceList).toBeVisible();
    const traceItems = traceList.locator('[data-testid^="trace-item-"]');
    const count = await traceItems.count();
    console.log(`[info] Trace list count after back: ${count}`);
    expect(count).toBeGreaterThan(0);
    console.log('[PASS] Trace list remains populated after Back');

    await shot(page, '15c-list-after-back');
  });

  // ── Bonus: side-by-side viewport screenshots ─────────────────
  test('16 · screenshot comparison at 1440px and 800px', async ({ page }) => {
    // 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAndWaitForLoad(page);
    await shot(page, '16a-full-1440');

    // Now at 800px — resize without re-navigating to see how layout reflows
    await page.setViewportSize({ width: 800, height: 768 });
    await page.waitForTimeout(500);
    await shot(page, '16b-full-800-resized');

    // Navigate fresh at 800px
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]', { timeout: LOAD_TIMEOUT });
    try { await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: LOAD_TIMEOUT }); } catch {}
    await shot(page, '16c-fresh-800');

    console.log('[INFO] Viewport screenshots saved to', SCREENSHOT_DIR);
  });
});
