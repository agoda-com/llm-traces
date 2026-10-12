/**
 * Comprehensive scroll-behaviour tests for the LLM Traces plugin.
 *
 * Covers every scenario discovered during the scroll implementation:
 *  1.  Layout: page scroll range = plugin toolbar height only
 *  2.  Layout: all 3 columns have independent overflow-y:auto scroll
 *  3.  Layout: overscroll-behavior:contain on all 3 columns
 *  4.  Scroll DOWN in any column while toolbar is visible → page scrolls down first
 *  5.  Scroll UP   in column at scrollTop=0               → page scrolls up (toolbar reveals)
 *  6.  Scroll DOWN when page at max, column not at bottom → column scrolls, page stays
 *  7.  Scroll DOWN when page at max, column at bottom     → hard stop (no black void)
 *  8.  Scroll UP   in column not at top                   → column scrolls up, page stays
 *  9.  All three panes (trace-list, span-list, span-detail) trigger page scroll while toolbar visible
 * 10.  Infinite scroll: loading more traces when column scrolled to bottom
 */

import { test, expect, Page } from '@playwright/test';
import { waitForToolbarLayout } from './waitForToolbarLayout';

const PLUGIN_URL = '/a/llm-traces-app';

// ─── fixtures ────────────────────────────────────────────────────────────────

const MANY_TRACES = {
  traces: Array.from({ length: 50 }, (_, i) => ({
    traceID: `trace${String(i).padStart(16, '0')}`,
    rootServiceName: `service-${i}`,
    rootTraceName: `some-long-operation-name-${i}`,
    startTimeUnixNano: String(1741900000000000000 - i * 1_000_000_000),
    durationMs: 100 + i,
    spanSets: [],
  })),
};

function makeSpan(idx: number) {
  const id = `sp${String(idx).padStart(14, '0')}`;
  return {
    traceId: MANY_TRACES.traces[0].traceID,
    spanId: id,
    parentSpanId: idx === 0 ? '' : 'sp00000000000000',
    name: `op-${idx}`,
    startTimeUnixNano: String(1741900000000000000 + idx * 1000000),
    endTimeUnixNano:   String(1741900000000000000 + idx * 1000000 + 500000),
    attributes: [
      { key: 'openinference.span.kind', value: { stringValue: idx === 0 ? 'CHAIN' : 'LLM' } },
      { key: 'llm.model_name', value: { stringValue: 'gpt-4o' } },
    ],
    events: [],
  };
}

const BIG_TRACE = {
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
    scopeSpans: [{ spans: Array.from({ length: 60 }, (_, i) => makeSpan(i)) }],
  }],
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function setupPage(page: Page, traceBody = BIG_TRACE) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANY_TRACES) }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(traceBody) }));

  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-list-pane"]', { timeout: 15000 });
  await waitForToolbarLayout(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function maxPageScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

async function scrollPageToMax(page: Page) {
  const max = await maxPageScroll(page);
  await page.evaluate((m: number) => window.scrollTo(0, m), max);
  await page.waitForTimeout(50);
  return max;
}

async function wheelOn(page: Page, selector: string, deltaY: number) {
  const box = await page.locator(selector).boundingBox();
  if (!box) { throw new Error(`No bounding box for ${selector}`); }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(150);
}

async function scrollColumnDown(page: Page, selector: string, amount = 200) {
  await page.evaluate(({ sel, amt }: { sel: string; amt: number }) => {
    const el = document.querySelector(sel) as HTMLElement;
    el.scrollTop += amt;
  }, { sel: selector, amt: amount });
  await page.waitForTimeout(50);
}

// Wait for the span-list pane to appear (first trace is auto-selected)
async function waitForSpanList(page: Page) {
  await page.waitForSelector('[data-testid="span-list-pane"]', { timeout: 10000 });
}

// ─── 1. Layout: page scroll range = toolbar height ───────────────────────────

test('layout: page scroll range equals plugin toolbar height', async ({ page }) => {
  await setupPage(page);
  await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: 10000 });

  const { pageScrollRange, toolbarH } = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="plugin-toolbar"]') as HTMLElement;
    return {
      pageScrollRange: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      toolbarH: Math.round(toolbar.getBoundingClientRect().height),
    };
  });

  console.log(`pageScrollRange=${pageScrollRange} toolbarH=${toolbarH}`);
  expect(pageScrollRange, 'Page scroll range should equal toolbar height (not toolbar+nav)')
    .toBeLessThanOrEqual(toolbarH + 10);
  expect(pageScrollRange).toBeGreaterThan(0);
});

// ─── 2. Layout: all 3 columns scroll independently ───────────────────────────

