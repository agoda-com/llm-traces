/**
 * Opening a trace must not scroll the Grafana page window: the plugin toolbar (title, data source
 * picker, time picker, Search button) has to stay on screen. Only the plugin's own panes may scroll.
 */

import { test, expect, Page } from '@playwright/test';
import { SEARCH_RESPONSE, TRACE_RESPONSE } from './fixtures/llm-trace';
import { waitForToolbarLayout } from './waitForToolbarLayout';

const PLUGIN_URL = '/a/llm-traces-app';

async function mockTempo(page: Page) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_RESPONSE) }));
}

async function expectToolbarOnScreen(page: Page) {
  await waitForToolbarLayout(page);
  // Smooth scrolling animates for several hundred milliseconds, so give it time to move the window.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.scrollY), 'window.scrollY after opening a trace').toBe(0);

  const search = page.getByTestId('plugin-toolbar').getByRole('button', { name: /search/i }).first();
  const box = await search.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(box, 'Search button is rendered').not.toBeNull();
  expect(box!.y, 'Search button top is inside the viewport').toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, 'Search button bottom is inside the viewport').toBeLessThanOrEqual(viewportHeight);
}

test.describe('Opening a trace keeps the plugin toolbar on screen', () => {
  test('auto-open on page load', async ({ page }) => {
    await mockTempo(page);
    await page.goto(PLUGIN_URL);
    await expect(page.getByTestId('span-list-pane')).toBeVisible({ timeout: 15_000 });
    await expectToolbarOnScreen(page);
  });

  test('deep link', async ({ page }) => {
    await mockTempo(page);
    await page.goto(`${PLUGIN_URL}?llt-traceId=${SEARCH_RESPONSE.traces[0].traceID}`);
    await expect(page.getByTestId('span-list-pane')).toBeVisible({ timeout: 15_000 });
    await expectToolbarOnScreen(page);
  });

  test('clicking a trace in the list', async ({ page }) => {
    await mockTempo(page);
    await page.goto(PLUGIN_URL);
    await expect(page.getByTestId('span-list-pane')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`trace-item-${SEARCH_RESPONSE.traces[1].traceID}`).click();
    await expect(page.getByTestId('span-list-pane')).toBeVisible();
    await expectToolbarOnScreen(page);
  });
});
