/**
 * Span tree behaviour: indent guides, the resizable name column, and the collapse controls with their shortcuts.
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { DEEP_NESTED_SEARCH_RESPONSE, DEEP_NESTED_TRACE_RESPONSE } from './fixtures/llm-trace';
import { CHAIN_TRACE_ID, makeChainTrace } from './fixtures/large-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const DEEP_ROWS = 22;
const deepSpanId = (depth: number) => `deepspan${String(depth).padStart(8, '0')}`;

async function mockTempo(page: Page, search: unknown, trace: unknown) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(search) }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trace) }));
}

async function openDeepTrace(page: Page) {
  await mockTempo(page, DEEP_NESTED_SEARCH_RESPONSE, DEEP_NESTED_TRACE_RESPONSE);
  await page.goto(PLUGIN_URL);
  await page.getByTestId('trace-explorer').waitFor();
  await page.locator('[data-testid^="trace-item-"]').first().click();
  await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
}

const row = (page: Page, depth: number) => page.getByTestId(`span-row-${deepSpanId(depth)}`);
const guideOf = (page: Page, depth: number, ancestorId: string) =>
  row(page, depth).locator(`[data-testid="span-indent-guide"][data-ancestor-id="${ancestorId}"]`);

/** The colour of the guide's 1px line. */
const lineColor = (guide: Locator) =>
  guide.evaluate((element) => window.getComputedStyle(element, '::before').backgroundColor);

