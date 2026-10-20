import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';
import { testIds } from '../src/components/testIds';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violationsIn(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help}`);
}

test.describe('accessibility', () => {
  test('overview has no WCAG A or AA violations', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Overview}`);
    await expect(page.getByText(/Scored against semantic conventions/)).toBeVisible({ timeout: 30000 });
    expect(await violationsIn(page)).toEqual([]);
  });

  test('service page has no WCAG A or AA violations', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Service}`);
    await expect(page.getByText('Semantic convention findings for one service, and where to fix them.')).toBeVisible();
    await expect(page.getByTestId(testIds.status.panel)).toBeVisible({ timeout: 30000 });
    expect(await violationsIn(page)).toEqual([]);
  });

  test('settings page has no WCAG A or AA violations', async ({ appConfigPage, page }) => {
    await expect(page.getByText('Default window')).toBeVisible();
    expect(await violationsIn(page)).toEqual([]);
  });
});
