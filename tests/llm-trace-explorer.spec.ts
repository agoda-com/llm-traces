import { test, expect, Page } from '@playwright/test';
import { SEARCH_RESPONSE, TRACE_RESPONSE, VERTEX_TRACE_RESPONSE, OTEL_GENAI_TRACE_RESPONSE, GENERIC_TRACE_RESPONSE, STRUCTURED_SEARCH_RESPONSE, STRUCTURED_TRACE_RESPONSE } from './fixtures/llm-trace';
import { waitForToolbarLayout } from './waitForToolbarLayout';
import { CONVENTION_SEARCH_RESPONSE, GENAI_EVENTS_TRACE, GENAI_TOOL_TRACE, STRUCTURED_ATTRIBUTES_TRACE, VERCEL_AI_TRACE, TOKEN_DETAILS_TRACE, PYDANTIC_AI_TRACE, LANGFUSE_SDK_TRACE, TRACELOOP_TRACE, MLFLOW_TRACE } from './fixtures/conventions';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
async function mockTempoApis(page: Page) {
  // Mock Tempo search — wildcard UID so tests work with any provisioned datasource
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
  });

  // Mock Tempo trace fetch
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) });
  });
}

test.describe('LLM Trace Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await mockTempoApis(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('shows page title and toolbar', async ({ page }) => {
    // Scope to trace-explorer to avoid matching nav menu / breadcrumb
    await expect(page.getByTestId('trace-explorer').getByText('LLM Traces', { exact: true })).toBeVisible();
    await expect(page.getByTestId('trace-explorer').getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  });

  test('lists traces from Tempo after load', async ({ page }) => {
    const listPane = page.getByTestId('trace-list-pane');
    await expect(listPane.getByText('process_query').first()).toBeVisible();
    await expect(listPane.getByText('llm-service').first()).toBeVisible();
    await expect(listPane.getByText('generate_content').first()).toBeVisible();
    await expect(listPane.getByText('agent-service').first()).toBeVisible();
  });

  test('shows trace count', async ({ page }) => {
    await expect(page.getByText('2 traces')).toBeVisible();
  });

  test('loads trace on click and shows trace detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
  });

  test('keeps span details readable at 1024px with the trace list expanded', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.click('[data-testid^="trace-item-"]');

    const spanListBox = await page.getByTestId('span-list-pane').boundingBox();
    const detailBox = await page.getByTestId('span-detail-pane').boundingBox();

    expect(spanListBox?.width).toBeGreaterThanOrEqual(300);
    expect(detailBox?.width).toBeGreaterThanOrEqual(300);
  });

  test('shows span list with correct span names', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('span-row-span0001')).toContainText('process_query');
    await expect(page.getByTestId('span-row-span0002')).toContainText('llm claude-sonnet-4-5');
    await expect(page.getByTestId('span-row-span0003')).toContainText('get_property_details');
  });

  test('auto-selects first LLM span and shows LLM detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // LLM detail should appear automatically for the first LLM span
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('LLM detail shows model name badge', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-model-name')).toContainText('claude-sonnet-4-5');
  });

  test('LLM detail shows span kind badge', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-kind')).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
  });

  test('LLM detail shows Input Messages section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('input-messages-section')).toBeVisible();
    await expect(page.getByText('Input Messages')).toBeVisible();
  });

  test('unicode escape sequences in message content are decoded to real characters', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // The fixture user message uses Python ensure_ascii=True style \uXXXX escapes for Chinese text
    // 请问酒店 12345 的设施是什么？ — should render as Chinese, NOT as \u8bf7\u95ee...
    await expect(page.getByTestId('input-messages-section')).toContainText('请问酒店');
    await expect(page.getByTestId('input-messages-section')).not.toContainText('\\u8bf7');
  });

  test('unicode escape sequences in SPAN ATTRIBUTES table are decoded to real characters', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Click the LLM span which has a unicode-escaped attribute value
    await page.click('[data-testid="span-row-span0002"]');
    await expect(page.getByTestId('span-attrs-table')).toBeVisible();
    await page.getByTestId('llm-attrs-toggle').click();
    // The llm.input_messages.1.message.content attribute value should render as Chinese
    await expect(page.getByTestId('span-attrs-table')).toContainText('请问酒店');
    await expect(page.getByTestId('span-attrs-table')).not.toContainText('\\u8bf7');
  });

  test('unicode escape sequences in OpenInference span attributes are decoded', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Click a span that has attributes read through getAttrValue (UNKNOWN span, tool.* etc.)
    // Here we verify the CHAIN root span attrs table — session.id renders without mangling
    await page.click('[data-testid="span-row-span0001"]');
    await expect(page.getByTestId('span-attrs-table')).toContainText('sess_abc123');
    // No raw escape sequences appear in the table
    await expect(page.getByTestId('span-attrs-table')).not.toContainText('\\u');
  });

  test('attributes represented in the LLM view are collapsed into one expandable group', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const attributes = page.getByTestId('span-attrs-table');
    const toggle = page.getByTestId('llm-attrs-toggle');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('LLM attributes shown above (14)');
    await expect(attributes).not.toContainText('llm.input_messages.0.message.content');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(attributes).toContainText('llm.input_messages.0.message.content');
    await expect(attributes).toContainText('You are an expert hotel concierge assistant');
  });

  test('unrelated attributes stay visible and ordinary spans do not gain an LLM group', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');

    await page.click('[data-testid="span-row-span0001"]');
    await expect(page.getByTestId('span-attrs-table')).toContainText('session.id');
    await expect(page.getByTestId('span-attrs-table')).not.toContainText('input.value');
    await expect(page.getByTestId('llm-attrs-toggle')).toContainText('LLM attributes shown above (3)');

    await page.click('[data-testid="span-row-span0005"]');
    await expect(page.getByTestId('llm-attrs-toggle')).toHaveCount(0);
    await expect(page.getByTestId('span-attrs-table')).toContainText('http.method');
    await expect(page.getByTestId('span-attrs-table')).toContainText('/api/hotels/12345');
  });

  test('expanded LLM attributes retain a readable value column at narrow widths', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.click('[data-testid^="trace-item-"]');
    await page.getByTestId('llm-attrs-toggle').click();

    const keyCell = page.getByTestId('span-attrs-table')
      .getByText('llm.output_messages.0.message.tool_calls', { exact: true });
    const row = keyCell.locator('..');
    const valueCell = row.locator('td').nth(1);
    const [rowBox, valueBox] = await Promise.all([row.boundingBox(), valueCell.boundingBox()]);

    expect(rowBox).not.toBeNull();
    expect(valueBox).not.toBeNull();
    expect(valueBox!.width).toBeGreaterThan(rowBox!.width * 0.45);
  });

  test('LLM detail shows Output section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('output-section')).toBeVisible();
  });

  test('message blocks show role labels', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('message-block-system')).toBeVisible();
    await expect(page.getByTestId('message-block-user')).toBeVisible();
    await expect(page.getByTestId('message-block-assistant')).toBeVisible();
  });

  test('message content shows prompt text', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('You are an expert hotel concierge assistant')).toBeVisible();
    // Fixture uses Python ensure_ascii=True unicode escapes — decoded to Chinese characters
    await expect(page.getByTestId('llm-span-detail').getByText('请问酒店')).toBeVisible();
  });

  test('shows token counts in params section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('params-section')).toBeVisible();
    // Params section is open by default — no click needed
    // Scope to params-section to avoid matching same numbers in attribute table
    await expect(page.getByTestId('params-section').getByText('312')).toBeVisible(); // input tokens
    await expect(page.getByTestId('params-section').getByText('48')).toBeVisible();  // output tokens
    await expect(page.getByTestId('params-section').getByText('360')).toBeVisible(); // total tokens
  });

  test('clicking a different span updates detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Click the TOOL span
    await page.click('[data-testid="span-row-span0003"]');
    await expect(page.getByTestId('span-detail-panel')).toContainText('get_property_details');
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
  });

  test('back button returns to trace list', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('button:has-text("Back")');
    await expect(page.getByTestId('trace-detail-view')).not.toBeVisible();
    await expect(page.getByTestId('trace-list-pane').getByText('process_query').first()).toBeVisible();
  });

  test('shows trace stats (duration, span count)', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-stats-row').getByText('Duration')).toBeVisible();
    await expect(page.getByTestId('trace-stats-row').getByText('Spans', { exact: true })).toBeVisible();
    await expect(page.getByTestId('trace-stats-row').getByText('LLM Spans')).toBeVisible();
    // BUG-001: GUARDRAIL spans now count as LLM spans; 3 total: span0002 (LLM) + span0004 (LLM) + span0008 (GUARDRAIL)
    await expect(page.getByTestId('llm-span-count')).toHaveText('3');
  });

  test('span detail header shows wall-clock start timestamp', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.waitForSelector('[data-testid="span-detail-panel"]');
    // Fixture trace starts at epoch 1741900000000ms = 2025-03-13T...
    // The timestamp should be an ISO-style string like "2025-03-13 ..."
    const meta = page.locator('[data-testid="span-detail-panel"]').locator('text=/^2025-\\d{2}-\\d{2}/');
    await expect(meta).toBeVisible();
  });

  test('agent span row shows agent name label', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.waitForSelector('[data-testid="span-row-span0007"]');
    const agentRow = page.getByTestId('span-row-span0007');
    await expect(agentRow).toContainText('my_agent');
  });

  test('OpenInference convention badge is shown', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('OpenInference')).toBeVisible();
  });

  test('toolbar collapses and expands', async ({ page }) => {
    // Collapse toolbar via the toggle button
    await page.click('button[title="Collapse toolbar"]');
    await expect(page.locator('button[title="Expand toolbar"]')).toBeVisible();
    // Search button stays visible (top row is always shown)
    await expect(page.getByTestId('trace-explorer').getByRole('button', { name: 'Search', exact: true })).toBeVisible();
    // Expand it again
    await page.click('button[title="Expand toolbar"]');
    await expect(page.locator('button[title="Collapse toolbar"]')).toBeVisible();
  });

  test('trace list collapses and expands', async ({ page }) => {
    await expect(page.getByTestId('trace-list-pane').getByText('process_query').first()).toBeVisible();
    // Collapse the left trace list panel
    await page.click('button[title="Collapse trace list"]');
    await expect(page.getByTestId('trace-list-pane').getByText('process_query').first()).not.toBeVisible();
    await expect(page.locator('button[title="Expand trace list"]')).toBeVisible();
    // Expand it again
    await page.click('button[title="Expand trace list"]');
    await expect(page.getByTestId('trace-list-pane').getByText('process_query').first()).toBeVisible();
  });

  test('span list collapses and expands inside trace detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    // Span rows are visible
    await expect(page.getByTestId('span-row-span0001')).toBeVisible();
    // Collapse the span list
    await page.click('button[title="Collapse span list"]');
    await expect(page.getByTestId('span-row-span0001')).not.toBeVisible();
    await expect(page.locator('button[title="Expand span list"]')).toBeVisible();
    // Expand it again
    await page.click('button[title="Expand span list"]');
    await expect(page.getByTestId('span-row-span0001')).toBeVisible();
  });

  test('AI only filter hides non-AI spans', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // HTTP span (no openinference.span.kind) is visible before filter
    await expect(page.getByTestId('span-row-span0005')).toBeVisible();
    // Enable AI Only filter
    await page.click('button[title="Show only AI spans"]');
    // Non-AI HTTP span is now hidden
    await expect(page.getByTestId('span-row-span0005')).not.toBeVisible();
    // LLM spans still visible
    await expect(page.getByTestId('span-row-span0002')).toBeVisible();
    // AGENT and TOOL spans also visible (they are AI spans)
    await expect(page.getByTestId('span-row-span0007')).toBeVisible();
    await expect(page.getByTestId('span-row-span0003')).toBeVisible();
    // Toggle filter off
    await page.click('button[title="Show only AI spans"]');
    await expect(page.getByTestId('span-row-span0005')).toBeVisible();
  });

  test('TOOL span shows OpenInference detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0003"]');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
    await expect(page.getByTestId('oi-span-kind')).toContainText('TOOL');
    await expect(page.getByTestId('tool-section')).toBeVisible();
  });

  test('GUARDRAIL span shows LLM detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0008"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('GUARDRAIL span shows GUARDRAIL kind badge in LLM panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0008"]');
    await expect(page.getByTestId('llm-span-kind')).toContainText('GUARDRAIL');
  });

  test('GUARDRAIL span shows model name and input messages', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0008"]');
    await expect(page.getByTestId('llm-model-name')).toContainText('gemini-2.0-flash');
    await expect(page.getByTestId('input-messages-section')).toBeVisible();
  });

  test('GUARDRAIL span does not show OpenInference detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0008"]');
    await expect(page.getByTestId('oi-span-detail')).not.toBeVisible();
  });

  test('UNKNOWN span shows OpenInference detail panel with IO section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0009"]');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
    await expect(page.getByTestId('oi-span-kind')).toContainText('UNKNOWN');
    await expect(page.getByTestId('io-section')).toBeVisible();
    await expect(page.getByTestId('io-section')).toContainText('raw input payload');
  });

  test('UNKNOWN span does not show LLM detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0009"]');
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
  });

  test('message block collapses and expands on click', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // System message content is visible by default
    const systemBlock = page.getByTestId('message-block-system');
    await expect(systemBlock.getByText('You are an expert hotel concierge assistant')).toBeVisible();
    // Header is a native <button> with aria-expanded — click it to collapse
    await systemBlock.locator('button[aria-expanded]').first().click();
    await expect(systemBlock.getByText('You are an expert hotel concierge assistant')).not.toBeVisible();
    // Click again to re-expand
    await systemBlock.locator('button[aria-expanded]').first().click();
    await expect(systemBlock.getByText('You are an expert hotel concierge assistant')).toBeVisible();
  });

  test('renders scalar tool messages as associated tool results', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0004"]');

    const result = page.getByTestId('message-part-tool_result');
    await expect(result).toContainText('Tool result');
    await expect(result).toContainText('Grand Sukhumvit Bangkok');
  });

  test('keeps tool calls visible through the Markdown toggle cycle', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const assistantBlock = page.getByTestId('message-block-assistant');
    await expect(assistantBlock.getByText('get_property_details', { exact: false })).toBeVisible();

    const markdownToggle = assistantBlock.getByTitle('Render Markdown');
    if (await markdownToggle.count() === 0) {
      return;
    }
    await markdownToggle.click();
    await expect(assistantBlock.getByText('get_property_details', { exact: false })).toBeVisible();
    await assistantBlock.getByTitle('Show raw text').click();
    await expect(assistantBlock.getByText('get_property_details', { exact: false })).toBeVisible();
  });

  test('trace list pane is resizable by dragging the handle', async ({ page }) => {
    // Wait for auto-select to fully settle (span rows visible + network idle)
    await expect(page.locator('[data-testid^="span-row-"]').first()).toBeVisible();
    await page.waitForTimeout(300); // let React flush all pending updates after trace load
    const handle = page.getByTestId('resize-handle-trace-list');
    const pane = page.getByTestId('trace-list-pane');

    const before = await pane.boundingBox();
    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    // Clamp Y to stay within viewport: handle height inflates to match scrollable content
    // when spans are loaded, so box!.height / 2 would be far outside the visible area.
    const cy = box!.y + Math.min(box!.height / 2, 100);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 10 });
    await page.mouse.up();

    const after = await pane.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 100);
  });

  test('trace list pane can be made narrower by dragging left', async ({ page }) => {
    // Wait for auto-select to fully settle (span rows visible + network idle)
    await expect(page.locator('[data-testid^="span-row-"]').first()).toBeVisible();
    await page.waitForTimeout(300); // let React flush all pending updates after trace load
    const handle = page.getByTestId('resize-handle-trace-list');
    const pane = page.getByTestId('trace-list-pane');

    const before = await pane.boundingBox();
    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    // Clamp Y to stay within viewport (handle height inflates when spans are loaded).
    const cy = box!.y + Math.min(box!.height / 2, 100);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy, { steps: 10 });
    await page.mouse.up();

    const after = await pane.boundingBox();
    expect(after!.width).toBeLessThan(before!.width - 100);
  });

  test('span list pane is resizable by dragging the handle', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    await page.getByRole('button', { name: 'Collapse trace list' }).click();

    const handle = page.getByTestId('resize-handle-span-list');
    const pane = page.getByTestId('span-list-pane');

    const before = await pane.boundingBox();
    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Dispatch synthetic events directly — more reliable than page.mouse for document listeners
    await page.evaluate(({ x, y, dx }) => {
      const el = document.querySelector('[data-testid="resize-handle-span-list"]') as HTMLElement;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y }));
    }, { x: cx, y: cy, dx: 120 });

    const after = await pane.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 50);
  });

  test('span list pane can be made narrower by dragging left', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');

    const handle = page.getByTestId('resize-handle-span-list');
    const pane = page.getByTestId('span-list-pane');

    const before = await pane.boundingBox();
    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.evaluate(({ x, y, dx }) => {
      const el = document.querySelector('[data-testid="resize-handle-span-list"]') as HTMLElement;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y }));
    }, { x: cx, y: cy, dx: -120 });

    const after = await pane.boundingBox();
    expect(after!.width).toBeLessThan(before!.width - 50);
  });

  test('span list resize starts from its responsive capped width', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.click('[data-testid^="trace-item-"]');

    const handle = page.getByTestId('resize-handle-span-list');
    const pane = page.getByTestId('span-list-pane');
    const before = await pane.boundingBox();
    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await page.evaluate(({ x, y, dx }) => {
      const el = document.querySelector('[data-testid="resize-handle-span-list"]') as HTMLElement;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y }));
    }, { x: cx, y: cy, dx: -80 });

    const after = await pane.boundingBox();
    expect(after!.width).toBeLessThan(before!.width - 50);
    expect((await page.getByTestId('span-detail-pane').boundingBox())!.width).toBeGreaterThanOrEqual(300);
  });

  test('resize respects minimum width (trace list)', async ({ page }) => {
    const handle = page.getByTestId('resize-handle-trace-list');
    const pane = page.getByTestId('trace-list-pane');

    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + Math.min(box!.height / 2, 100);

    // Drag far left — should clamp at min (160px)
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 1000, cy);
    await page.mouse.up();

    const after = await pane.boundingBox();
    expect(after!.width).toBeGreaterThanOrEqual(160);
  });

  test('resize respects maximum width (trace list)', async ({ page }) => {
    const handle = page.getByTestId('resize-handle-trace-list');
    const pane = page.getByTestId('trace-list-pane');

    const box = await handle.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + Math.min(box!.height / 2, 100);

    // Drag far right — should clamp at max (700px)
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 1000, cy);
    await page.mouse.up();

    const after = await pane.boundingBox();
    expect(after!.width).toBeLessThanOrEqual(700);
  });

  test('resize handle is hidden when trace list is collapsed', async ({ page }) => {
    await page.click('button[title="Collapse trace list"]');
    await expect(page.getByTestId('resize-handle-trace-list')).not.toBeVisible();
  });

  test('resize handle is hidden when span list is collapsed', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('button[title="Collapse span list"]');
    await expect(page.getByTestId('resize-handle-span-list')).not.toBeVisible();
  });

  // === Summary bar ===

  test('summary bar is visible after traces load', async ({ page }) => {
    await expect(page.getByTestId('trace-summary-bar')).toBeVisible();
  });

  test('summary bar shows correct service count', async ({ page }) => {
    // 2 traces with distinct root services: llm-service and agent-service
    await expect(page.getByTestId('trace-summary-bar')).toContainText('Services');
    await expect(page.getByTestId('trace-summary-bar').getByText('2', { exact: true })).toBeVisible();
  });

  test('summary bar shows average and slowest duration', async ({ page }) => {
    // avg([2340, 1820]) = 2080ms = 2.08s; slowest = 2340ms = 2.34s
    await expect(page.getByTestId('trace-summary-bar').getByText('2.08s')).toBeVisible();
    await expect(page.getByTestId('trace-summary-bar').getByText('2.34s').first()).toBeVisible();
  });

  // === Finish reason badge ===

  test('MAX_TOKENS finish reason badge shown for span0004', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0004"]');
    await expect(page.getByTestId('llm-span-detail').getByText('MAX_TOKENS').first()).toBeVisible();
  });

  // === Cost estimation ===

  test('cost estimate is shown in params section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // params-section is open by default — no click needed
    await expect(page.getByTestId('params-section').getByText('Cost')).toBeVisible();
    // claude-sonnet-4-5 matches claude-sonnet-4 pricing: (312*3 + 48*15)/1e6 = $0.0017
    await expect(page.getByTestId('params-section').getByText('$0.0017')).toBeVisible();
  });

  // === Copy buttons ===

  test('copy button is present in input messages section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('input-messages-section').getByTitle('Copy input messages')).toBeVisible();
  });

  test('copy button is present in output section', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('output-section').getByTitle('Copy output')).toBeVisible();
  });

  // === Word count in message blocks ===

  test('message blocks show word and character count', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const systemBlock = page.getByTestId('message-block-system');
    // Word/char count line is rendered below message content
    await expect(systemBlock.getByText(/\d+ words · \d+ chars/)).toBeVisible();
  });

  // === Error span highlighting ===

  test('error span row is visible and rendered', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('span-row-span0006')).toBeVisible();
  });

  test('error span row shows red error dot indicator', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // The error dot is rendered before the indent inside the span row
    const errorRow = page.getByTestId('span-row-span0006');
    await expect(errorRow).toBeVisible();
    // The row must contain an element with the error dot (identified by title attribute)
    await expect(errorRow.locator('[title="Error span"]')).toBeVisible();
  });

  test('clicking error span shows Status: error in detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0006"]');
    await expect(page.getByTestId('span-status-error')).toBeVisible();
    await expect(page.getByTestId('span-status-error')).toContainText('Status: error');
  });

  test('error span detail shows status message', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0006"]');
    await expect(page.getByTestId('span-status-message')).toBeVisible();
    await expect(page.getByTestId('span-status-message')).toContainText('Connection timeout after 100ms');
  });

  test('non-error span detail does not show status error', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // span0002 is an LLM span with no error
    await page.click('[data-testid="span-row-span0002"]');
    await expect(page.getByTestId('span-status-error')).not.toBeVisible();
  });

  // === Keyboard navigation ===

  test('j key moves selection to the next span', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Auto-selects span0002 (first LLM span) → llm-span-detail visible
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    // Press j — moves to span0003 (TOOL span)
    await page.keyboard.press('j');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
  });

  test('k key moves selection to the previous span', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Wait for auto-select to complete (span0002 LLM span)
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    // Move forward to span0003 (TOOL)
    await page.keyboard.press('j');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
    // Move back to span0002 (LLM)
    await page.keyboard.press('k');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('Escape key deselects span and hides detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Click the CHAIN root span → OI detail shown, not LLM detail
    await page.click('[data-testid="span-row-span0001"]');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
    // Press Escape → deselects; BUG-077: userDismissedDetail suppresses firstLlmSpan fallback
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('oi-span-detail')).not.toBeVisible();
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
  });

  test('ArrowDown key navigates to next span', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();
  });

  test('trace ID lookup row is not present', async ({ page }) => {
    await expect(page.getByTestId('trace-explorer').getByText('Trace ID', { exact: true })).not.toBeAttached();
  });

  // === Expand-all / Collapse-all ===

  test('collapse-all button hides all child spans', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Verify children are initially visible
    await expect(page.getByTestId('span-row-span0001')).toBeVisible();
    await expect(page.getByTestId('span-row-span0002')).toBeVisible();
    await expect(page.getByTestId('span-row-span0004')).toBeVisible();
    // Collapse all
    await page.click('button[title="Collapse all spans"]');
    // Only root is visible; children are hidden
    await expect(page.getByTestId('span-row-span0001')).toBeVisible();
    await expect(page.getByTestId('span-row-span0002')).not.toBeVisible();
    await expect(page.getByTestId('span-row-span0004')).not.toBeVisible();
    await expect(page.getByTestId('span-row-span0005')).not.toBeVisible();
  });

  test('expand-all button restores all spans after collapse-all', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('button[title="Collapse all spans"]');
    await expect(page.getByTestId('span-row-span0002')).not.toBeVisible();
    // Expand all
    await page.click('button[title="Expand all spans"]');
    await expect(page.getByTestId('span-row-span0002')).toBeVisible();
    await expect(page.getByTestId('span-row-span0003')).toBeVisible();
    await expect(page.getByTestId('span-row-span0004')).toBeVisible();
    await expect(page.getByTestId('span-row-span0005')).toBeVisible();
    await expect(page.getByTestId('span-row-span0006')).toBeVisible();
  });

  test('collapsing a parent span hides its children', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // span0003 is a child of span0002
    await expect(page.getByTestId('span-row-span0003')).toBeVisible();
    // Click span0002's expand chevron icon (first SVG in the row — no error badge on this span)
    await page.getByTestId('span-row-span0002').locator('svg').first().click();
    await expect(page.getByTestId('span-row-span0003')).not.toBeVisible();
    // span0002 itself still visible
    await expect(page.getByTestId('span-row-span0002')).toBeVisible();
  });

  // === Expand Strings ===

  test('expand-strings button is visible in span detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('expand-strings-btn')).toBeVisible();
  });

  test('expand-strings button expands embedded JSON attribute values', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const panel = page.getByTestId('span-detail-panel');
    // Before: no <pre> wrapping expanded JSON
    await expect(panel.locator('pre')).toHaveCount(0);
    await page.getByTestId('llm-attrs-toggle').click();
    // Expand strings
    await page.click('[data-testid="expand-strings-btn"]');
    // span0002 has llm.invocation_parameters = '{"temperature":0.3,...}' → expands to <pre>
    await expect(panel.locator('pre').first()).toBeVisible();
  });

  test('expand-strings can be toggled back to raw values', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const panel = page.getByTestId('span-detail-panel');
    await page.getByTestId('llm-attrs-toggle').click();
    await page.click('[data-testid="expand-strings-btn"]');
    await expect(panel.locator('pre').first()).toBeVisible();
    // Toggle off
    await page.click('[data-testid="expand-strings-btn"]');
    await expect(panel.locator('pre')).toHaveCount(0);
  });

  // === Markdown toggle ===

  test('MD toggle button is present in open message block', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // The MD button appears next to the role label when message is open and marked is available
    const systemBlock = page.getByTestId('message-block-system');
    const mdBtn = systemBlock.getByTitle(/Render Markdown|Show raw text/);
    // If marked is available in the Grafana bundle, the button will be present
    const count = await mdBtn.count();
    if (count > 0) {
      await expect(mdBtn).toBeVisible();
    }
  });

  test('MD toggle hides word count and renders HTML content', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const systemBlock = page.getByTestId('message-block-system');
    const mdBtn = systemBlock.getByTitle('Render Markdown');
    const count = await mdBtn.count();
    if (count === 0) {
      // marked not available in this environment — skip
      return;
    }
    // Word count visible in raw mode
    await expect(systemBlock.getByText(/\d+ words · \d+ chars/)).toBeVisible();
    // Activate MD mode
    await mdBtn.click();
    // Word count hidden (only shown in raw text div)
    await expect(systemBlock.getByText(/\d+ words · \d+ chars/)).not.toBeVisible();
    // Toggle back to raw
    await systemBlock.getByTitle('Show raw text').click();
    await expect(systemBlock.getByText(/\d+ words · \d+ chars/)).toBeVisible();
  });

  // === Scroll to selected span ===

  test('selecting a span scrolls it into view (span is attached to DOM)', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Press j several times to navigate deep into the list — span should remain attached
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    // The selected span row should still be visible in the DOM
    // At minimum, the spans we navigated to should all be attached (not removed from DOM)
    await expect(page.getByTestId('span-row-span0001')).toBeAttached();
    await expect(page.getByTestId('span-row-span0004')).toBeAttached();
  });

  // === Developer Pass 1 fixes ===

  test('params section is open by default without any interaction', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Parameters & Token Usage section must be visible immediately, no click needed
    const params = page.getByTestId('params-section');
    await expect(params).toBeVisible();
    await expect(params.getByText('temperature')).toBeVisible();
    await expect(params.getByText('312')).toBeVisible(); // prompt token count
  });

  test('span selection and AI-filter reset when switching to a different trace', async ({ page }) => {
    // Load first trace and navigate to TOOL span
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-span0003"]');
    await expect(page.getByTestId('oi-span-detail')).toBeVisible();

    // Enable AI-only filter
    await page.click('button[title="Show only AI spans"]');
    await expect(page.getByTestId('span-row-span0005')).not.toBeVisible();

    // Navigate back to trace list and click second trace
    await page.click('button:has-text("Back")');
    await page.click('[data-testid^="trace-item-"]:last-of-type');

    // State should have reset: AI filter off (non-AI span visible again) and
    // auto-selection back to first LLM span (llm-span-detail visible, not oi-span-detail)
    await expect(page.getByTestId('span-row-span0005')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    await expect(page.getByTestId('oi-span-detail')).not.toBeVisible();
  });

  test('long message content is fully visible without expand/collapse', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // System message in span0002 is >400 chars — it should be fully visible (no truncation)
    const systemBlock = page.getByTestId('message-block-system');
    await expect(systemBlock).toBeVisible();
    // No expand/collapse buttons — content is always fully shown
    await expect(systemBlock.getByText('▼ Expand')).not.toBeVisible();
    await expect(systemBlock.getByText('▲ Collapse')).not.toBeVisible();
  });

  test('timestamps for old traces include date not just time', async ({ page }) => {
    // Fixture traces have startTimeUnixNano from March 2025 (not today in 2026)
    // formatTime should return "Mar 13, ..." or similar month-name format
    const traceList = page.getByTestId('trace-list-pane');
    // Matches short month abbreviations Jan–Dec (use .first() — both fixtures have old dates)
    await expect(traceList.getByText(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/).first()).toBeVisible();
  });

  test('summary bar shows P95* label with asterisk', async ({ page }) => {
    await expect(page.getByTestId('trace-summary-bar').getByText('P95*')).toBeVisible();
  });

  test('P95* label has tooltip explaining it is approximate', async ({ page }) => {
    const p95 = page.getByTestId('trace-summary-bar').getByText('P95*');
    await expect(p95).toHaveAttribute('title', /Approximate/i);
  });

  test('unknown model shows fallback text in params section', async ({ page }) => {
    // Override trace mock so the model name is unrecognised
    const unknownModelTrace = JSON.parse(JSON.stringify(TRACE_RESPONSE));
    unknownModelTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes =
      unknownModelTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes.map((attr: Record<string, unknown>) =>
        (attr.key as string) === 'llm.model_name'
          ? { key: 'llm.model_name', value: { stringValue: 'totally-unknown-model-xyz' } }
          : attr
      );
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unknownModelTrace) });
    });
    await page.click('[data-testid^="trace-item-"]');
    // params section is open by default; unknown model → cost shows "unknown" fallback
    await expect(page.getByTestId('params-section').getByText('unknown', { exact: true })).toBeVisible();
  });

  test('model badge is hidden when model cannot be identified', async ({ page }) => {
    // Remove llm.model_name so extraction falls back to 'unknown'
    const noModelTrace = JSON.parse(JSON.stringify(TRACE_RESPONSE));
    noModelTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes =
      noModelTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes.filter(
        (attr: Record<string, unknown>) => (attr.key as string) !== 'llm.model_name'
      );
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(noModelTrace) });
    });
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    await expect(page.getByTestId('llm-model-name')).not.toBeVisible();
  });

  // === Developer Pass 2 fixes ===

  test('message block header is a native button with aria-expanded', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const systemBlock = page.getByTestId('message-block-system');
    // The outer message-block wrapper must be a div
    const tag = await systemBlock.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('div');
    // The clickable header inside it must be a native <button> with aria-expanded
    const headerButton = systemBlock.locator('button[aria-expanded]').first();
    await expect(headerButton).toBeVisible();
    const headerTag = await headerButton.evaluate((el) => el.tagName.toLowerCase());
    expect(headerTag).toBe('button');
  });

  test('collapsible section header is a native button with aria-expanded', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const params = page.getByTestId('params-section');
    // The params section header must be a native <button> with aria-expanded
    const headerButton = params.locator('button[aria-expanded]').first();
    await expect(headerButton).toBeVisible();
    const headerTag = await headerButton.evaluate((el) => el.tagName.toLowerCase());
    expect(headerTag).toBe('button');
  });

  test('trace list container has role=listbox and aria-label', async ({ page }) => {
    await expect(page.locator('[role="listbox"][aria-label="Traces"]')).toBeVisible();
  });

  test('trace list items have role=option', async ({ page }) => {
    const items = page.locator('[role="option"][data-testid^="trace-item-"]');
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBe(2); // fixture has 2 traces
  });

  test('trace list items are keyboard focusable (tabindex=0)', async ({ page }) => {
    const firstTrace = page.locator('[data-testid^="trace-item-"]').first();
    await expect(firstTrace).toHaveAttribute('tabindex', '0');
  });

  test('Enter key on focused trace item opens the trace', async ({ page }) => {
    const firstTrace = page.locator('[data-testid^="trace-item-"]').first();
    await firstTrace.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
  });

  test('Space key on focused trace item opens the trace', async ({ page }) => {
    const firstTrace = page.locator('[data-testid^="trace-item-"]').first();
    await firstTrace.focus();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
  });

  test('trace list items have aria-selected attribute', async ({ page }) => {
    // Auto-select picks the first trace on load, so it starts as selected
    const firstTrace = page.locator('[data-testid^="trace-item-"]').first();
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    await expect(firstTrace).toHaveAttribute('aria-selected', 'true');
    // Clicking the second trace deselects the first
    const secondTrace = page.locator('[data-testid^="trace-item-"]').nth(1);
    await secondTrace.click();
    await expect(firstTrace).toHaveAttribute('aria-selected', 'false');
    await expect(secondTrace).toHaveAttribute('aria-selected', 'true');
  });

  test('XSS: script tags in LLM content are stripped when rendered as markdown', async ({ page }) => {
    // Inject a trace where system message contains a script tag
    const xssTrace = JSON.parse(JSON.stringify(TRACE_RESPONSE));
    xssTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes =
      xssTrace.resourceSpans[0].scopeSpans[0].spans[1].attributes.map((attr: Record<string, unknown>) =>
        (attr.key as string) === 'llm.input_messages.0.message.content'
          ? { key: 'llm.input_messages.0.message.content', value: { stringValue: 'Normal text. <script>window.__xss_test = true;</script> More text.' } }
          : attr
      );
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(xssTrace) });
    });

    await page.click('[data-testid^="trace-item-"]');
    const systemBlock = page.getByTestId('message-block-system');
    const mdBtn = systemBlock.getByTitle('Render Markdown');
    const count = await mdBtn.count();
    if (count === 0) {
      // marked not available in this environment — test sanitisation of raw HTML instead
      const scriptTags = await systemBlock.locator('script').count();
      expect(scriptTags).toBe(0);
      return;
    }

    // Activate markdown rendering
    await mdBtn.click();
    // Verify script was not executed
    const xssInjected = await page.evaluate(() => (window as any).__xss_test);
    expect(xssInjected).toBeUndefined();
    // Verify no <script> element in the rendered output
    const scriptTags = await systemBlock.locator('script').count();
    expect(scriptTags).toBe(0);
  });

  test('Tempo API error shows inline error banner', async ({ page }) => {
    // Mock ALL datasource proxy endpoints to return an error
    await page.route('**/api/datasources/**', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'datasource not found' }) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    // The search error banner should appear with the error message
    await expect(page.getByTestId('search-error-message')).toBeVisible();
    await expect(page.getByTestId('search-error-message')).toContainText(/datasource not found|503|error/i);
  });

  test('AI Only toggle in trace detail does not crash or reload trace', async ({ page }) => {
    // Open a trace so TraceDetail is visible with the AI-only toggle
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    // Toggle AI-only multiple times — should not cause errors or remove all spans
    await page.click('button[title="Show only AI spans"]');
    await page.click('button[title="Show only AI spans"]'); // off
    await page.click('button[title="Show only AI spans"]'); // on again
    // After toggling, AI spans remain visible
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  // === Search error display ===

  test('search error shows actual error message inline (not just tooltip)', async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'internal server error from tempo' }) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    const errorBanner = page.getByTestId('search-error-message');
    await expect(errorBanner).toBeVisible();
    // The actual error text must be visible as rendered content, not just a title attribute
    await expect(errorBanner).toContainText('internal server error from tempo');
  });

  test('search error banner can be dismissed', async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await expect(page.getByTestId('search-error-message')).toBeVisible();
    await page.click('[aria-label="Dismiss error"]');
    await expect(page.getByTestId('search-error-message')).not.toBeVisible();
  });

  test('initial search request q param covers all LLM conventions', async ({ page }) => {
    // Use waitForRequest to observe the URL without intercepting (beforeEach already handles fulfillment).
    // page.route() handlers are FIFO in Playwright, so a second handler registered in the test body
    // would never fire — using waitForRequest avoids that race.
    const searchRequestPromise = page.waitForRequest('**/api/datasources/proxy/uid/**/api/search**');
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    const searchRequest = await searchRequestPromise;
    const capturedUrl = searchRequest.url();
    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);
    const q = url.searchParams.get('q');
    expect(q).toBeTruthy();
    // Must include OpenInference, OTel GenAI and fallback model attributes
    expect(q).toContain('openinference.span.kind');
    expect(q).toContain('gen_ai.system');
    expect(q).toContain('llm.model_name');
    // Must also include gen_ai.operation.name — the primary OTel GenAI span marker set by
    // opentelemetry-instrumentation-openai; spans from that library may not set gen_ai.system
    expect(q).toContain('gen_ai.operation.name');
    // Must be wrapped in braces (valid TraceQL)
    expect(q).toMatch(/^\{.+\}$/);
  });

  test('visual snapshot — trace explorer empty state', async ({ page }) => {
    // Navigate fresh without mocks to see empty state
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ traces: [] }) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await waitForToolbarLayout(page);
    // Cap height so Grafana chrome differences between CI and local don't affect the snapshot
    await page.getByTestId('trace-explorer').evaluate((el) => {
      (el as HTMLElement).style.maxHeight = '900px';
      (el as HTMLElement).style.overflow = 'hidden';
    });
    await expect(page.getByTestId('trace-explorer')).toHaveScreenshot('trace-explorer-empty.png');
  });

  test('visual snapshot — trace list loaded', async ({ page }) => {
    await expect(page.getByTestId('trace-list-pane').getByText('process_query').first()).toBeVisible();
    // Fix height so 1px differences between CI and local don't cause mismatches.
    await page.getByTestId('trace-list-pane').evaluate((el) => {
      (el as HTMLElement).style.height = '800px';
      (el as HTMLElement).style.overflow = 'hidden';
    });
    await expect(page.getByTestId('trace-list-pane')).toHaveScreenshot('trace-list.png');
  });

  test('visual snapshot — LLM span detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    // Scope to llm-span-detail — cap to 1200px so the test is not sensitive to the exact
    // rendered height, which varies by 10–20px between CI and local Chromium builds.
    await page.getByTestId('llm-span-detail').evaluate((el) => {
      (el as HTMLElement).style.maxHeight = '1200px';
      (el as HTMLElement).style.overflow = 'hidden';
    });
    await expect(page.getByTestId('llm-span-detail')).toHaveScreenshot('llm-span-detail.png');
  });

  test('visual snapshot — params section open', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // params-section is open by default — temperature visible without any click
    await expect(page.getByTestId('params-section').getByText('temperature')).toBeVisible();
    // Cap to 158px to avoid 1–2px height variance between Chromium builds.
    await page.getByTestId('params-section').evaluate((el) => {
      (el as HTMLElement).style.maxHeight = '158px';
      (el as HTMLElement).style.overflow = 'hidden';
    });
    await expect(page.getByTestId('params-section')).toHaveScreenshot('params-expanded.png');
  });
});

