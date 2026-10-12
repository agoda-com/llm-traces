import type { Page } from '@playwright/test';

export async function waitForToolbarLayout(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="plugin-toolbar"] textarea', { timeout: 10000 });
  await page.evaluate(async () => {
    const toolbar = document.querySelector('[data-testid="plugin-toolbar"]') as HTMLElement;
    await new Promise<void>((resolve) => {
      let previousHeight = toolbar.getBoundingClientRect().height;
      let stableFrames = 0;
      const check = () => {
        const height = toolbar.getBoundingClientRect().height;
        stableFrames = Math.abs(height - previousHeight) < 0.5 ? stableFrames + 1 : 0;
        previousHeight = height;
        if (stableFrames >= 3) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  });
}
