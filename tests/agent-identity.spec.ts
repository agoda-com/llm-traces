/**
 * Agent identity in the span tree: kind icons, agent names, per-agent colour rails, owner chips, handoffs,
 * shrink priority on narrow layouts, and the agent details in the span detail header.
 */

import { test, expect, Page, Locator } from '@playwright/test';
import {
  AGENT_DESCRIPTIONS,
  AGENT_SEARCH_RESPONSE,
  AGENT_SPAN_IDS as IDS,
  AGENT_TRACE_ID,
  AGENT_TRACE_RESPONSE,
  LONG_AGENT_DESCRIPTION,
  PRICING_AGENT_NAME,
} from './fixtures/agent-trace';

const PLUGIN_URL = '/a/agoda-llmtraces-app';
const NAME_COLUMN_STORAGE_KEY = 'agoda-llmtraces-app.nameColumnFraction';

async function openAgentTrace(page: Page, options: { theme?: 'light' | 'dark'; nameColumn?: number } = {}) {
  await page.route('**/api/datasources/proxy/uid/**/api/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENT_SEARCH_RESPONSE) }));
  await page.route('**/api/datasources/proxy/uid/**/api/traces/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENT_TRACE_RESPONSE) }));
  if (options.nameColumn !== undefined) {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [NAME_COLUMN_STORAGE_KEY, String(options.nameColumn)]);
  }
  await page.goto(options.theme ? `${PLUGIN_URL}?theme=${options.theme}` : PLUGIN_URL);
  await page.getByTestId(`trace-item-${AGENT_TRACE_ID}`).click();
  await expect(page.getByTestId(`span-row-${IDS.plain}`)).toBeVisible();
}

const row = (page: Page, spanId: string) => page.getByTestId(`span-row-${spanId}`);
const railColor = (rail: Locator) => rail.evaluate((element) => window.getComputedStyle(element).backgroundColor);

const AGENT_ROWS = [IDS.coordinator, IDS.flightPlanner, IDS.hotelPlanner, IDS.pricingAgent];

test.describe('Agent names and kind icons', () => {
  test.beforeEach(async ({ page }) => openAgentTrace(page));

  test('an agent row shows the agent name from the attribute or the span name, and keeps the raw span name in its tooltip', async ({ page }) => {
    const expected: Array<[string, string, string]> = [
      [IDS.coordinator, 'coordinator', 'invoke_agent coordinator'],
      [IDS.flightPlanner, 'flight_planner', 'invoke_agent flight_planner_run'],
      [IDS.hotelPlanner, 'hotel_planner', 'invoke_agent hotel_planner'],
    ];
    for (const [spanId, agentName, rawName] of expected) {
      const label = row(page, spanId).getByTestId('span-agent-label');
      await expect(label, agentName).toHaveText(agentName);
      await expect(label).toHaveAttribute('title', rawName);
      expect(Number(await label.evaluate((element) => window.getComputedStyle(element).fontWeight)), 'the agent name is bold').toBeGreaterThanOrEqual(600);
      await expect(row(page, spanId), 'the raw span name is not drawn in the row').not.toContainText('invoke_agent');
    }
  });

  test('rows show a kind icon with an accessible name and no text badge', async ({ page }) => {
    const expected: Array<[string, string]> = [
      [IDS.root, 'Chain'],
      [IDS.coordinator, 'Agent'],
      [IDS.coordinatorLlm, 'LLM'],
      [IDS.flightTool, 'Tool'],
    ];
    for (const [spanId, kindName] of expected) {
      const icon = row(page, spanId).getByTestId('span-kind-icon');
      await expect(icon, kindName).toHaveAttribute('role', 'img');
      await expect(icon).toHaveAttribute('aria-label', kindName);
      await expect(icon).toHaveAttribute('title', kindName);
      await expect(icon.locator('svg'), `${kindName} icon is drawn`).toBeVisible();
    }
    for (const text of ['AGENT', 'LLM', 'TOOL', 'CHAIN']) {
      await expect(row(page, IDS.coordinatorLlm).getByText(text, { exact: true }), `no ${text} text badge`).toHaveCount(0);
    }
    await expect(row(page, IDS.plain).getByTestId('span-kind-icon'), 'a span without a kind has no icon').toHaveCount(0);
  });
});

test.describe('Ownership and handoffs', () => {
  test.beforeEach(async ({ page }) => openAgentTrace(page));

  test('spans owned by an agent show the nearest agent as a chip; agents and unowned spans show none', async ({ page }) => {
    const expected: Array<[string, string]> = [
      [IDS.coordinatorLlm, 'coordinator'],
      [IDS.summaryTool, 'coordinator'],
      [IDS.flightLlm, 'flight_planner'],
      [IDS.flightTool, 'flight_planner'],
      [IDS.hotelLlm, 'hotel_planner'],
      [IDS.pricingLlm, PRICING_AGENT_NAME],
    ];
    for (const [spanId, owner] of expected) {
      await expect(row(page, spanId).getByTestId('span-owner-chip'), spanId).toHaveText(owner);
    }
    for (const spanId of [...AGENT_ROWS, IDS.root, IDS.plain]) {
      await expect(row(page, spanId).getByTestId('span-owner-chip'), `${spanId} has no chip`).toHaveCount(0);
    }
  });

  test('an agent handed work by another agent says where it came from', async ({ page }) => {
    await expect(row(page, IDS.flightPlanner).getByTestId('span-handoff-from')).toHaveText('from coordinator');
    await expect(row(page, IDS.hotelPlanner).getByTestId('span-handoff-from')).toHaveText('from coordinator');
    await expect(row(page, IDS.pricingAgent).getByTestId('span-handoff-from')).toHaveText('from hotel_planner');
    await expect(row(page, IDS.coordinator).getByTestId('span-handoff-from'), 'a top-level agent was handed nothing').toHaveCount(0);
    await expect(row(page, IDS.flightLlm).getByTestId('span-handoff-from'), 'only agent rows show handoffs').toHaveCount(0);
  });

  test('the spans of one agent share a rail colour at the left edge, and each agent has its own', async ({ page }) => {
    const rails = new Map<string, string>();
    const owners: Array<[string, string]> = [
      [IDS.coordinator, 'coordinator'], [IDS.coordinatorLlm, 'coordinator'], [IDS.summaryTool, 'coordinator'],
      [IDS.flightPlanner, 'flight_planner'], [IDS.flightLlm, 'flight_planner'], [IDS.flightTool, 'flight_planner'],
      [IDS.hotelPlanner, 'hotel_planner'], [IDS.hotelLlm, 'hotel_planner'],
      [IDS.pricingAgent, PRICING_AGENT_NAME], [IDS.pricingLlm, PRICING_AGENT_NAME],
    ];
    for (const [spanId, owner] of owners) {
      const rail = row(page, spanId).getByTestId('span-agent-rail');
      await expect(rail, spanId).toHaveAttribute('data-agent', owner);
      const color = await railColor(rail);
      expect(color, `${spanId} rail is painted`).not.toBe('rgba(0, 0, 0, 0)');
      if (!rails.has(owner)) { rails.set(owner, color); }
      expect(color, `${spanId} has the rail colour of ${owner}`).toBe(rails.get(owner));

      const rowBox = (await row(page, spanId).boundingBox())!;
      const railBox = (await rail.boundingBox())!;
      expect(Math.abs(railBox.x - rowBox.x), `${spanId} rail is at the left edge`).toBeLessThanOrEqual(1);
      expect(railBox.width, `${spanId} rail is thin`).toBeLessThanOrEqual(4);
      expect(railBox.height, `${spanId} rail spans the row`).toBeGreaterThanOrEqual(rowBox.height - 2);
    }
    expect(new Set(rails.values()).size, 'four agents, four colours').toBe(4);
    for (const spanId of [IDS.root, IDS.plain]) {
      await expect(row(page, spanId).getByTestId('span-agent-rail'), `${spanId} has no owner and no rail`).toHaveCount(0);
    }
  });

  test('selecting an owned row keeps its rail', async ({ page }) => {
    await row(page, IDS.flightLlm).click();
    await expect(row(page, IDS.flightLlm).getByTestId('span-agent-rail')).toBeVisible();
  });
});

test.describe('Agent colours in both themes', () => {
  const luminance = (rgb: string) => {
    const [r, g, b] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const theme of ['light', 'dark'] as const) {
    test(`rail colours are stable across reloads and readable on the ${theme} theme`, async ({ page }) => {
      await openAgentTrace(page, { theme });
      const background = await row(page, IDS.plain).evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const color = window.getComputedStyle(node).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { return color; }
        }
        return 'rgb(255, 255, 255)';
      });
      const colors: string[] = [];
      for (const spanId of AGENT_ROWS) {
        const color = await railColor(row(page, spanId).getByTestId('span-agent-rail'));
        colors.push(color);
        expect(contrast(color, background), `${spanId} rail ${color} on ${background}`).toBeGreaterThanOrEqual(3);
      }

      await openAgentTrace(page, { theme });
      const again: string[] = [];
      for (const spanId of AGENT_ROWS) {
        again.push(await railColor(row(page, spanId).getByTestId('span-agent-rail')));
      }
      expect(again, 'same agents, same colours').toEqual(colors);
    });
  }
});