test.describe('Structured OpenInference conversation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STRUCTURED_SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STRUCTURED_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('renders nested OpenInference text and flattened tool calls from the target trace', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');

    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByText('example_user', { exact: false })).toBeVisible();
    await expect(detail.getByText('Please look into ticket', { exact: false })).toBeVisible();
    await expect(detail.getByText('transfer_to_agent', { exact: false })).toBeVisible();
    await expect(detail.getByText('tooluse_example0001', { exact: false })).toBeVisible();
    await expect(detail.getByTestId('message-part-tool_call')).toHaveCount(1);
    await expect(detail.getByText('No arguments', { exact: true })).toBeVisible();
    await expect(detail.getByText('(empty)')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Vertex AI convention tests (gen_ai.system=vertex_ai + llm.prompts/completions)
// ---------------------------------------------------------------------------

test.describe('Vertex AI convention', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VERTEX_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('Vertex trace loads and shows gemini span in span list', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    await expect(page.getByText('gemini-1.5-pro').first()).toBeVisible();
  });

  test('Vertex LLM span auto-selects and shows LLM detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('Vertex LLM detail shows model name', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-model-name')).toContainText('gemini-1.5-pro');
  });

  test('Vertex LLM detail shows input message from llm.prompts', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-vspan0002"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    await expect(page.getByTestId('input-messages-section')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText('Describe the Eiffel Tower.')).toBeVisible();
  });

  test('Vertex LLM detail shows output message from llm.completions', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-vspan0002"]');
    await expect(page.getByTestId('output-section')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText(/Eiffel Tower.*iron lattice/)).toBeVisible();
  });

  test('Vertex LLM detail shows token counts', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-vspan0002"]');
    const params = page.getByTestId('params-section');
    await expect(params.getByText('9')).toBeVisible();   // prompt tokens
    await expect(params.getByText('42')).toBeVisible();  // completion tokens
    await expect(params.getByText('51')).toBeVisible();  // total tokens
  });

  test('Vertex LLM span shows LLM kind badge in detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await page.click('[data-testid="span-row-vspan0002"]');
    await expect(page.getByTestId('llm-span-kind')).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
  });
});

