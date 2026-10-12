import { test, expect, Page } from '@playwright/test';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

// 50 traces to force trace-list overflow
const BIG_SEARCH_RESPONSE = {
  traces: Array.from({ length: 50 }, (_, i) => ({
    traceID: `trace${String(i).padStart(16, '0')}`,
    rootServiceName: `service-${i}`,
    rootTraceName: `some-long-operation-name-${i}`,
    startTimeUnixNano: '1741900000000000000',
    durationMs: 100 + i,
    spanSets: [],
  })),
};

// 60 spans to force span-list overflow — all children of span0
function makeOiSpan(idx: number) {
  const id = `sp${String(idx).padStart(14, '0')}`;
  return {
    traceId: 'trace0000000000000000',
    spanId: id,
    parentSpanId: idx === 0 ? '' : 'sp00000000000000',
    name: `operation-number-${idx}`,
    startTimeUnixNano: String(1741900000000000000 + idx * 1000000),
    endTimeUnixNano: String(1741900000000000000 + idx * 1000000 + 500000),
    attributes: [
      { key: 'openinference.span.kind', value: { stringValue: idx === 0 ? 'CHAIN' : 'LLM' } },
      { key: 'llm.model_name', value: { stringValue: 'gpt-4o' } },
    ],
    events: [],
  };
}

const BIG_TRACE_RESPONSE = {
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }] },
    scopeSpans: [{ spans: Array.from({ length: 60 }, (_, i) => makeOiSpan(i)) }],
  }],
};

async function mockBigApis(page: Page) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIG_SEARCH_RESPONSE) });
  });
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIG_TRACE_RESPONSE) });
  });
}

test('outer Grafana page does NOT scroll with 50 traces + 60 spans', async ({ page }) => {
  await mockBigApis(page);
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]', { timeout: 15000 });

  // Wait for traces to render (app auto-selects first trace)
  await page.waitForSelector('[data-testid^="trace-item-"]', { timeout: 10000 });

  // Span list should appear automatically (first trace is auto-selected)
  await page.waitForSelector('[data-testid="span-list-pane"]', { timeout: 10000 });

  const layout = await page.evaluate(() => {
    const traceList = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    const spanList = document.querySelector('[data-testid="span-list-pane"]') as HTMLElement;

    const info = (el: HTMLElement | null, label: string) => {
      if (!el) return { label, found: false, clientHeight: 0, scrollHeight: 0, overflowY: '', overflows: false };
      const st = window.getComputedStyle(el);
      return {
        label,
        found: true,
        clientHeight: Math.round(el.clientHeight),
        scrollHeight: Math.round(el.scrollHeight),
        overflows: el.scrollHeight > el.clientHeight + 2,
        overflowY: st.overflowY,
      };
    };

    const toolbar = document.querySelector('[data-testid="plugin-toolbar"]') as HTMLElement | null;
    const body = document.querySelector('[data-testid="trace-explorer"] > div:nth-child(2)') as HTMLElement | null;
    return {
      viewportH: window.innerHeight,
      docScrollH: Math.round(document.documentElement.scrollHeight),
      docClientH: Math.round(document.documentElement.clientHeight),
      toolbarH: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0,
      // offsetTop of the body = all headers above it (Grafana nav + plugin toolbar)
      bodyOffsetTop: body ? Math.round(body.getBoundingClientRect().top + window.scrollY) : 0,
      traceList: info(traceList, 'traceList'),
      spanList: info(spanList, 'spanList'),
    };
  });

  const pageScrollRange = layout.docScrollH - layout.docClientH;
  console.log('\n=== LAYOUT WITH OVERFLOW DATA ===');
  console.log(`Viewport: ${layout.viewportH}px`);
  console.log(`Toolbar:  ${layout.toolbarH}px (plugin toolbar only)`);
  console.log(`Body offset from page top: ${layout.bodyOffsetTop}px (Grafana nav + plugin toolbar)`);
  console.log(`Doc: scrollH=${layout.docScrollH} clientH=${layout.docClientH} → page scroll range: ${pageScrollRange}px (want = toolbarH ~${layout.toolbarH}px)`);

  console.log(`TraceList: clientH=${layout.traceList.clientHeight} scrollH=${layout.traceList.scrollHeight} overflows=${layout.traceList.overflows} overflow-y=${layout.traceList.overflowY}`);
  console.log(`SpanList:  clientH=${layout.spanList.clientHeight} scrollH=${layout.spanList.scrollHeight} overflows=${layout.spanList.overflows} overflow-y=${layout.spanList.overflowY}`);

  // 1. Page scroll range must equal exactly the plugin toolbar height (not nav + toolbar).
  //    The Grafana nav stays visible; only the plugin toolbar scrolls away.
  //    Content-driven scroll (3000px+) would fail this check.
  expect(pageScrollRange, `Page scroll range (${pageScrollRange}px) should equal toolbar height (${layout.toolbarH}px)`)
    .toBeLessThanOrEqual(layout.toolbarH + 10);

  // 2. Trace list has overflowing content and can independently scroll
  expect(layout.traceList.found, 'trace-list-pane must exist').toBe(true);
  expect(layout.traceList.overflows, 'Trace list should overflow (50 traces)').toBe(true);
  expect(layout.traceList.overflowY, 'Trace list must have overflow-y: auto').toBe('auto');

  // 3. Span list has overflowing content and can independently scroll
  expect(layout.spanList.found, 'span-list-pane must exist').toBe(true);
  expect(layout.spanList.overflows, 'Span list should overflow (60 spans)').toBe(true);
  expect(layout.spanList.overflowY, 'Span list must have overflow-y: auto').toBe('auto');

  // 4. Overscroll containment: scrolling past column boundary must NOT propagate to page
  const overscroll = await page.evaluate(() => {
    const traceList = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    const spanList = document.querySelector('[data-testid="span-list-pane"]') as HTMLElement;
    return {
      traceListOverscroll: window.getComputedStyle(traceList).overscrollBehavior,
      spanListOverscroll: window.getComputedStyle(spanList).overscrollBehavior,
    };
  });
  expect(overscroll.traceListOverscroll, 'trace list must have overscroll-behavior: contain').toBe('contain');
  expect(overscroll.spanListOverscroll, 'span list must have overscroll-behavior: contain').toBe('contain');
});

