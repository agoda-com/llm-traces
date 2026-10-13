import { test, expect, Locator } from '@playwright/test';
import {
  ADK_SEARCH_RESPONSE,
  ADK_TRACE_RESPONSE,
  ADK_UNCAPTURED_TRACE_RESPONSE,
  DEEP_NESTED_SEARCH_RESPONSE,
  DEEP_NESTED_TRACE_RESPONSE,
  TOOL_VISUALIZATION_SEARCH_RESPONSE,
  TOOL_VISUALIZATION_TRACE_RESPONSE,
} from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

interface VisibleRect {
  left: number;
  right: number;
  width: number;
  /** False when an ancestor cuts the element, so only a fragment of it shows. */
  whole: boolean;
}

// An item that does not fit a row wraps onto a clipped second line: it keeps a layout box but nothing of it is painted.
// This returns, for each element, the part that is painted (its box cut by every ancestor that clips overflow),
// or null when nothing is painted.
async function visibleRects(locator: Locator): Promise<Array<VisibleRect | null>> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      let { left, right, top, bottom } = box;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clip = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      if (right - left <= 0.5 || bottom - top <= 0.5) {
        return null;
      }
      return { left, right, width: right - left, whole: right - left >= box.width - 0.5 && bottom - top >= box.height - 0.5 };
    })
  );
}