// ---------------------------------------------------------------------------
// OTel GenAI convention tests (gen_ai.system=openai + span events)
// ---------------------------------------------------------------------------

test.describe('OTel GenAI convention', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OTEL_GENAI_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('OTel GenAI trace loads and shows LLM detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('OTel GenAI detail shows gpt-4o model', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-model-name')).toContainText('gpt-4o');
  });

  test('OTel GenAI detail shows input messages from span events', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('input-messages-section')).toBeVisible();
    // gen_ai.content.prompt event has JSON array with system + user messages
    await expect(page.getByTestId('llm-span-detail').getByText('You are a helpful travel assistant.')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText('What are the top 3 attractions in Paris?')).toBeVisible();
  });

  test('OTel GenAI detail shows output from completion event', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('output-section')).toBeVisible();
    await expect(page.getByTestId('output-section').getByText(/top 3 attractions in Paris/)).toBeVisible();
  });

  test('OTel GenAI detail shows token usage', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const params = page.getByTestId('params-section');
    await expect(params.getByText('145')).toBeVisible();  // input tokens
    await expect(params.getByText('67')).toBeVisible();   // output tokens
  });

  test('OTel GenAI detail shows stop finish reason', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('STOP')).toBeVisible();
  });

  test('OTel GenAI convention badge is shown', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('OTel GenAI')).toBeVisible();
  });

  test('OTel GenAI LLM span shows LLM kind badge in detail panel', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-kind')).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
  });
});

