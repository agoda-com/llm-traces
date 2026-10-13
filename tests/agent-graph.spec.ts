/**
 * Agent graph: the toggles in the span list toolbar, the split between the span tree and the graph, selection that
 * follows from one to the other, keyboard use, the empty state and the geometry of the drawn graph.
 */

import { test, expect, Page, Locator } from '@playwright/test';
import {
  ADK_GRAPH,
  DECLARED_GRAPH,
  GraphFixture,
  NO_AI,
  REPEATED_AGENT,
  TOOL_LOOP,
  TOOL_LOOP_CALLS,
} from './fixtures/agent-graph';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const SPLIT_STORAGE_KEY = 'agoda-llmtraces-app.graphSplitFraction';

async function openTrace(page: Page, trace: GraphFixture, options: { graph?: boolean; theme?: 'light' | 'dark'; split?: number } = {}) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trace.searchResponse) }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trace.traceResponse) }));
  if (options.split !== undefined) {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SPLIT_STORAGE_KEY, String(options.split)]);
  }
  await page.goto(options.theme ? `${PLUGIN_URL}?theme=${options.theme}` : PLUGIN_URL);
  await page.getByTestId(`trace-item-${trace.traceId}`).click();
  await expect(page.getByTestId('span-list-pane')).toBeVisible();
  // The explorer is as tall as the window below the query bar, so the page scrolls to bring it into view.
  await page.getByTestId('trace-detail-view').evaluate((view) => view.scrollIntoView());
  if (options.graph !== false) {
    await page.getByTestId('graph-toggle').click();
    await expect(page.getByTestId('agent-graph')).toBeVisible();
  }
}

const row = (page: Page, spanId: string) => page.getByTestId(`span-row-${spanId}`);
const graphNode = (page: Page, label: string) => page.getByTestId('agent-graph-node').filter({ has: page.getByText(label, { exact: true }) });
const edge = (page: Page, from: string, to: string) => page.locator(`[data-testid="agent-graph-edge"][data-from="${from}"][data-to="${to}"]`);
const box = async (locator: Locator) => (await locator.boundingBox())!;