test.describe('Tool visualization', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TOOL_VISUALIZATION_SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TOOL_VISUALIZATION_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.getByTestId('trace-explorer').waitFor();
    await page.locator('[data-testid^="trace-item-"]').first().click();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('shows a collapsed searchable catalog with one expanded definition', async ({ page }) => {
    const section = page.getByTestId('available-tools-section');
    await expect(section.getByText('Available Tools (3)', { exact: true })).toBeVisible();
    await expect(section.getByTestId('tool-catalog-search')).not.toBeVisible();

    await section.getByRole('button', { name: 'Available Tools (3)' }).click();
    const search = section.getByTestId('tool-catalog-search');
    await expect(search).toBeVisible();
    await search.fill('memory');
    await expect(section.getByText('save_memory', { exact: true })).toBeVisible();
    await expect(section.getByText('get_jira_issue', { exact: true })).not.toBeVisible();
    await search.fill('future sessions');
    await expect(section.getByText('save_memory', { exact: true })).toBeVisible();
    await search.fill('missing tool');
    await expect(section.getByText('No tools match', { exact: true })).toBeVisible();

    await search.fill('');
    const jiraRow = section.getByTestId('tool-definition-row-0');
    const invalidRow = section.getByTestId('tool-definition-row-2');
    await expect(invalidRow.getByText('Invalid tool definition', { exact: true })).toBeVisible();
    const jiraDisclosure = jiraRow.locator('button[aria-expanded]');
    await jiraDisclosure.click();
    await expect(jiraDisclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(jiraRow.getByText('issue_key', { exact: true })).toBeVisible();
    await expect(jiraRow.locator('tbody td').filter({ hasText: /^Required$/ })).toBeVisible();
    await expect(jiraRow.getByText('Jira issue key.', { exact: true })).toBeVisible();
    await expect(jiraRow.getByText('non-strict', { exact: true })).toBeVisible();
    await expect(jiraRow.getByText('array', { exact: true })).toBeVisible();
    await expect(jiraRow.locator('tbody td').filter({ hasText: 'summary' })).toBeVisible();
    await expect(jiraRow.getByText('Raw schema', { exact: true })).toBeVisible();

    await jiraRow.getByRole('button', { name: 'Copy get_jira_issue definition' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('get_jira_issue');
    await jiraRow.getByText('Raw schema', { exact: true }).click();
    await expect(jiraRow.getByText('"issue_key"', { exact: false })).toBeVisible();

    const memoryRow = section.getByTestId('tool-definition-row-1');
    const memoryDisclosure = memoryRow.locator('button[aria-expanded]');
    await memoryDisclosure.click();
    await expect(jiraDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(memoryDisclosure).toHaveAttribute('aria-expanded', 'true');
  });

  test('links structured calls and results without changing message order', async ({ page }) => {
    const input = page.getByTestId('input-messages-section');
    const call = input.getByTestId('message-part-tool_call').filter({ hasText: 'get_jira_issue' });
    const result = input.getByTestId('message-part-tool_result').filter({ hasText: 'call_jira_1' });

    await expect(call.getByText('Tool call', { exact: true })).toBeVisible();
    await expect(call.getByText('get_jira_issue', { exact: true })).toBeVisible();
    await expect(call.getByText('issue_key', { exact: true })).toBeVisible();
    await expect(call.getByText('PROJ-123', { exact: false })).toBeVisible();
    await expect(result.getByText('Tool result', { exact: true })).toBeVisible();
    await expect(result.getByText('get_jira_issue', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tool-correlation-chip').filter({ hasText: 'call_jira_1' })).toHaveCount(2);

    await call.getByRole('button', { name: 'Copy get_jira_issue arguments' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('issue_key');

    const roles = await page.locator('[data-testid^="message-block-"]').evaluateAll((messages) =>
      messages.map((message) => message.getAttribute('data-testid'))
    );
    expect(roles.slice(0, 3)).toEqual(['message-block-user', 'message-block-assistant', 'message-block-tool']);
  });

  test('renders a short array argument inline instead of one item per line', async ({ page }) => {
    const call = page.getByTestId('message-part-tool_call').filter({ hasText: 'call_jira_1' });
    const value = call.locator('dt', { hasText: /^fields$/ }).locator('xpath=following-sibling::dd');
    await expect(value).toHaveText('["summary", "status", "description"]');
    expect(await value.evaluate((element) => (element as HTMLElement).innerText.includes('\n'))).toBe(false);
  });

  test('renders an ordered OpenInference tool use once in the output sequence', async ({ page }) => {
    const output = page.getByTestId('output-section');
    const orderedMessage = output.getByTestId('message-block-assistant');
    const orderedParts = await orderedMessage.locator('[data-testid^="message-part-"]').evaluateAll((parts) =>
      parts.map((part) => part.getAttribute('data-testid'))
    );

    expect(orderedParts).toEqual(['message-part-reasoning', 'message-part-tool_call', 'message-part-text']);
    await expect(orderedMessage.getByTestId('message-part-tool_call')).toHaveCount(1);
    await expect(orderedMessage.getByText('get_jira_issue', { exact: true })).toBeVisible();
    await expect(orderedMessage.getByText('wrong_duplicate_name', { exact: true })).toHaveCount(0);

    const result = output.getByTestId('message-part-tool_result');
    await expect(result.getByText('get_jira_issue', { exact: true })).toBeVisible();
    await expect(result.getByText('wrong_duplicate_name', { exact: true })).toHaveCount(0);
  });

  test('bounds a large result and copies the complete value', async ({ page }) => {
    const result = page.getByTestId('message-part-tool_result').filter({ hasText: 'call_jira_1' });
    const preview = result.getByTestId('tool-result-preview');
    await expect(result.getByRole('button', { name: 'Show full result' })).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    await result.getByRole('button', { name: 'Copy tool result' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Detailed Jira result line 16');

    await result.getByRole('button', { name: 'Show full result' }).click();
    await expect(result.getByRole('button', { name: 'Collapse result' })).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollHeight === element.clientHeight)).toBe(true);
    await result.getByRole('button', { name: 'Collapse result' }).click();
    await expect(result.getByRole('button', { name: 'Show full result' })).toBeVisible();
  });

  test('keeps invalid and unmatched tool payloads visible', async ({ page }) => {
    const invalidCall = page.getByTestId('message-part-tool_call').filter({ hasText: 'custom_tool' });
    const unmatchedResult = page.getByTestId('message-part-tool_result').filter({ hasText: 'orphan_result' });
    await expect(invalidCall.getByText('{broken-arguments', { exact: true })).toBeVisible();
    await expect(unmatchedResult.getByText('not-json-result', { exact: true })).toBeVisible();
    await expect(unmatchedResult.getByText('Tool result', { exact: true })).toBeVisible();
  });

  test('does not clip a result without a full-result control', async ({ page }) => {
    const result = page.getByTestId('message-part-tool_result').filter({ hasText: 'orphan_result' });
    const preview = result.getByTestId('tool-result-preview');
    await expect(result.getByRole('button', { name: 'Show full result' })).toHaveCount(0);
    await expect(preview).toHaveCSS('max-height', 'none');
    expect(await preview.evaluate((element) => element.scrollHeight === element.clientHeight)).toBe(true);
  });

  test('gives a direct trace usable detail width at a 1024 pixel viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const traceId = TOOL_VISUALIZATION_SEARCH_RESPONSE.traces[0].traceID;
    await page.goto(`${PLUGIN_URL}?llt-traceId=${traceId}`);
    const detail = page.getByTestId('llm-span-detail');
    await expect(detail).toBeVisible();
    expect((await detail.boundingBox())!.width).toBeGreaterThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await expect(page.getByRole('button', { name: 'Expand trace list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse span list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse detail panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand trace list' }).click();
    await expect(page.getByTestId('trace-list-pane')).toBeVisible();
    await expect(page.getByTestId('resize-handle-trace-list')).toBeVisible();
  });

  for (const width of [800, 1024, 1440]) {
    test(`keeps span list labels from overlapping at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PLUGIN_URL);
      await page.getByTestId('trace-explorer').waitFor();
      await page.locator('[data-testid^="trace-item-"]').first().click();
      await expect(page.getByTestId('llm-span-detail')).toBeVisible();

      const pane = page.getByTestId('span-list-pane');
      const row = page.getByTestId('span-row-toolspan00000001');
      const [service] = await visibleRects(row.getByText('tool-service', { exact: true }));
      const name = await row.getByTitle('ChatCompletion', { exact: true }).boundingBox();
      const duration = await row.getByText('2.20s', { exact: true }).boundingBox();
      if (service) {
        expect(service.whole, 'a visible service name must not be cut into a fragment').toBe(true);
        expect(service.left, 'service name must start after the span name').toBeGreaterThanOrEqual(name!.x + name!.width - 1);
        expect(service.right, 'service name must end before the duration').toBeLessThanOrEqual(duration!.x + 1);
      }
      expect(name!.x + name!.width, 'span name must end before the duration').toBeLessThanOrEqual(duration!.x + 1);
      expect(name!.width, 'span name must stay readable').toBeGreaterThanOrEqual(60);

      const timestamp = await page.locator('[data-testid^="trace-item-"]').first().getByText(/UTC$/).boundingBox();
      expect(timestamp!.height, 'trace timestamp must stay on one line').toBeLessThan(20);

      const labelGap = await pane.evaluate((element) => {
        const textRect = (label: string) => {
          const el = Array.from(element.querySelectorAll('span')).find((node) => node.textContent === label)!;
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect();
        };
        return textRect('Duration').left - textRect('Span').right;
      });
      expect(labelGap, 'header labels must not touch').toBeGreaterThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  for (const width of [800, 1440]) {
    test(`truncates long nested span names before the duration at ${width}px`, async ({ page }) => {
      await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEEP_NESTED_SEARCH_RESPONSE) });
      });
      await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEEP_NESTED_TRACE_RESPONSE) });
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PLUGIN_URL);
      await page.getByTestId('trace-explorer').waitFor();
      await page.locator('[data-testid^="trace-item-"]').first().click();
      await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(22);

      const overlaps = async () => {
        const found: Array<{ text: string | null; right: number; durationLeft: number }> = [];
        const rows = page.locator('[data-testid^="span-row-"]');
        for (let i = 0; i < (await rows.count()); i++) {
          const row = rows.nth(i);
          const duration = await row.getByTestId('span-duration').boundingBox();
          const names = row.locator('span[title]');
          const rects = await visibleRects(names);
          for (let j = 0; j < rects.length; j++) {
            const rect = rects[j];
            if (rect && rect.right > duration!.x + 1) {
              found.push({ text: await names.nth(j).textContent(), right: rect.right, durationLeft: duration!.x });
            }
          }
        }
        return found;
      };

      expect(await overlaps(), 'span names must end before the duration').toEqual([]);
      await page.getByRole('button', { name: 'AI only', exact: true }).click();
      expect(await overlaps(), 'span names must end before the duration with AI only').toEqual([]);
    });
  }

  for (const width of [560, 800]) {
    test(`keeps the toolbar buttons inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PLUGIN_URL);
      await page.getByTestId('trace-explorer').waitFor();
      for (const name of ['Search', 'Share', 'Collapse toolbar']) {
        const box = await page.getByTestId('plugin-toolbar').getByRole('button', { name, exact: true }).boundingBox();
        expect(box!.x + box!.width, `${name} must not be clipped`).toBeLessThanOrEqual(width);
      }
    });
  }

  test('keeps catalog identifiers readable in a narrow detail panel', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const traceId = TOOL_VISUALIZATION_SEARCH_RESPONSE.traces[0].traceID;
    await page.goto(`${PLUGIN_URL}?llt-traceId=${traceId}`);
    const section = page.getByTestId('available-tools-section');
    await section.getByRole('button', { name: 'Available Tools (3)' }).click();
    const memoryRow = section.getByTestId('tool-definition-row-1');
    await memoryRow.locator('button[aria-expanded]').click();

    const identifierCell = memoryRow.locator('tbody td').filter({ hasText: /^memory_type$/ });
    const metrics = await identifierCell.evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const lineTops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
      return { lineCount: lineTops.size, width: cell.getBoundingClientRect().width };
    });
    expect(metrics.lineCount).toBe(1);
    expect(metrics.width).toBeGreaterThanOrEqual(112);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('Google ADK spans', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADK_SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADK_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.getByTestId('trace-explorer').waitFor();
    await page.locator('[data-testid^="trace-item-"]').first().click();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('shows a call_llm span with an LLM badge, system and user messages, tool cards, output and tool catalog', async ({ page }) => {
    await expect(page.getByTestId('llm-span-kind')).toHaveText('LLM');
    await expect(page.getByTestId('llm-model-name')).toHaveText('gemini-2.5-flash');

    const input = page.getByTestId('input-messages-section');
    const system = input.getByTestId('message-block-system');
    await expect(system).toContainText('You are a trip planning assistant.');
    await expect(system).toContainText('Café or Zürich');
    await expect(system).toContainText('Sample code point: A.');
    await expect(input.getByTestId('message-block-user').first()).toContainText('Find me a flight from Paris to Rome. Destination note: 英語');
    await expect(input.getByTestId('message-block-ag-context')).toContainText('Traveler prefers morning departures.');

    const call = input.getByTestId('message-part-tool_call');
    await expect(call.getByText('search_flights', { exact: true })).toBeVisible();
    await expect(call.getByText('FCO', { exact: false })).toBeVisible();
    const result = input.getByTestId('message-part-tool_result');
    await expect(result.getByText('search_flights', { exact: true })).toBeVisible();
    await expect(result.getByText('FL100', { exact: false })).toBeVisible();
    await expect(page.getByTestId('tool-correlation-chip').filter({ hasText: 'adk-call-1' })).toHaveCount(2);

    await expect(page.getByTestId('output-section').getByTestId('message-block-model')).toContainText('You are all set for FL100.');

    const catalog = page.getByTestId('available-tools-section');
    await expect(catalog.getByText('Available Tools (2)', { exact: true })).toBeVisible();
    await catalog.getByRole('button', { name: 'Available Tools (2)' }).click();
    await expect(catalog.getByText('search_flights', { exact: true })).toBeVisible();
    await expect(catalog.getByText('book_flight', { exact: true })).toBeVisible();
  });

  test('lists the request and response attributes as shown above', async ({ page }) => {
    const toggle = page.getByTestId('llm-attrs-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId('span-attrs-table').getByText('gcp.vertex.agent.llm_request', { exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(page.getByTestId('span-attrs-table').getByText('gcp.vertex.agent.llm_request', { exact: true })).toBeVisible();
    await expect(page.getByTestId('span-attrs-table').getByText('gcp.vertex.agent.llm_response', { exact: true })).toBeVisible();
  });

  test('shows an empty state when the model returned an empty text part', async ({ page }) => {
    await page.getByTestId('span-row-adkspan0004').click();
    const output = page.getByTestId('output-section');
    await expect(output.getByTestId('message-block-model')).toBeVisible();
    await expect(output.getByText('(empty)')).toBeVisible();
  });

  test('shows an execute_tool span as a tool call and a tool result', async ({ page }) => {
    await page.getByTestId('span-row-adkspan0003').click();
    await expect(page.getByTestId('llm-span-kind')).toHaveText('TOOL');
    const input = page.getByTestId('input-messages-section');
    await expect(input.getByTestId('message-part-tool_call').getByText('search_flights', { exact: true })).toBeVisible();
    await expect(input.getByTestId('message-part-tool_call').getByText('CDG', { exact: false })).toBeVisible();
    const output = page.getByTestId('output-section');
    await expect(output.getByTestId('message-part-tool_result').getByText('FL100', { exact: false })).toBeVisible();
    await expect(page.getByTestId('tool-correlation-chip').filter({ hasText: 'adk-call-1' })).toHaveCount(2);
  });

  test('counts only model calls as LLM spans in the trace summary', async ({ page }) => {
    await expect(page.getByTestId('llm-span-count')).toHaveText('2');
  });
});

test.describe('Google ADK spans without captured content', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADK_SEARCH_RESPONSE) });
    });
    await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADK_UNCAPTURED_TRACE_RESPONSE) });
    });
    await page.goto(PLUGIN_URL);
    await page.getByTestId('trace-explorer').waitFor();
    await page.locator('[data-testid^="trace-item-"]').first().click();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
  });

  test('explains that message content was not captured and still shows model and token usage', async ({ page }) => {
    const notice = page.getByTestId('content-notice');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText('Message content was not captured for this span (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS is disabled).');
    await expect(page.getByTestId('input-messages-section')).toHaveCount(0);
    await expect(page.getByTestId('llm-model-name')).toHaveText('gemini-2.5-flash');
    await expect(page.getByTestId('llm-span-kind')).toHaveText('LLM');
    await expect(page.getByTestId('params-section').getByText('420', { exact: true })).toBeVisible();
  });

  test('explains the same for an execute_tool span without tool cards', async ({ page }) => {
    await page.getByTestId('span-row-adkspan0003').click();
    await expect(page.getByTestId('llm-span-kind')).toHaveText('TOOL');
    await expect(page.getByTestId('content-notice')).toHaveText('Message content was not captured for this span (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS is disabled).');
    await expect(page.getByTestId('message-part-tool_call')).toHaveCount(0);
    await expect(page.getByTestId('message-part-tool_result')).toHaveCount(0);
  });

  test('explains when ADK could not serialize the request or response', async ({ page }) => {
    await page.getByTestId('span-row-adkspan0004').click();
    const notices = page.getByTestId('content-notice');
    await expect(notices).toHaveCount(2);
    await expect(notices.nth(0)).toHaveText('ADK could not serialize the request for this span.');
    await expect(notices.nth(1)).toHaveText('ADK could not serialize the response for this span.');
    await expect(page.getByTestId('llm-model-name')).toHaveText('gemini-2.5-flash');
  });
});