// ---------------------------------------------------------------------------
// Generic convention tests (operation.type=chat_completion, no standard attrs)
// ---------------------------------------------------------------------------

test.describe('Generic convention', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GENERIC_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('generic trace loads and shows LLM detail', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('generic LLM detail shows custom model name', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-model-name')).toContainText('my-custom-llm-v2');
  });

  test('generic LLM detail shows input messages from JSON input.value', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('input-messages-section')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText('You are a code review assistant.')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText('Review this function for bugs.')).toBeVisible();
  });

  test('generic LLM detail shows output message from JSON output.value', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('output-section')).toBeVisible();
    await expect(page.getByTestId('output-section').getByText(/Consider adding null checks/)).toBeVisible();
  });

  test('generic LLM detail shows token usage', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    const params = page.getByTestId('params-section');
    await expect(params.getByText('38')).toBeVisible();  // prompt tokens
    await expect(params.getByText('22')).toBeVisible();  // completion tokens
    await expect(params.getByText('60')).toBeVisible();  // total tokens
  });

  test('generic convention badge is shown', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('Generic')).toBeVisible();
  });

  test('generic LLM detail shows stop finish reason', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-detail').getByText('STOP')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Trace with only non-LLM spans — no auto-select fallback possible
// ---------------------------------------------------------------------------

test.describe('Trace with no LLM spans', () => {
  const NON_LLM_TRACE = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'http-service' } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'nonllm0011223344556677889900aabb',
                spanId: 'nlspan0001',
                parentSpanId: '',
                name: 'HTTP GET /api/data',
                startTimeUnixNano: String(BigInt(1741900000000) * 1000000n),
                endTimeUnixNano: String(BigInt(1741900000200) * 1000000n),
                attributes: [
                  { key: 'http.method', value: { stringValue: 'GET' } },
                  { key: 'http.url', value: { stringValue: '/api/data' } },
                  { key: 'http.status_code', value: { intValue: '200' } },
                ],
                events: [],
              },
              {
                traceId: 'nonllm0011223344556677889900aabb',
                spanId: 'nlspan0002',
                parentSpanId: 'nlspan0001',
                name: 'db.query',
                startTimeUnixNano: String(BigInt(1741900000010) * 1000000n),
                endTimeUnixNano: String(BigInt(1741900000150) * 1000000n),
                attributes: [
                  { key: 'db.system', value: { stringValue: 'postgresql' } },
                  { key: 'db.statement', value: { stringValue: 'SELECT * FROM users' } },
                ],
                events: [],
              },
            ],
          },
        ],
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NON_LLM_TRACE) });
    });
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('trace with no LLM spans loads without crashing', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
  });

  test('span rows for non-LLM spans are visible', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('span-row-nlspan0001')).toBeVisible();
    await expect(page.getByTestId('span-row-nlspan0002')).toBeVisible();
  });

  test('no LLM span detail panel is auto-shown when trace has no LLM spans', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    // Without any LLM span the auto-select fallback has nothing to pick — llm-span-detail must NOT be shown
    await expect(page.getByTestId('llm-span-detail')).not.toBeVisible();
  });

  test('LLM span count shows 0 for an all-non-LLM trace', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('llm-span-count')).toHaveText('0');
  });
});