test.describe('Indent guides', () => {
  test.beforeEach(async ({ page }) => openDeepTrace(page));

  test('a span has one guide per ancestor plus a root guide, counted from the root', async ({ page }) => {
    for (const depth of [0, 1, 3]) {
      const guides = row(page, depth).getByTestId('span-indent-guide');
      await expect(guides, `guides of the span at depth ${depth}`).toHaveCount(depth + 1);
    }
    const expectedIds = ['root', ...Array.from({ length: 21 }, (_, depth) => deepSpanId(depth))];
    const ids = await row(page, 21).getByTestId('span-indent-guide').evaluateAll((guides) =>
      guides.map((guide) => (guide as HTMLElement).dataset.ancestorId));
    expect(ids.length, 'the deepest row has more guides than fit').toBeLessThan(22);
    expect(ids, 'the guides nearest the root are the ones drawn').toEqual(expectedIds.slice(0, ids.length));
  });

  test('guides that do not fit are replaced by a +N marker with a tooltip', async ({ page }) => {
    // The span at depth 20 has 21 guides and a chevron.
    const deep = row(page, 20);
    const drawn = await deep.getByTestId('span-indent-guide').count();
    const marker = deep.getByTestId('span-hidden-levels');
    await expect(marker).toHaveText(`+${21 - drawn}`);
    await expect(marker).toHaveAttribute('title', `${21 - drawn} more levels`);
    await expect(row(page, 2).getByTestId('span-hidden-levels'), 'no marker when everything fits').toHaveCount(0);

    const box = (await marker.boundingBox())!;
    const chevron = (await deep.locator('svg').first().boundingBox())!;
    const lastGuide = (await deep.getByTestId('span-indent-guide').last().boundingBox())!;
    expect(box.x + box.width, 'the marker sits just before the chevron').toBeLessThanOrEqual(chevron.x + chevron.width);
    expect(chevron.x - (box.x + box.width), 'the marker is next to the chevron').toBeLessThanOrEqual(4);
    expect(box.x, 'the marker comes after the last drawn guide').toBeGreaterThan(lastGuide.x + lastGuide.width - 1);
  });

  test('the same ancestor has the same x on every row', async ({ page }) => {
    const xs = await page.getByTestId('span-list-pane').evaluate((pane) => {
      const byAncestor = new Map<string, number[]>();
      pane.querySelectorAll('[data-testid="span-indent-guide"]').forEach((guide) => {
        const id = (guide as HTMLElement).dataset.ancestorId!;
        byAncestor.set(id, [...(byAncestor.get(id) ?? []), guide.getBoundingClientRect().left]);
      });
      return Array.from(byAncestor, ([id, lefts]) => ({ id, spread: Math.max(...lefts) - Math.min(...lefts), rows: lefts.length }));
    });
    expect(xs.filter(({ rows }) => rows > 1).length, 'ancestors drawn on several rows').toBeGreaterThanOrEqual(3);
    for (const { id, spread } of xs) {
      expect(spread, `x spread of the guide of ${id}`).toBeLessThanOrEqual(1);
    }
  });

  test('indent grows by one guide per level', async ({ page }) => {
    const left = async (depth: number) =>
      (await row(page, depth).locator('[data-testid="span-indent-guide"]').last().boundingBox())!.x;
    const step = (await left(2)) - (await left(1));
    expect(step).toBeGreaterThan(12);
    expect(await left(3)).toBeCloseTo(await left(1) + 2 * step, 0);
    expect(await left(4)).toBeCloseTo(await left(1) + 3 * step, 0);
  });

  test('hovering a guide highlights that ancestor line in all of its descendants', async ({ page }) => {
    const ancestor = deepSpanId(1);
    const idle = await lineColor(guideOf(page, 10, ancestor));
    await guideOf(page, 10, ancestor).hover();
    const active = await lineColor(guideOf(page, 10, ancestor));
    expect(active).not.toBe(idle);
    for (let depth = 2; depth < DEEP_ROWS; depth++) {
      expect(await lineColor(guideOf(page, depth, ancestor)), `descendant at depth ${depth}`).toBe(active);
    }
    expect(await lineColor(guideOf(page, 10, deepSpanId(0))), 'a different ancestor stays idle').toBe(idle);

    const highlighted = await page.getByTestId('span-list-pane').evaluate((pane, color) =>
      Array.from(pane.querySelectorAll('[data-testid="span-indent-guide"]'))
        .filter((guide) => window.getComputedStyle(guide, '::before').backgroundColor === color)
        .map((guide) => ({ id: (guide as HTMLElement).dataset.ancestorId, left: guide.getBoundingClientRect().left })), active);
    expect(highlighted.length, 'one highlighted guide in every descendant row').toBe(DEEP_ROWS - 2);
    expect(new Set(highlighted.map((guide) => guide.id))).toEqual(new Set([ancestor]));
    const lefts = highlighted.map((guide) => guide.left);
    expect(Math.max(...lefts) - Math.min(...lefts), 'the highlighted line is one straight vertical line').toBeLessThanOrEqual(1);

    await page.mouse.move(0, 0);
    await expect.poll(() => lineColor(guideOf(page, 10, ancestor))).toBe(idle);
  });

  test('hovering the root guide highlights the root line in every row', async ({ page }) => {
    const idle = await lineColor(guideOf(page, 5, 'root'));
    await guideOf(page, 5, 'root').hover();
    const active = await lineColor(guideOf(page, 5, 'root'));
    expect(active).not.toBe(idle);
    expect(await lineColor(guideOf(page, 20, 'root'))).toBe(active);
  });

  test('hovering the chevron of a parent highlights its line in the children', async ({ page }) => {
    const idle = await lineColor(guideOf(page, 8, deepSpanId(1)));
    await row(page, 1).locator('svg').first().hover();
    const active = await lineColor(guideOf(page, 8, deepSpanId(1)));
    expect(active).not.toBe(idle);
    expect(await lineColor(guideOf(page, 8, deepSpanId(0))), 'the line of the parent above stays idle').toBe(idle);
  });

  test('long names are cut with an ellipsis and keep the full name as a tooltip next to the duration', async ({ page }) => {
    const pane = page.getByTestId('span-list-pane');
    const deepest = row(page, 21);
    const name = deepest.locator('span[title^="Pydantic AI Claude loop"]');
    await expect(name).toHaveAttribute('title', /cannot fit$/);
    const box = (await name.boundingBox())!;
    const duration = (await deepest.locator('> div').nth(1).boundingBox())!;
    expect(box.width, 'the name keeps some room').toBeGreaterThan(20);
    expect(box.x + box.width, 'the name ends before the duration').toBeLessThanOrEqual(duration.x + 1);
    expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});

test.describe('Name column', () => {
  test.beforeEach(async ({ page }) => openDeepTrace(page));

  const headerCell = (page: Page) => page.getByTestId('span-list-name-header');
  const rowCell = (page: Page, depth: number) => row(page, depth).locator('> div').first();

  /** Presses the handle, moves to `fraction` of the row and, unless `release` is false, lets go there. */
  async function dragHandleTo(page: Page, fraction: number, release = true) {
    const geometry = await page.evaluate((fraction) => {
      const handle = document.querySelector('[data-testid="resize-handle-name-column"]') as HTMLElement;
      const header = handle.closest('[data-testid="span-list-name-header"]')!.parentElement as HTMLElement;
      const rect = header.getBoundingClientRect();
      const style = window.getComputedStyle(header);
      const left = rect.left + parseFloat(style.paddingLeft);
      const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const handleRect = handle.getBoundingClientRect();
      return { x: left + fraction * width, y: handleRect.top + handleRect.height / 2, startX: handleRect.left + 3 };
    }, fraction);
    await page.evaluate(({ x, y, startX, release }) => {
      const handle = document.querySelector('[data-testid="resize-handle-name-column"]') as HTMLElement;
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: y, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
      if (release) {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      }
    }, { ...geometry, release });
    return geometry;
  }

  const contentWidth = (page: Page) => page.getByTestId('span-list-pane').evaluate((pane) => pane.clientWidth - 16);
  const cssFraction = (page: Page) =>
    page.getByTestId('span-list-pane').evaluate((pane) => parseFloat(pane.style.getPropertyValue('--llt-name-column')));

  test('is 0.4 of the row by default and lines up with the rows', async ({ page }) => {
    const width = await contentWidth(page);
    const header = (await headerCell(page).boundingBox())!;
    expect(header.width).toBeCloseTo(0.4 * width, 0);
    for (const depth of [0, 10, 21]) {
      const cell = (await rowCell(page, depth).boundingBox())!;
      expect(cell.x, `name cell left at depth ${depth}`).toBeCloseTo(header.x, 0);
      expect(cell.width, `name cell width at depth ${depth}`).toBeCloseTo(header.width, 0);
    }
    const headerDuration = (await page.getByTestId('span-list-pane').getByText('Duration', { exact: true }).boundingBox())!;
    const rowDuration = (await row(page, 0).locator('> div').nth(1).boundingBox())!;
    expect(headerDuration.x + headerDuration.width).toBeCloseTo(rowDuration.x + rowDuration.width, 0);
  });

  test('is resized by dragging the handle, and the rows follow when the button is released', async ({ page }) => {
    const before = (await rowCell(page, 4).boundingBox())!.width;
    const { x, y } = await dragHandleTo(page, 0.6, false);
    await expect(page.getByTestId('name-column-ghost')).toBeVisible();
    const ghost = (await page.getByTestId('name-column-ghost').boundingBox())!;
    expect(ghost.x + ghost.width / 2).toBeCloseTo(x, 0);
    expect((await rowCell(page, 4).boundingBox())!.width, 'columns stay put while dragging').toBeCloseTo(before, 0);

    await page.evaluate(({ x, y }) => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y })), { x, y });
    await expect(page.getByTestId('name-column-ghost')).toHaveCount(0);
    expect((await rowCell(page, 4).boundingBox())!.width).toBeGreaterThan(before + 30);
  });

  test('moves to the dragged position', async ({ page }) => {
    await dragHandleTo(page, 0.6);
    const width = await contentWidth(page);
    expect(await cssFraction(page)).toBeCloseTo(0.6, 2);
    expect((await headerCell(page).boundingBox())!.width).toBeCloseTo(0.6 * width, 0);
    expect((await rowCell(page, 7).boundingBox())!.width).toBeCloseTo(0.6 * width, 0);
  });

  test('stays between 0.2 and 0.85', async ({ page }) => {
    await dragHandleTo(page, 0.01);
    expect(await cssFraction(page)).toBeCloseTo(0.2, 3);
    await dragHandleTo(page, 0.99);
    expect(await cssFraction(page)).toBeCloseTo(0.85, 3);
  });

  test('keeps the duration and timeline columns inside the pane at the widest setting', async ({ page }) => {
    await dragHandleTo(page, 0.99);
    const pane = (await page.getByTestId('span-list-pane').boundingBox())!;
    const duration = (await row(page, 0).locator('> div').nth(1).boundingBox())!;
    const bar = (await row(page, 0).locator('> div').nth(2).boundingBox())!;
    expect(duration.x + duration.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(bar.width, 'the timeline keeps room').toBeGreaterThanOrEqual(40);
    expect(await page.getByTestId('span-list-pane').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test('is remembered after a reload', async ({ page }) => {
    await dragHandleTo(page, 0.55);
    expect(await cssFraction(page)).toBeCloseTo(0.55, 2);
    // The trace id is in the URL, so the reload opens the same trace again.
    await page.reload();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
    expect(await cssFraction(page)).toBeCloseTo(0.55, 2);
  });
});

test.describe('Collapse controls', () => {
  test.beforeEach(async ({ page }) => openDeepTrace(page));

  test('Collapse +1 and Expand +1 move one level at a time', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse +1' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 1);
    await expect(row(page, 21)).toHaveCount(0);
    await page.getByRole('button', { name: 'Collapse +1' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 2);

    await page.getByRole('button', { name: 'Expand +1' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 1);
    await page.getByRole('button', { name: 'Expand +1' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
  });

  test('Collapse all and Expand all', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse all spans' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Expand all spans' }).click();
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
  });

  test('keyboard: ] collapses all, [ expands all, p collapses one level, o expands one level', async ({ page }) => {
    await page.keyboard.press(']');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(1);
    await page.keyboard.press('[');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
    await page.keyboard.press('p');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 1);
    await page.keyboard.press('p');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 2);
    await page.keyboard.press('o');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS - 1);
  });

  test('keyboard shortcuts are ignored while typing in the filter box', async ({ page }) => {
    await page.getByTestId('span-filter-input').click();
    await page.keyboard.type('p]o[');
    await expect(page.getByTestId('span-filter-input')).toHaveValue('p]o[');
    await page.getByTestId('span-filter-input').fill('step');
    await expect(page.getByTestId('span-filter-count')).toHaveText(`${DEEP_ROWS - 1} matches`);
    await page.getByTestId('span-filter-input').press('p');
    await expect(page.getByTestId('span-filter-input')).toHaveValue('stepp');
  });

  test('keyboard shortcuts keep working with a browser modifier held', async ({ page }) => {
    await page.keyboard.press('Control+p');
    await page.keyboard.press('Meta+]');
    await expect(page.locator('[data-testid^="span-row-"]')).toHaveCount(DEEP_ROWS);
  });
});