test('infinite scroll — loads more traces when scrolled to bottom', async ({ page }) => {
  // First batch: 30 traces (a full page)
  const batch1 = Array.from({ length: 30 }, (_, i) => ({
    traceID: `page1trace${String(i).padStart(10, '0')}`,
    rootServiceName: `svc-${i}`,
    rootTraceName: `op-page1-${i}`,
    startTimeUnixNano: String(1741900000000000000 - i * 1_000_000_000),
    durationMs: 100,
    spanSets: [],
  }));
  // Second batch: 15 traces (partial page → no more after this)
  const batch2 = Array.from({ length: 15 }, (_, i) => ({
    traceID: `page2trace${String(i).padStart(10, '0')}`,
    rootServiceName: `svc-old-${i}`,
    rootTraceName: `op-page2-${i}`,
    startTimeUnixNano: String(1741870000000000000 - i * 1_000_000_000),
    durationMs: 80,
    spanSets: [],
  }));

  let searchCallCount = 0;
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
    searchCallCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ traces: searchCallCount === 1 ? batch1 : batch2 }),
    });
  });
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resourceSpans: [] }) });
  });

  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-list-pane"]', { timeout: 15000 });
  await page.waitForSelector(`[data-testid="trace-item-${batch1[0].traceID}"]`, { timeout: 10000 });

  // Verify initial load: 30 traces visible
  const initialCount = await page.locator('[data-testid="trace-list-pane"] [role="option"]').count();
  expect(initialCount, 'Should have 30 traces after initial search').toBe(30);

  // Scroll trace list to the bottom to trigger load more
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="trace-list-pane"]') as HTMLElement;
    el.scrollTop = el.scrollHeight;
  });

  // Wait for the second batch to appear
  await page.waitForSelector(`[data-testid="trace-item-${batch2[0].traceID}"]`, { timeout: 10000 });

  // Verify total: 30 + 15 = 45 traces
  const totalCount = await page.locator('[data-testid="trace-list-pane"] [role="option"]').count();
  expect(totalCount, 'Should have 45 traces after loading more').toBe(45);

  // Verify "No more traces" indicator appears (batch2 < 30 → no more)
  await expect(page.getByText('No more traces')).toBeVisible({ timeout: 5000 });
});