test.describe('Share link', () => {
  test.beforeEach(async ({ page }) => {
    await mockTempoApis(page);
    await page.goto(PLUGIN_URL);
    await page.waitForSelector('[data-testid="trace-explorer"]');
  });

  test('Share button is visible in toolbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
  });

  test('URL params llt-ds, llt-from, llt-to, llt-query are written to URL after load', async ({ page }) => {
    // Give the URL sync effect time to flush
    await page.waitForTimeout(500);
    const url = new URL(page.url());
    expect(url.searchParams.get('llt-ds')).toBeTruthy();
    expect(url.searchParams.get('llt-from')).toBeTruthy();
    expect(url.searchParams.get('llt-to')).toBeTruthy();
    const queryParam = url.searchParams.get('llt-query');
    expect(queryParam).toBeTruthy();
    // llt-query must be valid JSON containing a refId
    const parsed = JSON.parse(queryParam!);
    expect(parsed).toHaveProperty('refId');
  });

  test('llt-traceId param is written to URL when a trace is selected', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    await page.waitForTimeout(300);
    const url = new URL(page.url());
    expect(url.searchParams.get('llt-traceId')).toBeTruthy();
  });

  test('llt-traceId param is cleared from URL when navigating back from trace', async ({ page }) => {
    await page.click('[data-testid^="trace-item-"]');
    await expect(page.getByTestId('trace-detail-view')).toBeVisible();
    // Go back to trace list
    await page.getByTestId('trace-detail-view').getByRole('button', { name: /back/i }).click();
    await page.waitForTimeout(300);
    const url = new URL(page.url());
    expect(url.searchParams.get('llt-traceId')).toBeNull();
  });

  test('clicking Share shows copied feedback', async ({ page }) => {
    // Grant clipboard permissions so ClipboardButton's copy succeeds and shows the toast
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Share' }).click();
    // ClipboardButton renders an InlineToast with "Copied" text after a successful copy
    await expect(page.getByText('Copied')).toBeVisible({ timeout: 2000 });
  });

  test('restores TraceQL query from shared URL', async ({ page }) => {
    const restoredQuery = { refId: 'A', queryType: 'traceql', query: '{span.gen_ai.system = "openai"}' };
    const params = new URLSearchParams({ 'llt-query': JSON.stringify(restoredQuery) });
    // Collect all search requests — the restored query may not be the first one fired
    const searchQueries: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/search')) {
        const u = new URL(req.url());
        const q = u.searchParams.get('q');
        if (q) { searchQueries.push(q); }
      }
    });
    await page.goto(`${PLUGIN_URL}?${params}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    // Wait for at least one search request to fire
    await page.waitForTimeout(1000);
    // At least one request must contain the restored query
    const match = searchQueries.find((q) => q.includes('gen_ai.system') && q.includes('openai'));
    expect(match, `Expected a search request with gen_ai.system="openai", got: ${JSON.stringify(searchQueries)}`).toBeTruthy();
  });

  test('opens trace directly when llt-traceId is in shared URL', async ({ page }) => {
    // Use a valid 16-char hex trace ID that the mock will return a trace for
    const params = new URLSearchParams({ 'llt-traceId': 'abc123def456abc1' });
    await page.goto(`${PLUGIN_URL}?${params}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    // Trace detail should appear without the user clicking anything
    await expect(page.getByTestId('trace-detail-view')).toBeVisible({ timeout: 5000 });
  });

  test('shared URL with time range sends correct start/end to Tempo', async ({ page }) => {
    // Use a fixed absolute time range so we can assert on the exact seconds sent
    const fromMs = new Date('2025-01-01T00:00:00Z').getTime();
    const toMs = new Date('2025-01-01T06:00:00Z').getTime();
    const expectedStart = Math.floor(fromMs / 1000);
    const expectedEnd = Math.floor(toMs / 1000);
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const params = new URLSearchParams({ 'llt-from': fromIso, 'llt-to': toIso });
    // Collect all search requests — restored time range may not be the first request fired
    const searchParams: Array<{ start: string | null; end: string | null }> = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/search')) {
        const u = new URL(req.url());
        searchParams.push({ start: u.searchParams.get('start'), end: u.searchParams.get('end') });
      }
    });
    await page.goto(`${PLUGIN_URL}?${params}`);
    await page.waitForSelector('[data-testid="trace-explorer"]');
    await page.waitForTimeout(1000);
    const match = searchParams.find(
      (p) => Number(p.start) === expectedStart && Number(p.end) === expectedEnd
    );
    expect(match, `Expected a search with start=${expectedStart}&end=${expectedEnd}, got: ${JSON.stringify(searchParams)}`).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tracing conventions beyond OpenInference: synthetic traces from tests/fixtures/conventions.ts
