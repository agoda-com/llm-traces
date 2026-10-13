/**
 * Large trace behaviour: render cost and list virtualization on a 30,000-span trace.
 */

import { test, expect, Page } from '@playwright/test';
import { LARGE_TRACE_ID, makeLargeTrace, spanIdFor } from './fixtures/large-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

async function mockTrace(page: Page, fixture: { searchResponse: unknown; traceResponse: unknown }) {
  const searchBody = JSON.stringify(fixture.searchResponse);
  const traceBody = JSON.stringify(fixture.traceResponse);
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: searchBody }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: traceBody }));
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test.describe('30,000-span trace', () => {
  test.setTimeout(300_000);

  test('opens and reports render cost', async ({ page }) => {
    const fixture = makeLargeTrace(30_000, 200);
    await mockTrace(page, fixture);

    const timings: number[] = [];
    const domNodes: number[] = [];
    const rowNodes: number[] = [];
    for (let run = 0; run < 3; run++) {
      await page.goto(PLUGIN_URL);
      await page.getByTestId('trace-explorer').waitFor();
      const item = page.getByTestId(`trace-item-${LARGE_TRACE_ID}`);
      await expect(item).toBeVisible();

      const started = Date.now();
      await item.click();
      await expect(page.getByTestId('llm-span-detail')).toBeVisible({ timeout: 240_000 });
      timings.push(Date.now() - started);

      await expect(page.getByTestId('span-list-pane')).toBeVisible();
      domNodes.push(await page.getByTestId('span-list-pane').evaluate((pane) => pane.getElementsByTagName('*').length));
      rowNodes.push(await page.locator('[data-testid^="span-row-"]').count());
    }

    console.log(`PERF spans=30000 clickToDetailMs=${JSON.stringify(timings)} median=${median(timings)} ` +
      `spanListDomNodes=${JSON.stringify(domNodes)} rowsInDom=${JSON.stringify(rowNodes)}`);
  });
});

