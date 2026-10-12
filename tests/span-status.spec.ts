/**
 * Span status parsing tests.
 *
 * Verifies that all OTLP status code formats are correctly detected and
 * displayed — and that the attribute table is never polluted with synthetic
 * status tags when the status comes from the OTLP status object.
 *
 * Formats tested:
 *   1. status.code = 'STATUS_CODE_ERROR'  (standard OTel SDK enum string)
 *   2. status.code = 'ERROR'              (bare string, some SDKs)
 *   3. status.code = 2                    (numeric, proto3 JSON)
 *   4. otel.status_code attribute         (attribute-based fallback)
 *   5. status.code = 'STATUS_CODE_OK'     (must NOT be an error)
 *   6. no status field at all             (must NOT be an error)
 */

import { test, expect, Page } from '@playwright/test';
import { STATUS_TEST_TRACE_RESPONSE } from './fixtures/llm-trace';
import { SEARCH_RESPONSE } from './fixtures/llm-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';

async function setup(page: Page) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) })
  );
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_TEST_TRACE_RESPONSE) })
  );
  await page.goto(PLUGIN_URL);
  await page.waitForSelector('[data-testid="trace-explorer"]');
  await page.click('[data-testid^="trace-item-"]');
  await page.waitForSelector('[data-testid^="span-row-"]');
}

test.describe('Span status — OTLP status object parsing', () => {

  // ── 1. STATUS_CODE_ERROR enum string ──────────────────────────────────────
  test('STATUS_CODE_ERROR shows error dot and Status: error', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-err-enum');
    await expect(row).toBeVisible();
    await expect(row.locator('[title="Error span"]')).toBeVisible();
    await page.click('[data-testid="span-row-st-err-enum"]');
    await expect(page.getByTestId('span-status-error')).toBeVisible();
    await expect(page.getByTestId('span-status-error')).toContainText('Status: error');
  });

  test('STATUS_CODE_ERROR shows status message from status.message', async ({ page }) => {
    await setup(page);
    await page.click('[data-testid="span-row-st-err-enum"]');
    await expect(page.getByTestId('span-status-message')).toContainText('enum string error message');
  });

  test('STATUS_CODE_ERROR does NOT inject otel.status_code into attribute table', async ({ page }) => {
    await setup(page);
    await page.click('[data-testid="span-row-st-err-enum"]');
    // The detail panel must not contain a synthetic otel.status_code attribute row.
    // (the span has no attributes — only the status object; the table may be hidden/empty)
    await expect(page.getByTestId('span-detail-panel')).not.toContainText('otel.status_code');
  });

  // ── 2. Bare "ERROR" string ────────────────────────────────────────────────
  test('bare ERROR string shows error dot', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-err-bare');
    await expect(row.locator('[title="Error span"]')).toBeVisible();
    await page.click('[data-testid="span-row-st-err-bare"]');
    await expect(page.getByTestId('span-status-error')).toBeVisible();
    await expect(page.getByTestId('span-status-message')).toContainText('bare string error message');
  });

  // ── 3. Numeric code 2 ─────────────────────────────────────────────────────
  test('numeric status code 2 shows error dot', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-err-num');
    await expect(row.locator('[title="Error span"]')).toBeVisible();
    await page.click('[data-testid="span-row-st-err-num"]');
    await expect(page.getByTestId('span-status-error')).toBeVisible();
    await expect(page.getByTestId('span-status-message')).toContainText('numeric code error message');
  });

  // ── 4. Attribute-based fallback ───────────────────────────────────────────
  test('otel.status_code attribute fallback shows error dot', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-err-attr');
    await expect(row.locator('[title="Error span"]')).toBeVisible();
    await page.click('[data-testid="span-row-st-err-attr"]');
    await expect(page.getByTestId('span-status-error')).toBeVisible();
    await expect(page.getByTestId('span-status-message')).toContainText('attribute error message');
  });

  test('otel.status_code attribute appears in attribute table (it is a real attribute)', async ({ page }) => {
    await setup(page);
    await page.click('[data-testid="span-row-st-err-attr"]');
    const attrTable = page.getByTestId('span-attrs-table');
    // When the status comes from an attribute, that attribute IS in the table
    await expect(attrTable).toContainText('otel.status_code');
  });

  // ── 5. STATUS_CODE_OK — not an error ─────────────────────────────────────
  test('STATUS_CODE_OK span has no error dot', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-ok');
    await expect(row).toBeVisible();
    await expect(row.locator('[title="Error span"]')).not.toBeVisible();
    await page.click('[data-testid="span-row-st-ok"]');
    await expect(page.getByTestId('span-status-error')).not.toBeVisible();
  });

  // ── 6. No status at all — not an error ───────────────────────────────────
  test('span with no status field has no error dot', async ({ page }) => {
    await setup(page);
    const row = page.getByTestId('span-row-st-none');
    await expect(row).toBeVisible();
    await expect(row.locator('[title="Error span"]')).not.toBeVisible();
    await page.click('[data-testid="span-row-st-none"]');
    await expect(page.getByTestId('span-status-error')).not.toBeVisible();
  });

});