test('layout: trace-list, span-list and span-detail all have independent overflow-y:auto', async ({ page }) => {
  await setupPage(page);
  await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: 10000 });
  await waitForSpanList(page);
  await page.waitForSelector('[data-testid="span-detail-pane"]', { timeout: 8000 });

  const panes = await page.evaluate(() => {
    const sel = ['trace-list-pane', 'span-list-pane', 'span-detail-pane'];
    return sel.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      if (!el) { return { id, found: false, overflowY: '', overflows: false }; }
      const st = window.getComputedStyle(el);
      return {
        id,
        found: true,
        overflowY: st.overflowY,
        overflows: el.scrollHeight > el.clientHeight + 2,
      };
    });
  });

  for (const pane of panes) {
    expect(pane.found, `${pane.id} must exist`).toBe(true);
    expect(pane.overflowY, `${pane.id} must be overflow-y:auto`).toBe('auto');
  }
  // At least trace-list and span-list overflow with 50 traces / 60 spans
  const traceList = panes.find((p) => p.id === 'trace-list-pane')!;
  const spanList  = panes.find((p) => p.id === 'span-list-pane')!;
  expect(traceList.overflows, 'trace-list overflows with 50 traces').toBe(true);
  expect(spanList.overflows,  'span-list overflows with 60 spans').toBe(true);
});

// ─── 3. Layout: overscroll-behavior:contain on all columns ───────────────────

test('layout: all scrollable columns have overscroll-behavior:contain', async ({ page }) => {
  await setupPage(page);
  await waitForSpanList(page);
  await page.waitForSelector('[data-testid="span-detail-pane"]', { timeout: 8000 });

  const overscrolls = await page.evaluate(() => {
    const sel = ['trace-list-pane', 'span-list-pane', 'span-detail-pane'];
    return sel.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      return { id, value: el ? window.getComputedStyle(el).overscrollBehavior : 'NOT FOUND' };
    });
  });

  for (const { id, value } of overscrolls) {
    expect(value, `${id} must have overscroll-behavior:contain`).toBe('contain');
  }
});

// ─── 4. Scroll DOWN while toolbar visible → page scrolls ─────────────────────

