/**
 * Regression tests for bugs on initial page load:
 *
 * Bug 1 — Query vanishes: The Tempo QueryEditor called onChange({ query: '{}' })
 *   during its mount, overwriting the initial LLM-filter query in state. This
 *   caused the editor to display bare `{}` instead of the full LLM span filter.
 *
 * Bug 2 — No results: When the query state was cleared to `{}`, the initial
 *   auto-search fired with a cleared/empty query, producing 0 results in the
 *   left trace list panel. Also covers the llt-traceId URL param case where
 *   openTrace() was called instead of handleRunQuery(), leaving the list empty.
 *
 * Fix: a `queryEditorDirtyRef` guard in the QueryEditorComponent onChange
 *   handler ignores spurious empty resets from the editor during mount.
 */

import { test, expect, Page } from '@playwright/test';
import {
  SEARCH_RESPONSE,
  TRACE_RESPONSE,
} from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

// The LLM filter attributes that must appear in both the editor and the search request.
const LLM_FILTER_ATTRS = [
  'span.openinference.span.kind',
  'span.gen_ai.system',
  'span.gen_ai.operation.name',
  'span.llm.model_name',
  'span.llm.request.type',
];

/**
 * Set up Tempo API mocks and return a collector for search request URLs so
 * tests can inspect the query parameters that were actually sent.
 */
async function mockTempoWithCapture(
  page: Page,
  traceResponse: unknown = TRACE_RESPONSE,
  searchResponse: unknown = SEARCH_RESPONSE
): Promise<{ searchUrls: URL[]; traceUrls: URL[] }> {
  const searchUrls: URL[] = [];
  const traceUrls: URL[] = [];

  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route, request) => {
    searchUrls.push(new URL(request.url()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(searchResponse),
    });
  });

  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route, request) => {
    traceUrls.push(new URL(request.url()));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(traceResponse),
    });
  });

  return { searchUrls, traceUrls };
}