test.describe('Optional row items in narrow layouts', () => {
  const cases = [
    { width: 1440, nameColumn: 0.85 },
    { width: 1440, nameColumn: 0.6 },
    { width: 1440, nameColumn: 0.4 },
    { width: 800, nameColumn: 0.4 },
    { width: 800, nameColumn: 0.2 },
  ];
  const SLACK = 1.5;
  const NAME_GAP_MAX = 8;

  interface ItemState { state: 'visible' | 'hidden' | 'partial'; fitsWhole: boolean }

  for (const { width, nameColumn } of cases) {
    test(`at ${width}px wide with the name column at ${nameColumn}: the service name, owner chip and "from" are shown whole or not at all; nothing overlaps`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAgentTrace(page, { nameColumn });

      const measurements = await page.locator('[data-testid^="span-row-"]').evaluateAll((rows) => rows.map((rowElement) => {
        const part = (testId: string) => rowElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
        const nameCell = part('span-name-cell')!.getBoundingClientRect();
        const nameText = part('span-agent-label') ?? part('span-operation-name')!;
        const nameBox = nameText.getBoundingClientRect();
        const kindIcon = part('span-kind-icon');
        // An item sits in a one-line group that clips its overflow: inside the group's box it is drawn whole,
        // on the clipped second line it is not drawn at all.
        const itemState = (item: HTMLElement | null): ItemState | null => {
          if (!item) { return null; }
          const box = item.getBoundingClientRect();
          const group = item.parentElement!.getBoundingClientRect();
          const inside = box.top >= group.top - 1 && box.bottom <= group.bottom + 1 && box.left >= group.left - 1 && box.right <= group.right + 1
            && box.left >= nameCell.left - 1 && box.right <= nameCell.right + 1;
          const hidden = box.top >= group.bottom - 1;
          return { state: inside ? 'visible' : hidden ? 'hidden' : 'partial', fitsWhole: item.scrollWidth <= item.clientWidth + 1 };
        };
        return {
          id: (rowElement as HTMLElement).dataset.testid,
          name: { shown: nameBox.width, natural: nameText.scrollWidth },
          // The name follows the kind icon, or starts the name column when the row has no kind icon.
          gapBeforeName: nameBox.left - (kindIcon ? kindIcon.getBoundingClientRect().right : part('span-name-content')!.getBoundingClientRect().left),
          nameRight: nameBox.right,
          serviceLeft: part('span-service-name')?.getBoundingClientRect().left ?? null,
          visibleName: Math.max(0, Math.min(nameBox.right, nameCell.right) - nameBox.left),
          service: itemState(part('span-service-name')),
          chip: itemState(part('span-owner-chip')),
          from: itemState(part('span-handoff-from')),
          nameCellRight: nameCell.right,
          durationLeft: part('span-duration')!.getBoundingClientRect().left,
          overlaps: (() => {
            const boxes = Array.from(part('span-name-content')!.children)
              .map((child) => child.getBoundingClientRect())
              .filter((box) => box.width > 1);
            const found: string[] = [];
            boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) { found.push(`${Math.round(a.left)}-${Math.round(a.right)} and ${Math.round(b.left)}-${Math.round(b.right)}`); }
            }));
            return found;
          })(),
        };
      }));

      for (const m of measurements) {
        expect(m.nameCellRight, `${m.id}: the name cell ends before the duration`).toBeLessThanOrEqual(m.durationLeft + SLACK);
        expect(m.overlaps, `${m.id}: the parts of the name column do not overlap`).toEqual([]);
        expect(m.gapBeforeName, `${m.id}: the name starts right after the kind icon, with no blank gap`).toBeLessThanOrEqual(NAME_GAP_MAX);
        const nameCut = m.name.shown + SLACK < m.name.natural;
        if (m.service?.state === 'visible') {
          expect(m.serviceLeft!, `${m.id}: the service name follows the span name`).toBeGreaterThanOrEqual(m.nameRight - SLACK);
          for (const [label, item] of [['owner chip', m.chip], ['"from"', m.from]] as const) {
            if (item) { expect(item.state, `${m.id}: the service name is hidden before the ${label}`).toBe('visible'); }
          }
        }
        for (const [label, item] of [['service name', m.service], ['owner chip', m.chip], ['"from"', m.from]] as const) {
          if (!item) { continue; }
          expect(item.state, `${m.id}: the ${label} is whole or hidden, never a fragment`).not.toBe('partial');
          if (item.state === 'visible') {
            // The service name may end in an ellipsis of its own; the chip and "from" cut only the agent name inside them.
            if (label !== 'service name') { expect(item.fitsWhole, `${m.id}: the visible ${label} is not cut inside its box`).toBe(true); }
            expect(nameCut, `${m.id}: the ${label} is gone before the name is cut`).toBe(false);
          }
        }
      }

      const byId = (spanId: string) => measurements.find((m) => m.id === `span-row-${spanId}`)!;
      if (nameColumn >= 0.85) {
        expect(byId(IDS.coordinatorLlm).chip!.state, 'with a wide name column a short owner chip is shown').toBe('visible');
        expect(byId(IDS.hotelPlanner).from!.state, 'and so is a short "from"').toBe('visible');
      }
      if (nameColumn <= 0.4) {
        expect(byId(IDS.pricingLlm).chip!.state, 'with a narrow name column the chip is hidden').toBe('hidden');
        expect(byId(IDS.pricingAgent).from!.state, 'and so is "from"').toBe('hidden');
      }
      if (nameColumn === 0.4) {
        for (const m of measurements) {
          expect(m.visibleName, `${m.id}: the name stays readable`).toBeGreaterThanOrEqual(30);
        }
      }
    });
  }
});