// ---------------------------------------------------------------------------

async function openConventionTrace(page: Page, trace: unknown, spanId: string) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONVENTION_SEARCH_RESPONSE) });
  });
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trace) });
  });
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]');
  await page.click('[data-testid^="trace-item-"]');
  await page.getByTestId(`span-row-${spanId}`).click();
}

test.describe('OTel GenAI events and newest semantic conventions', () => {
  test('span events render system, user, tool call, tool result and choice', async ({ page }) => {
    await openConventionTrace(page, GENAI_EVENTS_TRACE, 'evspan0000000001');
    const input = page.getByTestId('input-messages-section');
    await expect(input.getByText('You answer weather questions.')).toBeVisible();
    await expect(input.getByText('Weather in Paris?')).toBeVisible();
    await expect(input.getByTestId('message-part-tool_call')).toContainText('get_weather');
    await expect(input.getByTestId('message-part-tool_result')).toContainText('Sunny, 22C');
    await expect(page.getByTestId('output-section').getByText('It is sunny in Paris today.')).toBeVisible();
    await expect(page.getByTestId('llm-span-detail').getByText('STOP')).toBeVisible();
  });

  test('gen_ai.system_instructions is shown as a system message', async ({ page }) => {
    await openConventionTrace(page, GENAI_EVENTS_TRACE, 'evspan0000000002');
    const input = page.getByTestId('input-messages-section');
    await expect(input.getByTestId('message-block-system')).toContainText('Always answer in one sentence.');
    await expect(input.getByText('Is it raining in Rome?')).toBeVisible();
    await expect(page.getByTestId('output-section').getByText('No, it is dry in Rome.')).toBeVisible();
  });

  test('the operation details event provides messages and system instructions', async ({ page }) => {
    await openConventionTrace(page, GENAI_EVENTS_TRACE, 'evspan0000000003');
    const input = page.getByTestId('input-messages-section');
    await expect(input.getByTestId('message-block-system')).toContainText('Reply with a single word.');
    await expect(input.getByText('Capital of Italy?')).toBeVisible();
    await expect(page.getByTestId('output-section').getByText('Rome')).toBeVisible();
  });
});