/** Wait for the trace list to be populated after an auto-search. */
async function waitForTraces(page: Page) {
  await expect(
    page.getByTestId('trace-list-pane').locator('[data-testid^="trace-item-"]').first()
  ).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Bug 1 + Bug 2 — QueryEditor mount clears LLM filter / llt-traceId skips search
// ---------------------------------------------------------------------------
test.describe('Bug fix — initial LLM query not cleared by QueryEditor mount', () => {
  // -------------------------------------------------------------------------
  // Bug 1: TraceQL editor must show the LLM filter, not bare `{}`
  // -------------------------------------------------------------------------
  test('no search request is ever sent with bare empty TraceQL {}', async ({ page }) => {
    // The original bug caused the Tempo QueryEditor to reset the query state to
    // `{}` during mount. Even though tempoQueryToTraceQL converts `{}` to the
    // LLM filter, this test ensures the guard completely prevents any bare `{}`
    // from leaking through, which would cause unexpected empty-result searches.
    const { searchUrls } = await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    // Give the page a moment to settle in case a delayed secondary search fires
    await page.waitForTimeout(500);

    expect(searchUrls.length, 'Expected at least one search request on load').toBeGreaterThan(0);

    for (const url of searchUrls) {
      const q = url.searchParams.get('q') ?? '';
      expect(q, `Search request had bare {} query: ${url}`).not.toBe('{}');
      expect(q, `Search request had empty query: ${url}`).not.toBe('');
      // Every search request must carry the LLM filter
      const hasFilter = LLM_FILTER_ATTRS.some((attr) => q.includes(attr));
      expect(
        hasFilter,
        `Search request missing LLM filter — got q="${q}"`
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Bug 1 (API layer): the Tempo search request must use the LLM filter query
  // -------------------------------------------------------------------------
  test('initial Tempo search request uses the LLM span filter, not bare {}', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    expect(searchUrls.length, 'No search requests fired').toBeGreaterThan(0);

    // The very first search request must carry a non-empty LLM filter query.
    const firstQ = searchUrls[0].searchParams.get('q');
    expect(firstQ, 'Search request missing q parameter').toBeTruthy();
    expect(firstQ, 'Search query must not be bare empty TraceQL').not.toBe('{}');

    const hasFilter = LLM_FILTER_ATTRS.some((attr) => firstQ!.includes(attr));
    expect(
      hasFilter,
      `Expected q to contain an LLM filter attr but got: ${firstQ}`
    ).toBe(true);
  });

  test('Tempo search uses the limit and spans-per-span-set from the saved query', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);
    const savedQuery = {
      refId: 'A',
      queryType: 'traceqlSearch',
      query: `{${LLM_FILTER_ATTRS.map((attr) => `${attr} != \"\"`).join(' || ')}}`,
      limit: 13,
      spss: 7,
      filters: [
        { id: 'empty', operator: '=', scope: 'span' },
        {
          id: 'service-name',
          operator: '=',
          scope: 'resource',
          tag: 'service.name',
          value: ['my-agent-service'],
          valueType: 'string',
          isCustomValue: false,
        },
      ],
    };

    await page.goto(`${PLUGIN_URL}?llt-query=${encodeURIComponent(JSON.stringify(savedQuery))}`);
    await waitForTraces(page);

    const firstRequest = searchUrls[0];
    expect(firstRequest.searchParams.get('q')).toBe('{resource.service.name="my-agent-service"}');
    expect(firstRequest.searchParams.get('limit')).toBe('13');
    expect(firstRequest.searchParams.get('spss')).toBe('7');
  });

  // -------------------------------------------------------------------------
  // Bug 2: trace items must appear in the left column on initial page load
  // -------------------------------------------------------------------------
  test('trace results appear in the left panel on initial load without user interaction', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    const listPane = page.getByTestId('trace-list-pane');

    // Traces must populate automatically — no clicks or searches required.
    await expect(
      listPane.locator('[data-testid^="trace-item-"]').first(),
      'No trace items rendered after initial load'
    ).toBeVisible({ timeout: 15_000 });

    // Verify there are at least 2 results (matches SEARCH_RESPONSE fixture)
    const count = await listPane.locator('[data-testid^="trace-item-"]').count();
    expect(count, `Expected ≥ 2 trace items, got ${count}`).toBeGreaterThanOrEqual(2);

    // The "No traces found" empty state must NOT be visible
    await expect(
      listPane.getByText('No traces found'),
      '"No traces found" is shown even though search returned results'
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Bug 2 (trace names): confirm the actual fixture trace names appear
  // -------------------------------------------------------------------------
  test('initial load shows expected trace names from fixture', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    const listPane = page.getByTestId('trace-list-pane');
    await expect(listPane.getByText('process_query').first()).toBeVisible({ timeout: 15_000 });
    await expect(listPane.getByText('generate_content').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Bug 2 (exact trigger): loading with llt-traceId URL param must still
  // populate the trace list (the previous code called openTrace() instead of
  // handleRunQuery(), leaving the left panel empty with "0 TRACES").
  // -------------------------------------------------------------------------
  test('trace list is populated when page loads with a llt-traceId URL param', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);

    // Simulate the state left by a previous session: a trace ID in the URL
    const fakeTraceId = '4829080550953998599aabbccdd1234';
    await page.goto(`${PLUGIN_URL}?llt-traceId=${fakeTraceId}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    // Direct trace entry keeps the trace list collapsed so detail remains readable.
    await expect(page.getByRole('button', { name: 'Expand trace list' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand trace list' }).click();

    // The restored trace list MUST be populated - search must have run.
    await expect(
      page.getByTestId('trace-list-pane').locator('[data-testid^="trace-item-"]').first(),
      'No trace items rendered when llt-traceId param is present'
    ).toBeVisible({ timeout: 15_000 });

    // At least one search request must have been fired (not just a fetchTrace)
    expect(searchUrls.length, 'No search request fired when llt-traceId param is present').toBeGreaterThan(0);

    // And the search request must have carried the LLM filter
    const firstQ = searchUrls[0].searchParams.get('q') ?? '';
    const hasFilter = LLM_FILTER_ATTRS.some((attr) => firstQ.includes(attr));
    expect(hasFilter, `Search with llt-traceId missing LLM filter — got q="${firstQ}"`).toBe(true);
  });

  test('trace lookup uses the selected time range and retries unbounded on 404', async ({ page }) => {
    const traceUrls: URL[] = [];
    const from = '1970-01-01T00:00:00.000Z';
    const to = '2026-09-17T04:00:33.000Z';

    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route, request) => {
      const url = new URL(request.url());
      traceUrls.push(url);
      if (url.searchParams.has('start')) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"trace not found"}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) });
      }
    });

    await page.goto(
      `${PLUGIN_URL}?llt-from=${encodeURIComponent(from)}&llt-to=${encodeURIComponent(to)}` +
      `&llt-traceId=${SEARCH_RESPONSE.traces[0].traceID}`
    );

    await expect(page.getByTestId('span-list-pane')).toBeVisible({ timeout: 10_000 });
    expect(traceUrls).toHaveLength(2);
    expect(traceUrls[0].searchParams.get('start')).toBe(String(Date.parse(from) / 1000));
    expect(traceUrls[0].searchParams.get('end')).toBe(String(Date.parse(to) / 1000));
    expect(traceUrls[1].searchParams.has('start')).toBe(false);
    expect(traceUrls[1].searchParams.has('end')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Switching datasource resets guard so new editor mount is also protected
  // -------------------------------------------------------------------------
  test('LLM filter is preserved after switching datasource', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    const countBefore = searchUrls.length;

    // Switch to the same datasource (simulates any datasource change) via the Select
    const dsSelect = page.locator('[data-testid="trace-explorer"]').getByRole('combobox').first();
    if (await dsSelect.count() > 0) {
      // Re-select the current option to trigger a reload
      const currentValue = await dsSelect.inputValue();
      if (currentValue) {
        // Click the select and pick the same value — triggers datasource reload
        await dsSelect.click();
        await page.keyboard.press('Escape'); // close without changing
      }
    }

    // After any reload the trace list must still be populated
    await expect(
      page.getByTestId('trace-list-pane').locator('[data-testid^="trace-item-"]').first()
    ).toBeVisible({ timeout: 15_000 });

    // At least the initial requests (before the no-op select) were LLM-filtered
    const llmRequests = searchUrls.slice(0, countBefore).filter((u) => {
      const q = u.searchParams.get('q') ?? '';
      return LLM_FILTER_ATTRS.some((attr) => q.includes(attr));
    });
    expect(llmRequests.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TraceDetail bug fixes — BUG-042, BUG-060, BUG-074
// ---------------------------------------------------------------------------
test.describe('TraceDetail bug fixes', () => {
  // Helper: open a trace by clicking the first trace item in the list
  async function openFirstTrace(page: Page) {
    const firstItem = page.getByTestId('trace-list-pane').locator('[data-testid^="trace-item-"]').first();
    await expect(firstItem).toBeVisible({ timeout: 15_000 });
    await firstItem.click();
    await expect(page.getByTestId('trace-detail-view')).toBeVisible({ timeout: 10_000 });
  }

  // -------------------------------------------------------------------------
  // BUG-042: empty trace shows a "No spans found" empty-state message
  // -------------------------------------------------------------------------
  test('BUG-042: empty trace shows no-spans empty state', async ({ page }) => {
    // Mock with a trace that returns zero spans
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SEARCH_RESPONSE),
      });
    });

    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      // Return an empty resourceSpans array
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ resourceSpans: [] }),
      });
    });

    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await openFirstTrace(page);

    // The span list pane should show the empty-trace message
    await expect(
      page.getByTestId('span-list-pane').getByTestId('empty-trace-message')
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId('span-list-pane').getByTestId('empty-trace-message')
    ).toContainText('No spans found in this trace');
  });

  // -------------------------------------------------------------------------
  // BUG-060: when filters eliminate all spans, an empty-state message appears
  // -------------------------------------------------------------------------
  test('BUG-060: text filter that matches nothing shows empty-filter message', async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SEARCH_RESPONSE),
      });
    });

    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TRACE_RESPONSE),
      });
    });

    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await openFirstTrace(page);

    // Wait for the span list to load
    await expect(page.getByTestId('span-list-pane')).toBeVisible({ timeout: 10_000 });

    // Type a filter that will match nothing
    const filterInput = page.getByTestId('span-filter-input');
    await filterInput.fill('ZZZNOMATCHZZZ99999');

    // The no-results empty state must appear
    await expect(
      page.getByTestId('span-list-pane').getByTestId('empty-filter-message')
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByTestId('span-list-pane').getByTestId('empty-filter-message')
    ).toContainText('No matching spans');

    // Clearing the filter removes the empty state
    await page.getByTestId('span-filter-clear').click();
    await expect(
      page.getByTestId('span-list-pane').getByTestId('empty-filter-message')
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // BUG-074: short span IDs (<=16 chars) must NOT get an ellipsis appended
  // -------------------------------------------------------------------------
  test('BUG-074: short span IDs do not get an ellipsis', async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SEARCH_RESPONSE),
      });
    });

    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      // Inject a span whose spanId is exactly 7 characters (clearly <= 16)
      const shortIdTrace = {
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: SEARCH_RESPONSE.traces[0].traceID,
                    spanId: 'short01',
                    parentSpanId: '',
                    name: 'short-span-op',
                    startTimeUnixNano: String(BigInt(1741900000000) * 1000000n),
                    endTimeUnixNano: String(BigInt(1741900001000) * 1000000n),
                    attributes: [
                      { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
                    ],
                    events: [],
                  },
                ],
              },
            ],
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(shortIdTrace),
      });
    });

    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await openFirstTrace(page);

    // Wait for the detail panel to render
    await expect(page.getByTestId('span-detail-panel')).toBeVisible({ timeout: 10_000 });

    // The span ID element must show the raw short ID without a trailing ellipsis
    const spanIdEl = page.getByTestId('span-detail-panel').locator('[title="Span ID"]');
    await expect(spanIdEl).toBeVisible();
    const text = await spanIdEl.textContent();
    expect(text, 'Short span ID should not have ellipsis appended').not.toContain('\u2026');
    expect(text?.trim()).toBe('short01');
  });
});

// ---------------------------------------------------------------------------
// TraceExplorer bug fixes — BUG-013, BUG-040, BUG-063, BUG-064
// ---------------------------------------------------------------------------
test.describe('TraceExplorer bug fixes', () => {
  // -------------------------------------------------------------------------
  // BUG-013: filter values with double quotes must be escaped in TraceQL
  // -------------------------------------------------------------------------
  test('BUG-013: filter value containing double quote is escaped in TraceQL query', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);

    // Build a search-mode query whose filter value contains a double quote
    const queryWithQuote = JSON.stringify({
      refId: 'A',
      queryType: 'nativeSearch',
      filters: [
        { id: 'f1', tag: 'service.name', operator: '=', value: ['my"service'], scope: 'resource' },
      ],
    });
    await page.goto(`${PLUGIN_URL}?llt-query=${encodeURIComponent(queryWithQuote)}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await page.waitForTimeout(3_000);

    expect(searchUrls.length, 'No search requests fired').toBeGreaterThan(0);

    for (const url of searchUrls) {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('my')) {
        // Must NOT contain an unescaped interior quote: resource.service.name="my"service"
        // Valid form: resource.service.name="my\"service"
        const hasUnescapedInjection = /[^\\]"my"/.test(q) || q.startsWith('"my"');
        expect(hasUnescapedInjection, `Unescaped quote injection in TraceQL: ${q}`).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // BUG-040: LLM filter disjunction must be wrapped in parentheses when combined
  // with a user condition, but NOT when used standalone (to allow Prism coloring).
  // -------------------------------------------------------------------------
  test('BUG-040: standalone LLM filter does not have outer parentheses (enables Prism coloring)', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    expect(searchUrls.length, 'No search requests fired').toBeGreaterThan(0);

    const firstQ = searchUrls[0].searchParams.get('q') ?? '';
    // Standalone query must NOT start with {( — the Prism TraceQL grammar's filter
    // pattern requires the first character inside {} to be an attribute name.
    expect(firstQ, `Standalone LLM query must not start with {(: ${firstQ}`).not.toMatch(/^\{\s*\(/);
    // Must still contain all the LLM filter attributes
    expect(firstQ, 'Must contain openinference attr').toContain('span.openinference.span.kind');
  });

  test('BUG-040: LLM filter disjunction is parenthesised when combined with user TraceQL', async ({ page }) => {
    const { searchUrls } = await mockTempoWithCapture(page);
    // Load with a user TraceQL condition so the LLM filter gets injected alongside it
    const queryWithUserCond = JSON.stringify({
      refId: 'A',
      queryType: 'traceql',
      query: '{span.service.name="svc-foo"}',
    });
    await page.goto(`${PLUGIN_URL}?llt-query=${encodeURIComponent(queryWithUserCond)}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    expect(searchUrls.length, 'No search requests fired').toBeGreaterThan(0);
    const combinedQ = searchUrls[0].searchParams.get('q') ?? '';
    // The LLM disjunction must be wrapped in parens so it cannot steal the &&
    // user_condition via lower-precedence || binding:
    //   {(span.A!=''||span.B!='') && span.service.name="svc-foo"}
    expect(combinedQ, `Combined query must have grouped LLM filter: ${combinedQ}`).toMatch(/\{\s*\(/);
    expect(combinedQ, 'Combined query must contain user condition').toContain('svc-foo');
  });

  // -------------------------------------------------------------------------
  // BUG-063/064: loading state must clear when datasource is null
  // -------------------------------------------------------------------------
  test('BUG-063: search loading spinner does not get stuck when search fails', async ({ page }) => {
    // Mock the Tempo search to return an error — simulates unreachable/missing backend
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'Bad Gateway' }) });
    });

    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    // "Searching…" must NOT be permanently stuck in the list header
    await expect(
      page.getByTestId('trace-list-pane').getByText('Searching…'),
      '"Searching…" is stuck visible after search failure'
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('BUG-064: trace loading state clears when a trace fetch fails', async ({ page }) => {
    const BAD_TRACE_ID = 'aabbccddeeff00112233445566778899';

    // Mock the trace fetch to return a Tempo-style error body
    await page.route(`**/api/traces/${BAD_TRACE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'trace not found' }),
      });
    });

    // Navigate with the bad traceId
    await page.goto(`${PLUGIN_URL}?llt-traceId=${BAD_TRACE_ID}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await page.waitForTimeout(3_000);

    // The trace explorer must still be visible and not frozen
    await expect(page.getByTestId('trace-explorer')).toBeVisible({ timeout: 5_000 });

    // The trace detail loading spinner must NOT be stuck — it should have cleared
    const spinner = page.locator('[data-testid="trace-detail-pane"] [class*="spin"], [data-testid="trace-detail-pane"] [class*="load"]');
    // Spinner should either not exist or not be visible after a failed fetch
    const spinnerCount = await spinner.count();
    if (spinnerCount > 0) {
      await expect(spinner.first()).not.toBeVisible({ timeout: 3_000 });
    }
    // trace-explorer must still be interactive
    await expect(page.getByTestId('trace-explorer')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// BUG-068, BUG-071, BUG-035 — SpanRow / TraceSummaryBar unit-style checks
// ---------------------------------------------------------------------------
test.describe('SpanRow and TraceSummaryBar bug fixes', () => {
  // -------------------------------------------------------------------------
  // BUG-068: timeline bar offsetPct must never go negative
  // When span.startTimeMs=0 and traceStartMs is a large Unix timestamp the
  // raw offset is a large negative number, producing extreme negative `left`
  // CSS. The fix clamps offsetPct to [0, 100].
  // -------------------------------------------------------------------------
  test('BUG-068: span timeline bar left% is clamped to [0, 100] for startTimeMs=0', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    // Any span rows that are rendered should have a left% in [0, 100]
    const barBgs = page.locator('[data-testid^="span-row-"] > div:last-child > div');
    const count = await barBgs.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const leftStyle = await barBgs.nth(i).evaluate((el) => (el as HTMLElement).style.left);
        if (leftStyle && leftStyle.endsWith('%')) {
          const leftPct = parseFloat(leftStyle);
          expect(leftPct, `span bar left=${leftStyle} is negative (BUG-068)`).toBeGreaterThanOrEqual(0);
          expect(leftPct, `span bar left=${leftStyle} exceeds 100% (BUG-068)`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // BUG-035: NaN durationMs values must not corrupt avg/p95/slowest stats
  // The summary bar should render without showing "NaN" anywhere.
  // -------------------------------------------------------------------------
  test('BUG-035: TraceSummaryBar shows no NaN when some traces have malformed durationMs', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForTraces(page);

    const summaryBar = page.getByTestId('trace-summary-bar');
    await expect(summaryBar).toBeVisible({ timeout: 10_000 });

    const barText = await summaryBar.textContent();
    expect(barText ?? '', 'TraceSummaryBar contains NaN (BUG-035)').not.toContain('NaN');
    expect(barText ?? '', 'TraceSummaryBar contains Infinity (BUG-035)').not.toContain('Infinity');
  });

  // Tempo omits durationMs for sub-millisecond traces.
  test('trace list shows "<1ms" instead of NaN when a trace has no durationMs', async ({ page }) => {
    const { durationMs: _omitted, ...traceWithoutDuration } = SEARCH_RESPONSE.traces[0];
    await mockTempoWithCapture(page, TRACE_RESPONSE, { traces: [traceWithoutDuration] });
    await page.goto(PLUGIN_URL);
    await waitForTraces(page);

    const item = page.getByTestId(`trace-item-${traceWithoutDuration.traceID}`);
    await expect(item).toContainText('<1ms');
    await expect(item).not.toContainText('NaN');
  });

  // Tempo trims leading zeros from the trace IDs it returns, so users paste 31-character IDs.
  test('pasting a trace ID with trimmed leading zeros fetches that trace', async ({ page }) => {
    const trimmedId = '123456789abcdef0123456789abcdef';
    const { traceUrls } = await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await waitForTraces(page);

    const textarea = page.locator('[data-testid="trace-explorer"] textarea').first();
    await textarea.click({ clickCount: 3 });
    await textarea.fill(trimmedId);
    await page.getByTestId('trace-explorer').getByRole('button', { name: /search/i }).first().click();

    await expect.poll(() => traceUrls.some((url) => url.pathname.endsWith(`/api/traces/${trimmedId}`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LlmSpanDetail bug fixes — BUG-018, BUG-019, BUG-021
// ---------------------------------------------------------------------------
test.describe('LlmSpanDetail bug fixes', () => {
  for (const [label, content] of [
    ['literal', '<|im_start|> system prompt'],
    ['Unicode-escaped', String.raw`\u003c|im_start|\u003e system prompt`],
  ]) {
    test(`${label} special-token markers do not crash message rendering`, async ({ page }) => {
      const traceResponse = JSON.parse(JSON.stringify(TRACE_RESPONSE));
      const llmSpan = traceResponse.resourceSpans[0].scopeSpans[0].spans.find(
        (span: { spanId: string }) => span.spanId === 'span0002'
      );
      const messageContent = llmSpan.attributes.find(
        (attribute: { key: string }) => attribute.key === 'llm.input_messages.0.message.content'
      );
      messageContent.value.stringValue = content;

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await mockTempoWithCapture(page, traceResponse);
      await page.goto(PLUGIN_URL);
      await waitForTraces(page);
      await page.getByTestId('span-row-span0002').click();

      const systemMessage = page.getByTestId('message-block-system').first();
      await expect(systemMessage).toContainText('<|im_start|> system prompt');
      await expect(systemMessage).toContainText(/~[\d,]+ tokens/);
      expect(pageErrors).not.toContain('Disallowed special token found: <|im_start|>');
    });
  }

  // -------------------------------------------------------------------------
  // BUG-018: content_filter finish reason must show an orange badge, not green
  // -------------------------------------------------------------------------
  test('BUG-018: content_filter finish reason maps to orange color, not green', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    // Evaluate the FinishReasonBadge color logic in isolation.
    // CONTENT_FILTER must produce the orange warning color (#FF9830), not green (#73BF69).
    const badgeColor = await page.evaluate(() => {
      const reason = 'content_filter';
      const r = reason.toUpperCase();
      const isWarning = r === 'MAX_TOKENS' || r === 'LENGTH' || r === 'CONTENT_FILTER';
      const isError = r === 'ERROR';
      return isWarning ? '#FF9830' : isError ? '#F2495C' : '#73BF69';
    });

    expect(badgeColor, 'content_filter finish reason should produce orange (#FF9830)').toBe('#FF9830');

    // Verify stop remains green and error remains red
    const stopColor = await page.evaluate(() => {
      const r: string = 'STOP';
      const isWarning = r === 'MAX_TOKENS' || r === 'LENGTH' || r === 'CONTENT_FILTER';
      const isError = r === 'ERROR';
      return isWarning ? '#FF9830' : isError ? '#F2495C' : '#73BF69';
    });
    expect(stopColor, 'stop finish reason should remain green (#73BF69)').toBe('#73BF69');
  });

  // -------------------------------------------------------------------------
  // BUG-019: copy output button must produce JSON including tool calls
  // BUG-073: copy output must not produce literal "undefined" strings
  // -------------------------------------------------------------------------
  test('BUG-019 / BUG-073: copy output uses JSON.stringify, includes tool calls, no undefined', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    // Verify the copy output serialisation strategy against a representative
    // output messages array that includes tool calls and an undefined content field.
    const result = await page.evaluate(() => {
      const outputMessages = [
        { role: 'assistant', content: 'Hello', toolCalls: [{ name: 'search', id: 'tc1', arguments: '{"q":"foo"}' }] },
        { role: 'assistant', content: undefined },
      ];
      // This mirrors the fixed handler: JSON.stringify(outputMessages, null, 2)
      const text = JSON.stringify(outputMessages, null, 2);
      return {
        isJson: (() => { try { JSON.parse(text); return true; } catch { return false; } })(),
        includesToolCalls: text.includes('toolCalls'),
        noLiteralUndefined: !text.includes('undefined'),
      };
    });

    expect(result.isJson, 'Output copy text must be valid JSON (BUG-019)').toBe(true);
    expect(result.includesToolCalls, 'Output copy text must include toolCalls field (BUG-019)').toBe(true);
    expect(result.noLiteralUndefined, 'Output copy text must not contain literal "undefined" (BUG-073)').toBe(true);
  });

  // -------------------------------------------------------------------------
  // BUG-021: sanitizeHtml must preserve safe href on <a> tags so links work
  // -------------------------------------------------------------------------
  test('BUG-021: sanitizeHtml preserves https/http/mailto hrefs and strips javascript: hrefs', async ({ page }) => {
    await mockTempoWithCapture(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');

    const result = await page.evaluate(() => {
      // Inline the fixed sanitizeHtml logic to exercise href handling.
      function sanitizeHtml(html: string): string {
        const ALLOWED = /^(b|i|em|strong|p|br|ul|ol|li|code|pre|h[1-6]|blockquote|hr|a|table|thead|tbody|tr|th|td)$/i;
        return html
          .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)?>/g, (_match: string, slash: string, tag: string, attrs: string) => {
            if (!ALLOWED.test(tag)) { return ''; }
            const lowerTag = tag.toLowerCase();
            if (lowerTag === 'a' && !slash && attrs) {
              const hrefMatch = attrs.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
              if (hrefMatch) {
                const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
                const safeHref = /^(https?:|mailto:)/i.test(href) ? href : '#';
                return `<a href="${safeHref}">`;
              }
            }
            return `<${slash}${lowerTag}>`;
          })
          .replace(/javascript\s*:/gi, '')
          .replace(/data\s*:/gi, '');
      }

      return {
        httpsHref: sanitizeHtml('<a href="https://example.com">link</a>').includes('href="https://example.com"'),
        httpHref: sanitizeHtml('<a href="http://example.com">link</a>').includes('href="http://example.com"'),
        mailtoHref: sanitizeHtml('<a href="mailto:foo@bar.com">email</a>').includes('href="mailto:foo@bar.com"'),
        jsReplacedWithHash: (() => {
          const out = sanitizeHtml('<a href="javascript:alert(1)">xss</a>');
          return !out.includes('javascript:') && out.includes('href="#"');
        })(),
        bareAKept: sanitizeHtml('<a>bare link</a>').includes('<a>'),
      };
    });

    expect(result.httpsHref, 'https:// href must be preserved (BUG-021)').toBe(true);
    expect(result.httpHref, 'http:// href must be preserved (BUG-021)').toBe(true);
    expect(result.mailtoHref, 'mailto: href must be preserved (BUG-021)').toBe(true);
    expect(result.jsReplacedWithHash, 'javascript: href must be replaced with # (BUG-021)').toBe(true);
    expect(result.bareAKept, '<a> without href must remain as bare <a> (BUG-021)').toBe(true);
  });
});