test.describe('1,000-level chain', () => {
  test('has guides on every row and never overflows the pane', async ({ page }) => {
    const chain = makeChainTrace(1000);
    await mockTempo(page, chain.searchResponse, chain.traceResponse);
    await page.goto(PLUGIN_URL);
    await page.getByTestId(`trace-item-${CHAIN_TRACE_ID}`).click();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible({ timeout: 60_000 });

    const pane = page.getByTestId('span-list-pane');
    await expect(pane.getByTestId('span-indent-guide').first()).toBeVisible();
    const stats = await pane.evaluate((element) => {
      const rows = Array.from(element.querySelectorAll('[data-testid^="span-row-"]'));
      const paneRect = element.getBoundingClientRect();
      return {
        rows: rows.length,
        minGuides: Math.min(...rows.map((r) => r.querySelectorAll('[data-testid="span-indent-guide"]').length)),
        markers: rows.filter((r) => r.querySelector('[data-testid="span-hidden-levels"]')).length,
        overflow: element.scrollWidth - element.clientWidth,
        wide: rows.filter((r) => r.getBoundingClientRect().right > paneRect.right + 0.5).length,
      };
    });
    expect(stats.rows).toBeLessThan(200);
    expect(stats.minGuides, 'every rendered row shows guides').toBeGreaterThanOrEqual(1);
    expect(stats.markers, 'rows deeper than the guide area show how many levels are hidden').toBe(stats.rows);
    expect(stats.overflow, 'the pane does not scroll sideways').toBeLessThanOrEqual(0);
    expect(stats.wide, 'no row is wider than the pane').toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('Far-away ancestors', () => {
  test('get a narrow guide once their row is outside the rendered rows', async ({ page }) => {
    // The widest name column leaves room for narrow and normal guides side by side.
    await page.addInitScript(() => window.localStorage.setItem('agoda-llmtraces-app.nameColumnFraction', '0.85'));
    await page.setViewportSize({ width: 1800, height: 900 });
    const chain = makeChainTrace(150);
    await mockTempo(page, chain.searchResponse, chain.traceResponse);
    await page.goto(PLUGIN_URL);
    await page.getByTestId(`trace-item-${CHAIN_TRACE_ID}`).click();
    await expect(page.getByTestId('llm-span-detail')).toBeVisible();
    await page.getByTestId('span-list-pane').evaluate((pane) => { pane.scrollTop = 50 * 36; });
    await page.waitForTimeout(500);

    const result = await page.getByTestId('span-list-pane').evaluate((pane) => {
      const indexOf = (id: string) => parseInt(id.slice(2), 16);
      const rows = Array.from(pane.querySelectorAll('[data-testid^="span-row-"]'));
      const rendered = rows.map((r) => indexOf((r as HTMLElement).dataset.testid!.replace('span-row-', '')));
      const first = Math.min(...rendered);
      const last = Math.max(...rendered);
      const lefts = new Map<string, number[]>();
      const widths = { near: [] as number[], far: [] as number[] };
      for (const row of rows) {
        const guides = Array.from(row.querySelectorAll('[data-testid="span-indent-guide"]'));
        guides.forEach((guide, i) => {
          const id = (guide as HTMLElement).dataset.ancestorId!;
          lefts.set(id, [...(lefts.get(id) ?? []), guide.getBoundingClientRect().left]);
          if (id === 'root' || i === guides.length - 1) { return; }
          (indexOf(id) < first ? widths.far : indexOf(id) <= last ? widths.near : []).push(guide.getBoundingClientRect().width);
        });
      }
      const maxSpread = Math.max(...Array.from(lefts.values(), (l) => Math.max(...l) - Math.min(...l)));
      return { first, ...widths, maxSpread };
    });
    expect(result.first, 'some rows above are not rendered').toBeGreaterThan(0);
    expect(result.far.length).toBeGreaterThan(0);
    expect(result.near.length).toBeGreaterThan(0);
    for (const width of result.near) { expect(width).toBeGreaterThanOrEqual(14); }
    for (const width of result.far) { expect(width).toBeLessThanOrEqual(8); }
    expect(result.maxSpread, 'a mix of narrow and normal guides still puts each ancestor at one x').toBeLessThanOrEqual(1);
  });
});