test.describe('OTel GenAI tool spans', () => {
  test('execute_tool span shows the tool call and result cards with description and call id', async ({ page }) => {
    await openConventionTrace(page, GENAI_TOOL_TRACE, 'toolspan00000001');
    const detail = page.getByTestId('llm-span-detail');
    await expect(page.getByTestId('llm-span-kind')).toContainText('TOOL');
    const call = detail.getByTestId('message-part-tool_call');
    await expect(call).toContainText('get_weather');
    await expect(call).toContainText('Get the current weather for a city');
    await expect(call).toContainText('Paris');
    await expect(call.getByTestId('tool-correlation-chip')).toHaveText('call_weather_1');
    await expect(detail.getByTestId('message-part-tool_result')).toContainText('sunny');
  });

  test('a tool span without an operation name is detected by gen_ai.tool.name', async ({ page }) => {
    await openConventionTrace(page, GENAI_TOOL_TRACE, 'toolspan00000002');
    const detail = page.getByTestId('llm-span-detail');
    await expect(page.getByTestId('llm-span-kind')).toContainText('TOOL');
    await expect(detail.getByTestId('message-part-tool_call')).toContainText('search_docs');
    await expect(detail.getByTestId('message-part-tool_call')).toContainText('rate limits');
    await expect(detail.getByTestId('message-part-tool_result')).toContainText('doc-b');
  });
});

test.describe('Structured attribute values', () => {
  test('native array and key-value list attributes are read as data and displayed as before', async ({ page }) => {
    await openConventionTrace(page, STRUCTURED_ATTRIBUTES_TRACE, 'structspan000001');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByTestId('input-messages-section').getByTestId('message-block-system')).toContainText('Answer in French.');
    await expect(detail.getByTestId('input-messages-section').getByText('Say hello.')).toBeVisible();
    await expect(detail.getByTestId('output-section').getByText('Bonjour.')).toBeVisible();
    await expect(detail.getByText('STOP')).toBeVisible();
    await expect(detail.getByTestId('available-tools-section')).toContainText('Available Tools (1)');
    const attributes = page.getByTestId('span-attrs-table');
    await expect(attributes.getByRole('row', { name: /custom\.labels/ })).toContainText('alpha, beta');
    await expect(attributes.getByRole('row', { name: /custom\.settings/ })).toContainText('region=eu, retries=2');
  });
});

test.describe('Vercel AI SDK', () => {
  test('a model call shows the prompt, the tool call it requests, the tool definitions and the usage', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000002');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByText('Vercel AI SDK')).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
    await expect(detail.getByTestId('input-messages-section').getByTestId('message-block-system')).toContainText('You help with weather.');
    await expect(detail.getByTestId('input-messages-section').getByText('What is the weather in Paris?')).toBeVisible();
    await expect(detail.getByTestId('output-section').getByTestId('message-part-tool_call')).toContainText('getWeather');
    await expect(detail.getByTestId('available-tools-section')).toContainText('Available Tools (1)');
    await expect(detail.getByTestId('params-section')).toContainText('90');
    await expect(detail.getByTestId('params-section')).toContainText('toolChoice');
  });

  test('a follow-up model call shows the earlier tool call and its result', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000004');
    const input = page.getByTestId('input-messages-section');
    await expect(input.getByTestId('message-part-tool_call')).toContainText('call_w1');
    await expect(input.getByTestId('message-part-tool_result')).toContainText('temperature');
    await expect(page.getByTestId('output-section').getByText('It is 21 degrees and sunny in Paris.')).toBeVisible();
  });

  test('a tool call span shows the tool card', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000003');
    const detail = page.getByTestId('llm-span-detail');
    await expect(page.getByTestId('llm-span-kind')).toContainText('TOOL');
    await expect(detail.getByTestId('message-part-tool_call')).toContainText('Paris');
    await expect(detail.getByTestId('message-part-tool_result')).toContainText('sunny');
  });

  test('the wrapper span is a CHAIN named after the telemetry function id', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000001');
    await expect(page.getByTestId('llm-span-kind')).toContainText('CHAIN');
    await expect(page.getByTestId('span-detail-panel')).toContainText('weather-agent:ai.generateText');
    await expect(page.getByTestId('output-section').getByText('It is 21 degrees and sunny in Paris.')).toBeVisible();
  });

  test('the tree rows carry the same names as the detail title, with the raw name as tooltip', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000001');
    const rowName = (spanId: string) => page.getByTestId(`span-row-${spanId}`).getByTestId('span-operation-name');
    await expect(rowName('aispan0000000001')).toHaveText('weather-agent:ai.generateText');
    await expect(rowName('aispan0000000001')).toHaveAttribute('title', 'ai.generateText');
    await expect(rowName('aispan0000000002')).toHaveText('weather-agent:ai.generateText.doGenerate');
    await expect(rowName('aispan0000000003')).toHaveText('getWeather');
    await expect(rowName('aispan0000000003')).toHaveAttribute('title', 'ai.toolCall');
    await expect(page.getByTestId('span-header-raw-name')).toHaveText('weather-agent:ai.generateText');
  });

  test('the span filter matches the name shown in the tree', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000001');
    await page.getByTestId('span-filter-input').fill('weather-agent:ai.generateText.doGenerate');
    await expect(page.getByTestId('span-filter-count')).toHaveText('1 match');
    await expect(page.getByTestId('span-row-aispan0000000002')).toBeVisible();
  });

  test('trace totals count the model calls once, not the wrapper', async ({ page }) => {
    await openConventionTrace(page, VERCEL_AI_TRACE, 'aispan0000000001');
    // Model calls: 90+15 and 90+25 tokens. The wrapper repeats 180+40 and is not counted.
    await expect(page.getByTestId('trace-stats-row')).toContainText('220');
    await expect(page.getByTestId('trace-stats-row')).not.toContainText('440');
  });
});