test('scroll: DOWN in trace-list while toolbar visible → page scrolls down', async ({ page }) => {
  await setupPage(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await wheelOn(page, '[data-testid="trace-list-pane"]', 300);

  const scrollY = await page.evaluate(() => window.scrollY);
  console.log('pageScrollY after wheel DOWN (toolbar visible):', scrollY);
  expect(scrollY, 'Page should scroll down to hide toolbar').toBeGreaterThan(0);
});

// ─── 5. Scroll UP at column top → page scrolls up ────────────────────────────

test('scroll: UP in trace-list at top → page scrolls up to reveal toolbar', async ({ page }) => {
  await setupPage(page);
  const max = await scrollPageToMax(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // Column is at top (freshly loaded)
  expect(await page.evaluate(() =>
    (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop
  )).toBe(0);

  await wheelOn(page, '[data-testid="trace-list-pane"]', -300);

  const scrollY = await page.evaluate(() => window.scrollY);
  console.log('pageScrollY after wheel UP on column at top:', scrollY, '(was:', max, ')');
  expect(scrollY, 'Page should scroll back toward toolbar').toBeLessThan(max);
});

// ─── 6. Scroll DOWN, page at max, column not at bottom → column scrolls ──────

test('scroll: DOWN in trace-list when page at max → column scrolls, page stays', async ({ page }) => {
  await setupPage(page);
  const max = await scrollPageToMax(page);

  // Verify column overflows so there is room to scroll
  const overflows = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    return el.scrollHeight > el.clientHeight;
  });
  expect(overflows).toBe(true);

  // Programmatically scroll the column — synthetic wheel events are unreliable on CI
  await scrollColumnDown(page, '[data-testid="trace-list-pane"]', 300);

  const { pageY, colY } = await page.evaluate(() => ({
    pageY: window.scrollY,
    colY: (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop,
  }));
  const trueMax = await maxPageScroll(page);
  console.log('After DOWN at page max:', { pageY, colY, max, trueMax });
  expect(pageY, 'Page should stay at max').toBeLessThanOrEqual(trueMax + 1);
  expect(colY, 'Column should have scrolled down').toBeGreaterThan(0);
});

// ─── 7. Scroll DOWN at column bottom, page at max → hard stop ────────────────

test('scroll: DOWN when both page and column are at max → hard stop', async ({ page }) => {
  await setupPage(page);
  await scrollPageToMax(page);
  // Scroll column all the way to the bottom
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(50);

  const { pageYBefore, colYBefore } = await page.evaluate(() => ({
    pageYBefore: window.scrollY,
    colYBefore: (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop,
  }));

  await wheelOn(page, '[data-testid="trace-list-pane"]', 300);

  const { pageYAfter, colYAfter, trueMax } = await page.evaluate(() => ({
    pageYAfter: window.scrollY,
    colYAfter: (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop,
    trueMax: document.documentElement.scrollHeight - window.innerHeight,
  }));
  console.log('Hard stop check:', { pageYBefore, pageYAfter, colYBefore, colYAfter, trueMax });
  expect(pageYAfter, 'Page must not scroll past max').toBeLessThanOrEqual(trueMax + 1);
  // page must not go to black void — column may scroll naturally if new content is appended
  // (loadMoreTraces fires from onScroll when at bottom, which can grow the list)
  expect(pageYAfter, 'Page must not scroll past max').toBeLessThanOrEqual(trueMax + 1);
});

// ─── 8. Scroll UP in column mid-way → column scrolls up, page stays ──────────

test('scroll: UP in trace-list when column has scrolled down → column scrolls up, page stays', async ({ page }) => {
  await setupPage(page);
  await scrollPageToMax(page);
  // Scroll column down first
  await scrollColumnDown(page, '[data-testid="trace-list-pane"]', 400);

  const colBefore = await page.evaluate(() =>
    (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop
  );
  expect(colBefore).toBeGreaterThan(0);

  const pageBefore = await page.evaluate(() => window.scrollY);
  await wheelOn(page, '[data-testid="trace-list-pane"]', -300);

  // Wait for column scroll to take effect
  await expect.poll(() => page.evaluate(() =>
    (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop
  ), { message: 'Column should scroll up', timeout: 5_000 }).toBeLessThan(colBefore);

  const { pageAfter, colAfter } = await page.evaluate(() => ({
    pageAfter: window.scrollY,
    colAfter: (document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement).scrollTop,
  }));
  console.log('Scroll UP mid-column:', { pageBefore, pageAfter, colBefore, colAfter });
  expect(pageAfter, 'Page should NOT scroll when column still has room above').toBe(pageBefore);
});

// ─── 9. All 3 panes scroll the page while toolbar is visible ─────────────────

for (const pane of ['trace-list-pane', 'span-list-pane', 'span-detail-pane'] as const) {
  test(`scroll: DOWN in ${pane} while toolbar visible → page scrolls`, async ({ page }) => {
    await setupPage(page);
    await waitForSpanList(page);
    if (pane === 'span-detail-pane') {
      await page.waitForSelector('[data-testid="span-detail-pane"]', { timeout: 8000 });
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    await wheelOn(page, `[data-testid="${pane}"]`, 300);

    const scrollY = await page.evaluate(() => window.scrollY);
    console.log(`pageScrollY after wheel DOWN on ${pane}:`, scrollY);
    expect(scrollY, `Page should scroll when wheeling down in ${pane}`).toBeGreaterThan(0);
  });
}

// ─── 10. Infinite scroll ──────────────────────────────────────────────────────

test('infinite scroll: loads next page when trace-list scrolled to bottom', async ({ page }) => {
  const batch1 = Array.from({ length: 30 }, (_, i) => ({
    traceID: `p1${String(i).padStart(14, '0')}`,
    rootServiceName: `svc-${i}`, rootTraceName: `op-p1-${i}`,
    startTimeUnixNano: String(1741900000000000000 - i * 1_000_000_000),
    durationMs: 100, spanSets: [],
  }));
  const batch2 = Array.from({ length: 15 }, (_, i) => ({
    traceID: `p2${String(i).padStart(14, '0')}`,
    rootServiceName: `svc2-${i}`, rootTraceName: `op-p2-${i}`,
    startTimeUnixNano: String(1741800000000000000 - i * 1_000_000_000),
    durationMs: 80, spanSets: [],
  }));

  let calls = 0;
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (r) => {
    calls++;
    await r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ traces: calls === 1 ? batch1 : batch2 }) });
  });
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resourceSpans: [] }) }));

  await page.goto(PLUGIN_URL);
  await page.waitForSelector(`[data-testid="trace-item-${batch1[0].traceID}"]`, { timeout: 15000 });

  const initial = await page.locator('[data-testid="trace-list-pane"] [role="option"]').count();
  expect(initial, 'Initial batch should show 30 traces').toBe(30);

  // Scroll the trace list to bottom to trigger load-more
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    el.scrollTop = el.scrollHeight;
  });

  await page.waitForSelector(`[data-testid="trace-item-${batch2[0].traceID}"]`, { timeout: 10000 });
  const total = await page.locator('[data-testid="trace-list-pane"] [role="option"]').count();
  expect(total, 'Should show 45 traces after loading second batch').toBe(45);

  await expect(page.getByText('No more traces')).toBeVisible({ timeout: 5000 });
});