test.describe('Toggles', () => {
  test.beforeEach(async ({ page }) => openTrace(page, ADK_GRAPH, { graph: false }));

  test('AI only and Graph are standard-size buttons with an icon and a label, before the expand and collapse buttons', async ({ page }) => {
    const aiOnly = page.getByRole('button', { name: 'AI only', exact: true });
    const graph = page.getByRole('button', { name: 'Graph', exact: true });
    for (const button of [aiOnly, graph]) {
      await expect(button).toBeVisible();
      await expect(button.locator('svg'), 'has an icon').toBeVisible();
      expect((await box(button)).height, 'is at least 24px tall').toBeGreaterThanOrEqual(24);
      const style = await button.evaluate((element) => {
        const computed = window.getComputedStyle(element);
        return { fontSize: parseFloat(computed.fontSize), transform: computed.textTransform };
      });
      expect(style.fontSize, 'label is at least 12px').toBeGreaterThanOrEqual(12);
      expect(style.transform, 'label is not upper-cased').toBe('none');
    }
    const expand = await box(page.getByRole('button', { name: 'Expand +1' }));
    expect((await box(aiOnly)).x + (await box(aiOnly)).width).toBeLessThanOrEqual((await box(graph)).x);
    expect((await box(graph)).x + (await box(graph)).width).toBeLessThanOrEqual(expand.x);
    expect(Math.abs((await box(aiOnly)).y - expand.y), 'on the same toolbar row').toBeLessThan(20);
  });

  test('each toggle reports its state with aria-pressed and looks different when on', async ({ page }) => {
    for (const name of ['AI only', 'Graph']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      const off = await button.evaluate((element) => window.getComputedStyle(element).backgroundColor);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const on = await button.evaluate((element) => window.getComputedStyle(element).backgroundColor);
      expect(on, `${name} background changes when on`).not.toBe(off);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('AI only still hides the spans that are not AI spans', async ({ page }) => {
    await expect(row(page, ADK_GRAPH.ids.audit)).toBeVisible();
    await page.getByRole('button', { name: 'AI only', exact: true }).click();
    await expect(row(page, ADK_GRAPH.ids.audit)).toHaveCount(0);
    await expect(row(page, ADK_GRAPH.ids.coordinator)).toBeVisible();
  });
});

test.describe('Split layout', () => {
  test('graph off: the span tree uses the whole height of the list column', async ({ page }) => {
    await openTrace(page, ADK_GRAPH, { graph: false });
    await expect(page.getByTestId('agent-graph')).toHaveCount(0);
    await expect(page.getByTestId('graph-divider')).toHaveCount(0);
    const column = await box(page.getByTestId('span-list-column'));
    const pane = await box(page.getByTestId('span-list-pane'));
    expect(pane.height).toBeCloseTo(column.height, 0);
    expect(pane.width).toBeCloseTo(column.width, 0);
  });

  test('graph on: the tree is on top, the graph below, split in half by default, and the detail panel stays', async ({ page }) => {
    await openTrace(page, ADK_GRAPH);
    const column = await box(page.getByTestId('span-list-column'));
    const pane = await box(page.getByTestId('span-list-pane'));
    const divider = await box(page.getByTestId('graph-divider'));
    const graph = await box(page.getByTestId('agent-graph-section'));
    const detail = await box(page.getByTestId('span-detail-pane'));

    expect(pane.y).toBeCloseTo(column.y, 0);
    expect(divider.y, 'the divider is below the tree').toBeGreaterThanOrEqual(pane.y + pane.height - 1);
    expect(graph.y, 'the graph is below the divider').toBeGreaterThanOrEqual(divider.y + divider.height - 1);
    expect(graph.y + graph.height).toBeCloseTo(column.y + column.height, 0);
    expect(pane.height / (pane.height + graph.height), 'half and half').toBeGreaterThan(0.47);
    expect(pane.height / (pane.height + graph.height), 'half and half').toBeLessThan(0.53);
    expect(detail.x, 'the detail panel is to the right').toBeGreaterThanOrEqual(column.x + column.width - 1);
    await expect(page.getByTestId('span-detail-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the list column is widened for the graph and gets its width back when the graph is hidden', async ({ page }) => {
    // At 1440px the trace list and the detail panel leave the list column no room to grow.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openTrace(page, ADK_GRAPH, { graph: false });
    const before = (await box(page.getByTestId('span-list-column'))).width;
    expect(before, 'the default width is narrower than the graph needs').toBeLessThan(600);
    await page.getByTestId('graph-toggle').click();
    expect((await box(page.getByTestId('span-list-column'))).width).toBeGreaterThanOrEqual(639);
    await page.getByTestId('graph-toggle').click();
    expect((await box(page.getByTestId('span-list-column'))).width).toBeCloseTo(before, 0);
  });

  test('a column that is already wide is left alone', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openTrace(page, ADK_GRAPH, { graph: false });
    const handle = await box(page.getByTestId('resize-handle-span-list'));
    await page.mouse.move(handle.x + 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(handle.x + 2 + 300, handle.y + 200, { steps: 5 });
    await page.mouse.up();
    const wide = (await box(page.getByTestId('span-list-column'))).width;
    expect(wide).toBeGreaterThan(700);
    await page.getByTestId('graph-toggle').click();
    expect((await box(page.getByTestId('span-list-column'))).width).toBeCloseTo(wide, 0);
  });

  test('turning the graph off gives the tree its full height back', async ({ page }) => {
    await openTrace(page, ADK_GRAPH);
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(page.getByTestId('agent-graph')).toHaveCount(0);
    const column = await box(page.getByTestId('span-list-column'));
    expect((await box(page.getByTestId('span-list-pane'))).height).toBeCloseTo(column.height, 0);
  });

  test('dragging the divider moves the split, keeps both parts usable and is remembered', async ({ page }) => {
    await openTrace(page, ADK_GRAPH);
    const column = await box(page.getByTestId('span-list-column'));
    const divider = page.getByTestId('graph-divider');
    const start = await box(divider);
    const x = start.x + start.width / 2;

    await page.mouse.move(x, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, column.y + column.height * 0.7, { steps: 5 });
    await page.mouse.up();
    let fraction = (await box(page.getByTestId('span-list-pane'))).height / (column.height - start.height);
    expect(fraction, 'the tree grew to about 70%').toBeGreaterThan(0.66);
    expect(fraction).toBeLessThan(0.74);

    const moved = await box(divider);
    await page.mouse.move(x, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, column.y + column.height - 2, { steps: 5 });
    await page.mouse.up();
    expect((await box(page.getByTestId('agent-graph-section'))).height, 'the graph keeps a usable height').toBeGreaterThanOrEqual(100);

    const lowered = await box(divider);
    await page.mouse.move(x, lowered.y + lowered.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, column.y + 2, { steps: 5 });
    await page.mouse.up();
    expect((await box(page.getByTestId('span-list-pane'))).height, 'the tree keeps a usable height').toBeGreaterThanOrEqual(100);

    const high = await box(divider);
    await page.mouse.move(x, high.y + high.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, column.y + column.height * 0.3, { steps: 5 });
    await page.mouse.up();
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), SPLIT_STORAGE_KEY);
    expect(Number(stored), 'the split is stored').toBeGreaterThan(0.26);
    expect(Number(stored)).toBeLessThan(0.34);

    await page.goto(PLUGIN_URL);
    await page.getByTestId(`trace-item-${ADK_GRAPH.traceId}`).click();
    await page.getByTestId('trace-detail-view').evaluate((view) => view.scrollIntoView());
    await page.getByTestId('graph-toggle').click();
    fraction = (await box(page.getByTestId('span-list-pane'))).height / (column.height - start.height);
    expect(fraction, 'the split survives a reload').toBeGreaterThan(0.26);
    expect(fraction).toBeLessThan(0.34);
  });

  test('the divider can be moved with the arrow keys', async ({ page }) => {
    await openTrace(page, ADK_GRAPH);
    const divider = page.getByTestId('graph-divider');
    await expect(divider).toHaveAttribute('role', 'separator');
    await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    const before = (await box(page.getByTestId('span-list-pane'))).height;
    await divider.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await box(page.getByTestId('span-list-pane'))).height).toBeGreaterThan(before + 20);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect((await box(page.getByTestId('span-list-pane'))).height).toBeLessThan(before - 20);
  });

  test('a stored split outside the range is clamped and still leaves both parts usable', async ({ page }) => {
    await openTrace(page, ADK_GRAPH, { split: 7 });
    const pane = (await box(page.getByTestId('span-list-pane'))).height;
    const graph = (await box(page.getByTestId('agent-graph-section'))).height;
    expect(graph, 'the graph is not squeezed out').toBeGreaterThanOrEqual(100);
    expect(pane, 'the tree is not squeezed out').toBeGreaterThanOrEqual(100);
  });
});

test.describe('Selecting from the graph', () => {
  test.beforeEach(async ({ page }) => openTrace(page, ADK_GRAPH));

  test('a node click selects its first span, shows it in the detail panel and scrolls the tree to it', async ({ page }) => {
    await page.getByTestId('span-list-pane').evaluate((pane) => { pane.scrollTop = 0; });
    await graphNode(page, 'format_summary').click();
    await expect(row(page, ADK_GRAPH.ids.summary)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('span-header-raw-name')).toContainText('execute_tool format_summary');
    await expect.poll(async () => {
      const pane = await box(page.getByTestId('span-list-pane'));
      const selected = await box(row(page, ADK_GRAPH.ids.summary));
      return selected.y >= pane.y && selected.y + selected.height <= pane.y + pane.height + 1;
    }, { message: 'the tree scrolls the selected span into view' }).toBe(true);
  });

  test('a node click opens the collapsed spans above the span it selects', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse all spans' }).click();
    await expect(row(page, ADK_GRAPH.ids.roomLookup)).toHaveCount(0);
    await graphNode(page, 'lookup_rooms').click();
    await expect(row(page, ADK_GRAPH.ids.roomLookup)).toHaveAttribute('aria-current', 'true');
  });

  test('clicking the selected node again steps to its next span and wraps around', async ({ page }) => {
    const fareAgent = graphNode(page, 'fare_agent');
    const fareRows = page.locator('[data-testid^="span-row-"]').filter({ has: page.getByTestId('span-agent-label').getByText('fare_agent', { exact: true }) });
    await expect(fareRows).toHaveCount(2);

    await expect(fareAgent.getByTestId('agent-graph-node-position'), 'no position while the node is not selected').toHaveCount(0);
    await fareAgent.click();
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveText('1/2');
    await expect(fareRows.nth(0)).toHaveAttribute('aria-current', 'true');

    await fareAgent.click();
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveText('2/2');
    await expect(fareRows.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(fareRows.nth(0)).not.toHaveAttribute('aria-current', 'true');

    await fareAgent.click();
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveText('1/2');
    await expect(fareRows.nth(0)).toHaveAttribute('aria-current', 'true');
  });

  test('a node with one call shows no position', async ({ page }) => {
    const node = graphNode(page, 'room_agent');
    await node.click();
    await expect(node).toHaveAttribute('aria-pressed', 'true');
    await expect(node.getByTestId('agent-graph-node-position')).toHaveCount(0);
  });

  test('clicking another node starts at its first span', async ({ page }) => {
    const fareAgent = graphNode(page, 'fare_agent');
    await fareAgent.click();
    await fareAgent.click();
    await graphNode(page, 'lookup_fares').click();
    await expect(graphNode(page, 'lookup_fares').getByTestId('agent-graph-node-position')).toHaveText('1/3');
    await expect(row(page, ADK_GRAPH.ids.fareLookup1)).toHaveAttribute('aria-current', 'true');
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveCount(0);
  });

  test('a span the text filter hides is still shown after a node click', async ({ page }) => {
    await page.getByTestId('span-filter-input').fill('lookup_rooms');
    await graphNode(page, 'format_summary').click();
    await expect(row(page, ADK_GRAPH.ids.summary)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('span-header-raw-name')).toContainText('format_summary');
  });
});

test.describe('Selecting from the tree', () => {
  test.beforeEach(async ({ page }) => openTrace(page, ADK_GRAPH));

  test('selecting a span highlights its node and the edge into it', async ({ page }) => {
    await row(page, ADK_GRAPH.ids.roomLookup).click();
    await expect(graphNode(page, 'lookup_rooms')).toHaveAttribute('aria-pressed', 'true');
    await expect(graphNode(page, 'lookup_fares')).toHaveAttribute('aria-pressed', 'false');
    await expect(edge(page, 'agent:room_agent', 'tool:lookup_rooms')).toHaveAttribute('data-active', 'true');
    await expect(edge(page, 'agent:fare_agent', 'tool:lookup_fares')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('[data-testid="agent-graph-edge"][data-active="true"]')).toHaveCount(1);
  });

  test('selecting an agent span highlights the edge into its node but not the edges out of it', async ({ page }) => {
    await row(page, ADK_GRAPH.ids.coordinator).click();
    await expect(edge(page, '__start__', 'agent:trip_coordinator')).toHaveAttribute('data-active', 'true');
    await expect(edge(page, 'agent:trip_coordinator', 'agent:fare_agent')).toHaveAttribute('data-active', 'false');
    await expect(edge(page, 'agent:trip_coordinator', 'tool:format_summary')).toHaveAttribute('data-active', 'false');
  });

  test('the highlight follows the keyboard selection in the tree', async ({ page }) => {
    await row(page, ADK_GRAPH.ids.coordinator).click();
    await expect(graphNode(page, 'trip_coordinator')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('j');
    await expect(graphNode(page, 'trip_coordinator')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('k');
    await expect(graphNode(page, 'trip_coordinator')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a span nested in a call highlights the node of that call', async ({ page }) => {
    // The nested generate span belongs to the call_llm span above it.
    const generateRow = page.locator('[data-testid^="span-row-"]').filter({ has: page.getByTestId('span-operation-name').getByText('generate', { exact: true }) }).first();
    await generateRow.click();
    await expect(page.locator('[data-testid="agent-graph-node"][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="agent-graph-node"][aria-pressed="true"]')).toContainText('model-');
  });

  test('selecting a span outside the graph clears the highlight', async ({ page }) => {
    await row(page, ADK_GRAPH.ids.roomLookup).click();
    await expect(page.locator('[data-testid="agent-graph-node"][aria-pressed="true"]')).toHaveCount(1);
    await row(page, ADK_GRAPH.ids.audit).click();
    await expect(row(page, ADK_GRAPH.ids.audit)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-testid="agent-graph-node"][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="agent-graph-edge"][data-active="true"]')).toHaveCount(0);
  });
});

test.describe('Keyboard and accessibility', () => {
  test.beforeEach(async ({ page }) => openTrace(page, ADK_GRAPH));

  test('every node is a button in the tab order with a name, a kind and a call count', async ({ page }) => {
    const nodes = page.getByTestId('agent-graph-node');
    expect(await nodes.count()).toBeGreaterThanOrEqual(8);
    for (const node of await nodes.all()) {
      await expect(node).toHaveAttribute('role', 'button');
      await expect(node).toHaveAttribute('tabindex', '0');
    }
    await expect(graphNode(page, 'fare_agent')).toHaveAttribute('aria-label', 'fare_agent, Agent, 2 calls');
    await expect(graphNode(page, 'lookup_fares')).toHaveAttribute('aria-label', 'lookup_fares, Tool, 3 calls, 1 failed');
    await expect(graphNode(page, 'room_agent')).toHaveAttribute('aria-label', 'room_agent, Agent, 1 call');
    await expect(graphNode(page, 'Guardrails')).toHaveAttribute('aria-label', 'Guardrails, Guardrail, 3 calls');
  });

  test('Tab moves from one node to the next and the focused node has a visible outline', async ({ page }) => {
    const nodes = page.getByTestId('agent-graph-node');
    await nodes.nth(0).focus();
    await page.keyboard.press('Tab');
    await expect(nodes.nth(1)).toBeFocused();
    const outline = await nodes.nth(1).evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return { style: computed.outlineStyle, width: parseFloat(computed.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test('Enter selects a node and Space steps to its next span', async ({ page }) => {
    const fareAgent = graphNode(page, 'fare_agent');
    await fareAgent.focus();
    await page.keyboard.press('Enter');
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveText('1/2');
    await expect(fareAgent).toBeFocused();
    await page.keyboard.press('Space');
    await expect(fareAgent.getByTestId('agent-graph-node-position')).toHaveText('2/2');
    await expect(page.getByTestId('span-header-agent')).toHaveText('fare_agent');
  });

  test('the selected node says so in its name', async ({ page }) => {
    const fareAgent = graphNode(page, 'fare_agent');
    await fareAgent.click();
    await expect(fareAgent).toHaveAttribute('aria-label', 'fare_agent, Agent, 2 calls, call 1 of 2 selected');
  });
});

test.describe('Graph content', () => {
  test('ADK-like trace: agents used as tools take the tool place, guardrails group, nested same-model spans count once', async ({ page }) => {
    await openTrace(page, ADK_GRAPH);
    const ids = await page.getByTestId('agent-graph-node').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.nodeId).sort());
    expect(ids).toEqual([
      'agent:fare_agent', 'agent:room_agent', 'agent:trip_coordinator', 'guardrails:agent:trip_coordinator',
      'llm:fare_agent:model-beta', 'llm:room_agent:model-beta', 'llm:trip_coordinator:model-alpha',
      'tool:format_summary', 'tool:lookup_fares', 'tool:lookup_rooms',
    ].sort());
    await expect(graphNode(page, 'model-alpha')).toContainText('×2');
    await expect(graphNode(page, 'fare_agent')).toContainText('×2');
    await expect(edge(page, 'agent:trip_coordinator', 'agent:fare_agent')).toContainText('×2');
    await expect(edge(page, 'agent:fare_agent', 'tool:lookup_fares')).toContainText('×3');
    await expect(page.getByTestId('agent-graph-start')).toBeVisible();
  });

  test('declared graph parents: an edge follows graph.node.parent_id, not the nesting', async ({ page }) => {
    await openTrace(page, DECLARED_GRAPH);
    await expect(edge(page, 'steward', 'billing_desk')).toHaveCount(1);
    await expect(edge(page, 'intake', 'billing_desk')).toHaveCount(0);
    await expect(edge(page, 'billing_desk', 'tool:refund_lookup')).toHaveCount(1);
    await graphNode(page, 'Billing desk').click();
    await expect(page.getByTestId('span-header-handoff'), 'the detail header names the declared parent too').toHaveText('handed off from steward');
  });

  test('a long tool loop shows its call counts and steps through every call', async ({ page }) => {
    await openTrace(page, TOOL_LOOP);
    const fetchPage = graphNode(page, 'fetch_page');
    await expect(fetchPage).toContainText(`×${TOOL_LOOP_CALLS}`);
    await expect(edge(page, 'agent:researcher', 'tool:fetch_page')).toContainText(`×${TOOL_LOOP_CALLS}`);
    await expect(fetchPage).toHaveAttribute('aria-label', `fetch_page, Tool, ${TOOL_LOOP_CALLS} calls, 1 failed`);
    for (let i = 1; i <= TOOL_LOOP_CALLS; i++) {
      await fetchPage.click();
      await expect(fetchPage.getByTestId('agent-graph-node-position')).toHaveText(`${i}/${TOOL_LOOP_CALLS}`);
      await expect(page.getByTestId('span-attrs-table')).toContainText(`fetch-${i}`);
    }
    await fetchPage.click();
    await expect(fetchPage.getByTestId('agent-graph-node-position'), 'wraps around').toHaveText(`1/${TOOL_LOOP_CALLS}`);
  });

  test('a repeated agent is one node, and model calls outside any agent hang off Start', async ({ page }) => {
    await openTrace(page, REPEATED_AGENT);
    await expect(graphNode(page, 'joke_writer')).toContainText('×3');
    await expect(graphNode(page, 'model-gamma')).toContainText('×2');
    await expect(edge(page, '__start__', 'llm::model-gamma')).toHaveCount(1);
    await expect(edge(page, '__start__', 'agent:joke_writer')).toHaveCount(1);
    await expect(edge(page, 'agent:joke_writer', 'llm:joke_writer:model-alpha')).toContainText('×6');
    await row(page, REPEATED_AGENT.ids.plannerCall).click();
    await expect(graphNode(page, 'model-gamma')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a model call without a model name is named after its span and says so', async ({ page }) => {
    await openTrace(page, REPEATED_AGENT);
    const node = graphNode(page, 'generation');
    await expect(node).toHaveAttribute('aria-label', 'generation, LLM, 1 call, model name not recorded');
    await expect(node).toHaveAttribute('title', /no model name/);
    expect(await node.getByText('generation', { exact: true }).evaluate((element) => window.getComputedStyle(element).fontStyle)).toBe('italic');
    await expect(graphNode(page, 'model-gamma').getByText('model-gamma', { exact: true })).not.toHaveCSS('font-style', 'italic');
  });

  test('a trace without AI spans shows a message instead of an empty canvas', async ({ page }) => {
    await openTrace(page, NO_AI);
    await expect(page.getByTestId('agent-graph-empty')).toBeVisible();
    await expect(page.getByTestId('agent-graph-empty')).toContainText('no AI spans');
    await expect(page.getByTestId('agent-graph-node')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Call graph' })).toHaveCount(0);
  });
});

const FIXTURES: Array<[string, GraphFixture]> = [
  ['ADK-like', ADK_GRAPH],
  ['declared parents', DECLARED_GRAPH],
  ['tool loop', TOOL_LOOP],
  ['repeated agent', REPEATED_AGENT],
];

for (const width of [1440, 800]) {
  test.describe(`Geometry at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const [name, trace] of FIXTURES) {
      test(`${name}: nodes do not overlap, labels stay inside their nodes and the graph stays in its pane`, async ({ page }) => {
        await openTrace(page, trace);
        await page.getByTestId('agent-graph').evaluate((root) => { root.scrollTo(0, 0); });
        const geometry = await page.getByTestId('agent-graph').evaluate((root) => {
          const rect = (element: Element) => element.getBoundingClientRect();
          const nodes = Array.from(root.querySelectorAll('[data-testid="agent-graph-node"]')).map((node) => {
            const nodeRect = rect(node);
            const labels = Array.from(node.querySelectorAll('[data-graph-label]')).map((label) => ({
              name: (label as HTMLElement).dataset.graphLabel!,
              clipped: label.scrollWidth > label.clientWidth + 1,
              inside: rect(label).left >= nodeRect.left - 0.5 && rect(label).right <= nodeRect.right + 0.5
                && rect(label).top >= nodeRect.top - 0.5 && rect(label).bottom <= nodeRect.bottom + 0.5,
            }));
            return { id: (node as HTMLElement).dataset.nodeId!, left: nodeRect.left, right: nodeRect.right, top: nodeRect.top, bottom: nodeRect.bottom, labels };
          });
          const svg = rect(root.querySelector('svg')!);
          return { nodes, svg: { left: svg.left, right: svg.right, top: svg.top, bottom: svg.bottom }, root: rect(root).toJSON() };
        });
        expect(geometry.nodes.length).toBeGreaterThan(3);
        for (const [i, a] of geometry.nodes.entries()) {
          for (const b of geometry.nodes.slice(i + 1)) {
            const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false);
          }
          for (const label of a.labels) {
            expect(label.inside, `${label.name} is inside ${a.id}`).toBe(true);
            expect(label.clipped, `${label.name} of ${a.id} is cut off`).toBe(false);
          }
        }

        const column = await box(page.getByTestId('span-list-column'));
        const section = await box(page.getByTestId('agent-graph-section'));
        expect(section.x).toBeGreaterThanOrEqual(column.x - 0.5);
        expect(section.x + section.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
        expect(section.y + section.height).toBeLessThanOrEqual(column.y + column.height + 0.5);
        expect(geometry.svg.left).toBeGreaterThanOrEqual(section.x - 0.5);
        expect(geometry.svg.top).toBeGreaterThanOrEqual(section.y - 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page does not scroll sideways').toBe(true);

        const fits = geometry.svg.right <= section.x + section.width + 0.5 && geometry.svg.bottom <= section.y + section.height + 0.5;
        const scrolls = await page.getByTestId('agent-graph').evaluate((root) => root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight);
        expect(fits || scrolls, 'the drawing fits in the pane or scrolls inside it').toBe(true);
      });
    }
  });
}