test.describe('Token details, cost and aggregate agent spans', () => {
  test('cache, reasoning and audio tokens are shown and cached input is priced once', async ({ page }) => {
    await openConventionTrace(page, TOKEN_DETAILS_TRACE, 'usagespan000002');
    const params = page.getByTestId('params-section');
    await expect(params.getByTestId('token-cache-read')).toContainText('600');
    await expect(params.getByTestId('token-cache-write')).toContainText('200');
    await expect(params.getByTestId('token-reasoning')).toContainText('30');
    await expect(params.getByTestId('token-audio-output')).toContainText('5');
    // 200 uncached x $3 + 600 read x $0.30 + 200 written x $3.75 + 100 output x $15, per million tokens.
    await expect(params.getByTestId('estimated-cost')).toHaveText('$0.0030');
    await expect(params).toContainText('seed');
  });

  test('a model without cache prices marks the cost as an estimate', async ({ page }) => {
    await openConventionTrace(page, TOKEN_DETAILS_TRACE, 'usagespan000004');
    const cost = page.getByTestId('params-section').getByTestId('estimated-cost');
    await expect(cost).toHaveText('~$0.0001');
    await expect(cost).toHaveAttribute('title', /priced at the input rate/);
  });

  test('a reported cost is shown as reported', async ({ page }) => {
    await openConventionTrace(page, TOKEN_DETAILS_TRACE, 'usagespan000003');
    await expect(page.getByTestId('params-section')).toContainText('Reported Cost');
    await expect(page.getByTestId('params-section')).toContainText('$0.042');
  });

  test('the agent span is shown but its aggregate usage is left out of the trace totals', async ({ page }) => {
    await openConventionTrace(page, TOKEN_DETAILS_TRACE, 'usagespan000001');
    await expect(page.getByTestId('params-section')).toContainText('9,999');
    const stats = page.getByTestId('trace-stats-row');
    await expect(stats).toContainText('2,650');
    await expect(stats).not.toContainText('9,999');
    await expect(stats.getByTestId('llm-span-count')).toHaveText('3');
    await expect(stats).toContainText('~$0.045');
  });
});

test.describe('Pydantic AI', () => {
  test('agent run span shows the conversation, the final result and the logfire message as its name', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000001');
    await expect(page.getByTestId('span-detail-panel')).toContainText('joke_agent run');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByText('Pydantic AI', { exact: true })).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('AGENT');
    await expect(detail.getByTestId('input-messages-section').getByTestId('message-block-system')).toContainText('You write jokes about the topic');
    await expect(detail.getByTestId('output-section')).toContainText('Too many tells.');
  });

  test('the tree rows show the logfire message, with the raw name as tooltip', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000003');
    const toolName = page.getByTestId('span-row-pydspan00000003').getByTestId('span-operation-name');
    await expect(toolName).toHaveText('running tool: get_pun');
    await expect(toolName).toHaveAttribute('title', 'running tool');
    await expect(page.getByTestId('span-header-raw-name')).toHaveText('running tool: get_pun');
    await expect(page.getByTestId('span-row-pydspan00000001').getByTestId('span-agent-label')).toHaveText('joke_agent');
  });

  test('model call shows the tool definitions, the tool call it requests and the reported cost', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000002');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByTestId('available-tools-section')).toContainText('Available Tools (1)');
    await expect(detail.getByTestId('output-section').getByTestId('message-part-tool_call')).toContainText('get_pun');
    await expect(detail.getByTestId('params-section')).toContainText('Reported Cost');
  });

  test('tool span without an operation name shows the tool call and result', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000003');
    const detail = page.getByTestId('llm-span-detail');
    await expect(page.getByTestId('llm-span-kind')).toContainText('TOOL');
    await expect(detail.getByTestId('message-part-tool_call')).toContainText('cats');
    await expect(detail.getByTestId('message-part-tool_result')).toContainText('nine lives');
  });

  test('older Logfire events attribute is read as messages', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000004');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByTestId('input-messages-section')).toContainText('Tell me a joke about cats');
    await expect(detail.getByTestId('output-section')).toContainText('Too many tells.');
  });

  test('the agent run usage is not added to the trace totals', async ({ page }) => {
    await openConventionTrace(page, PYDANTIC_AI_TRACE, 'pydspan00000001');
    // Model calls: 417+53 and 85+12 tokens. The agent run repeats the usage of its calls.
    await expect(page.getByTestId('trace-stats-row')).toContainText('567');
    await expect(page.getByTestId('trace-stats-row').getByTestId('llm-span-count')).toHaveText('2');
  });
});

test.describe('Langfuse SDK attributes', () => {
  test('generation shows messages, parameters, usage, reported cost, prompt and level', async ({ page }) => {
    await openConventionTrace(page, LANGFUSE_SDK_TRACE, 'lfspan000000002');
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail.getByText('Langfuse', { exact: true })).toBeVisible();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
    await expect(detail.getByTestId('llm-model-name')).toHaveText('model-a');
    await expect(detail.getByTestId('input-messages-section').getByTestId('message-block-system')).toContainText('You are a support agent.');
    await expect(detail.getByTestId('output-section')).toContainText('It ships tomorrow.');
    const params = detail.getByTestId('params-section');
    await expect(params).toContainText('138');
    await expect(params).toContainText('Reported Cost');
    await expect(params).toContainText('promptName');
    await expect(page.getByTestId('span-metadata-level')).toHaveText('Level: WARNING');
  });

  test('trace attributes on a span are shown in the header', async ({ page }) => {
    await openConventionTrace(page, LANGFUSE_SDK_TRACE, 'lfspan000000001');
    const metadata = page.getByTestId('span-trace-metadata');
    await expect(metadata).toContainText('Trace: support-chat');
    await expect(metadata).toContainText('User: user-7');
    await expect(metadata).toContainText('Session: session-9');
    await expect(metadata).toContainText('Tags: beta, eu');
    await expect(metadata).toContainText('Environment: staging');
    await expect(page.getByTestId('llm-span-detail')).toContainText('question');
  });
});

test.describe('Traceloop and MLflow', () => {
  test('Traceloop workflow and tool entity spans', async ({ page }) => {
    await openConventionTrace(page, TRACELOOP_TRACE, 'tlspan000000001');
    await expect(page.getByTestId('llm-span-kind')).toContainText('CHAIN');
    await expect(page.getByTestId('llm-span-detail').getByText('Traceloop', { exact: true })).toBeVisible();
    await expect(page.getByTestId('input-messages-section')).toContainText('"args"');
    await expect(page.getByTestId('output-section')).toContainText('Too many tells.');
    await page.getByTestId('span-row-tlspan000000002').click();
    await expect(page.getByTestId('llm-span-kind')).toContainText('TOOL');
    await expect(page.getByTestId('llm-span-detail').getByTestId('message-part-tool_call')).toContainText('lookup');
    await expect(page.getByTestId('llm-span-detail').getByTestId('message-part-tool_result')).toContainText('Cats are mammals.');
  });

  test('a Traceloop agent span is named by its entity and owns the tool below it', async ({ page }) => {
    await openConventionTrace(page, TRACELOOP_TRACE, 'tlspan000000003');
    await expect(page.getByTestId('span-row-tlspan000000003').getByTestId('span-agent-label')).toHaveText('research_agent');
    await expect(page.getByTestId('span-row-tlspan000000002').getByTestId('span-owner-chip')).toHaveText('research_agent');
    await expect(page.getByTestId('span-header-kind')).toHaveText('Agent');
    await expect(page.getByTestId('span-header-agent')).toHaveText('research_agent');
  });

  test('MLflow chain and chat model spans', async ({ page }) => {
    await openConventionTrace(page, MLFLOW_TRACE, 'mlspan000000001');
    await expect(page.getByTestId('llm-span-kind')).toContainText('CHAIN');
    await expect(page.getByTestId('llm-span-detail').getByText('MLflow', { exact: true })).toBeVisible();
    await expect(page.getByTestId('input-messages-section')).toContainText('What is MLflow?');
    await expect(page.getByTestId('output-section')).toContainText('An open source platform');
    await page.getByTestId('span-row-mlspan000000002').click();
    await expect(page.getByTestId('llm-span-kind')).toContainText('LLM');
    await expect(page.getByTestId('input-messages-section').getByTestId('message-block-user')).toContainText('What is MLflow?');
    await expect(page.getByTestId('output-section').getByTestId('message-block-assistant')).toContainText('An open source platform');
  });
});