test.describe('Detail header', () => {
  test.beforeEach(async ({ page }) => openAgentTrace(page));

  test('an agent span shows its kind, name, handoff and description, and keeps the raw span name', async ({ page }) => {
    await row(page, IDS.flightPlanner).click();
    const header = page.getByTestId('span-detail-panel');
    await expect(header.getByTestId('span-header-kind')).toHaveText('Agent');
    await expect(header.getByTestId('span-header-kind').getByTestId('span-kind-icon')).toHaveAttribute('aria-label', 'Agent');
    await expect(header.getByTestId('span-header-agent')).toHaveText('flight_planner');
    await expect(header.getByTestId('span-header-handoff')).toHaveText('handed off from coordinator');
    await expect(header.getByTestId('span-header-agent-description')).toHaveText(AGENT_DESCRIPTIONS.flightPlanner);
    await expect(header.getByTestId('span-header-raw-name'), 'the raw span name stays in the detail').toContainText('invoke_agent flight_planner_run');
  });

  test('a top-level agent has a description but no handoff', async ({ page }) => {
    await row(page, IDS.coordinator).click();
    const header = page.getByTestId('span-detail-panel');
    await expect(header.getByTestId('span-header-agent')).toHaveText('coordinator');
    await expect(header.getByTestId('span-header-agent-description')).toHaveText(AGENT_DESCRIPTIONS.coordinator);
    await expect(header.getByTestId('span-header-handoff')).toHaveCount(0);
  });

  test('an agent without a description shows none', async ({ page }) => {
    await row(page, IDS.hotelPlanner).click();
    const header = page.getByTestId('span-detail-panel');
    await expect(header.getByTestId('span-header-handoff')).toHaveText('handed off from coordinator');
    await expect(header.getByTestId('span-header-agent-description')).toHaveCount(0);
  });

  test('a long agent description is clamped to three lines and expands on request', async ({ page }) => {
    await row(page, IDS.pricingAgent).click();
    const header = page.getByTestId('span-detail-panel');
    const description = header.getByTestId('span-header-agent-description');
    const toggle = header.getByTestId('span-header-agent-description-toggle');
    const lineHeight = await description.evaluate((element) => parseFloat(window.getComputedStyle(element).lineHeight));
    const height = async () => (await description.boundingBox())!.height;

    await expect(description, 'the clamp hides text, it does not remove it').toHaveText(LONG_AGENT_DESCRIPTION);
    expect(await height()).toBeLessThanOrEqual(3 * lineHeight + 1);
    await expect(toggle).toHaveText('Show more');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    expect(await height()).toBeGreaterThan(6 * lineHeight);
    await expect(toggle).toHaveText('Show less');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    expect(await height()).toBeLessThanOrEqual(3 * lineHeight + 1);
    await expect(toggle).toHaveText('Show more');
  });

  test('a short agent description has no toggle', async ({ page }) => {
    await row(page, IDS.coordinator).click();
    await expect(page.getByTestId('span-header-agent-description')).toBeVisible();
    await expect(page.getByTestId('span-header-agent-description-toggle')).toHaveCount(0);
  });

  test('a tool span shows its kind and owner agent, without handoff or description', async ({ page }) => {
    await row(page, IDS.flightTool).click();
    const header = page.getByTestId('span-detail-panel');
    await expect(header.getByTestId('span-header-kind')).toHaveText('Tool');
    await expect(header.getByTestId('span-header-agent')).toHaveText('flight_planner');
    await expect(header.getByTestId('span-header-handoff')).toHaveCount(0);
    await expect(header.getByTestId('span-header-agent-description')).toHaveCount(0);
  });

  test('a span outside every agent shows no agent', async ({ page }) => {
    await row(page, IDS.plain).click();
    const header = page.getByTestId('span-detail-panel');
    await expect(header.getByTestId('span-header-agent')).toHaveCount(0);
    await expect(header.getByTestId('span-header-kind')).toHaveCount(0);
  });
});