test.describe('30,000-span trace list', () => {
  test.setTimeout(120_000);

  async function openLargeTrace(page: Page, llmIndexes?: number[]) {
    await mockTrace(page, makeLargeTrace(30_000, 200, llmIndexes));
    await page.goto(PLUGIN_URL);
    await page.getByTestId(`trace-item-${LARGE_TRACE_ID}`).click();
    // Playwright scrolls the item into view before it clicks, and Grafana 12.0 sometimes lays out the page so that the
    // item starts below the fold. The window position after the click is the baseline for what the plugin does next.
    const windowScrollY = await page.evaluate(() => window.scrollY);
    await expect(page.getByTestId('llm-span-detail')).toBeVisible({ timeout: 60_000 });
    return windowScrollY;
  }

  const renderedIndexes = (page: Page) => page.locator('[data-testid^="span-row-"]').evaluateAll((rows) =>
    rows.map((r) => parseInt((r as HTMLElement).dataset.testid!.replace('span-row-', '').slice(2), 16)));

  test('keeps only the rows near the viewport in the DOM', async ({ page }) => {
    await openLargeTrace(page);
    const indexes = await renderedIndexes(page);
    expect(indexes.length).toBeLessThan(200);
    expect(await page.getByTestId('span-list-pane').evaluate((pane) => pane.getElementsByTagName('*').length)).toBeLessThan(6000);
    expect(await page.getByTestId('span-list-pane').evaluate((pane) => pane.scrollHeight)).toBeGreaterThan(30_000 * 36);

    await page.getByTestId('span-list-pane').evaluate((pane) => { pane.scrollTop = 600_000; });
    await expect.poll(async () => Math.min(...(await renderedIndexes(page)))).toBeGreaterThan(16_000);
    const scrolled = await renderedIndexes(page);
    expect(scrolled.length).toBeLessThan(200);
    expect(Math.max(...scrolled)).toBeLessThan(17_500);
  });

  test('scrolls an auto-selected span far down the list into view without moving the window', async ({ page }) => {
    const windowScrollY = await openLargeTrace(page, [12_000]);
    const target = page.getByTestId(`span-row-${spanIdFor('lg', 12_000)}`);
    await expect(target).toBeVisible();
    const pane = (await page.getByTestId('span-list-pane').boundingBox())!;
    const box = (await target.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(pane.y);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
    expect(await page.evaluate(() => window.scrollY), 'the plugin leaves the window where the click left it').toBe(windowScrollY);
  });

  test('j and k select rows that were not rendered and scroll them into view', async ({ page }) => {
    await openLargeTrace(page, [12_000]);
    await expect(page.getByTestId(`span-row-${spanIdFor('lg', 12_000)}`)).toBeVisible();
    for (let i = 0; i < 60; i++) { await page.keyboard.press('j'); }
    await expect(page.getByTestId('span-detail-pane')).toContainText('operation 12060');
    const target = page.getByTestId(`span-row-${spanIdFor('lg', 12_060)}`);
    await expect(target).toBeVisible();
    await expect.poll(async () => {
      const pane = (await page.getByTestId('span-list-pane').boundingBox())!;
      const box = (await target.boundingBox())!;
      return box.y >= pane.y && box.y + box.height <= pane.y + pane.height + 1;
    }).toBe(true);

    for (let i = 0; i < 60; i++) { await page.keyboard.press('k'); }
    await expect(page.getByTestId('span-detail-pane')).toContainText('llm call 12000');
    await expect(page.getByTestId(`span-row-${spanIdFor('lg', 12_000)}`)).toBeVisible();
  });

  test.describe('with the agent graph', () => {
    const inPane = async (page: Page, spanId: string) => {
      const pane = (await page.getByTestId('span-list-pane').boundingBox())!;
      const box = await page.getByTestId(`span-row-${spanId}`).boundingBox();
      return !!box && box.y >= pane.y && box.y + box.height <= pane.y + pane.height + 1;
    };

    test('draws only the nodes near the visible area and keeps only the rows near the viewport in the DOM', async ({ page }) => {
      await openLargeTrace(page);
      const rowsBefore = await page.locator('[data-testid^="span-row-"]').count();
      const started = Date.now();
      await page.getByTestId('graph-toggle').click();
      await expect(page.getByTestId('agent-graph-node').first()).toBeVisible({ timeout: 60_000 });
      const toggleMs = Date.now() - started;

      // A node near the left edge: the tool node whose span the detail panel does not show yet.
      const node = page.getByTestId('agent-graph-node').filter({ hasText: /^operation \d+/ }).first();
      const label = (await node.getAttribute('aria-label'))!.split(',')[0];
      const clicked = Date.now();
      await node.click();
      await expect(page.getByTestId('span-header-raw-name')).toContainText(label);
      const nodeClickToDetailMs = Date.now() - clicked;

      const graphNodes = await page.getByTestId('agent-graph-node').count();
      const paneNodes = await page.getByTestId('span-list-pane').evaluate((pane) => pane.getElementsByTagName('*').length);
      const columnNodes = await page.getByTestId('span-list-column').evaluate((column) => column.getElementsByTagName('*').length);
      console.log(`PERF graph on 30000 spans: graphToggleToFirstNodeMs=${toggleMs} nodeClickToDetailMs=${nodeClickToDetailMs} nodesInDom=${graphNodes} ` +
        `spanListDomNodes=${paneNodes} listColumnDomNodes=${columnNodes} rowsBefore=${rowsBefore}`);
      expect(graphNodes, 'a graph of thousands of nodes draws a few hundred at most').toBeLessThan(400);
      expect(await page.locator('[data-testid^="span-row-"]').count()).toBeLessThan(200);
      expect(paneNodes).toBeLessThan(6000);
      expect(await page.getByTestId('span-list-pane').evaluate((pane) => pane.scrollHeight)).toBeGreaterThan(30_000 * 36);
    });

    test('scrolling the graph draws the nodes that come into view', async ({ page }) => {
      await openLargeTrace(page);
      await page.getByTestId('graph-toggle').click();
      await expect(page.getByTestId('agent-graph-node').first()).toBeVisible({ timeout: 60_000 });
      const idsBefore = await page.getByTestId('agent-graph-node').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.nodeId));
      await page.getByTestId('agent-graph').evaluate((graph) => { graph.scrollLeft = graph.scrollWidth / 2; });
      await expect.poll(async () => {
        const ids = await page.getByTestId('agent-graph-node').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.nodeId));
        return ids.length > 0 && ids.every((id) => !idsBefore.includes(id));
      }).toBe(true);
    });

    test('the list shows the selected row after the graph takes half of its height, and the keys still move the selection', async ({ page }) => {
      await openLargeTrace(page, [12_000]);
      const target = spanIdFor('lg', 12_000);
      await expect.poll(() => inPane(page, target)).toBe(true);
      await page.getByTestId('graph-toggle').click();
      await expect(page.getByTestId('agent-graph')).toBeVisible();
      await expect.poll(() => inPane(page, target), { message: 'the selected row is still in view' }).toBe(true);
      expect(await page.locator('[data-testid^="span-row-"]').count()).toBeLessThan(200);

      for (let i = 0; i < 40; i++) { await page.keyboard.press('j'); }
      await expect(page.getByTestId('span-detail-pane')).toContainText('operation 12040');
      await expect.poll(() => inPane(page, spanIdFor('lg', 12_040))).toBe(true);

      await page.getByTestId('graph-toggle').click();
      await expect(page.getByTestId('agent-graph')).toHaveCount(0);
      await expect.poll(() => inPane(page, spanIdFor('lg', 12_040))).toBe(true);
    });
  });

  test('clicking a row selects it', async ({ page }) => {
    await openLargeTrace(page);
    const first = page.locator('[data-testid^="span-row-"]').nth(8);
    const name = (await first.getByTitle(/^operation \d+$/).textContent())!;
    await first.click();
    await expect(page.getByTestId('span-detail-pane')).toContainText(name);
  });

  test('collapse all leaves the root and expand all brings the rows back', async ({ page }) => {
    await openLargeTrace(page);
    await page.keyboard.press(']');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(1);
    expect(await page.getByTestId('span-list-pane').evaluate((pane) => pane.scrollHeight)).toBeLessThan(2000);
    await page.keyboard.press('[');
    await expect.poll(() => page.locator('[data-testid^="span-row-"]').count()).toBeGreaterThan(30);
    expect(await page.getByTestId('span-list-pane').evaluate((pane) => pane.scrollHeight)).toBeGreaterThan(30_000 * 36);
  });
});
