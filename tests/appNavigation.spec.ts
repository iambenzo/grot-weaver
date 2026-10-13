import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('app pages', () => {
  test('overview renders without working backends', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Overview}`);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText(/Scored against semantic conventions/)).toBeVisible({ timeout: 30000 });
  });

  test('service page renders without working backends', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Service}`);
    await expect(page.getByRole('heading', { name: 'Service' })).toBeVisible();
    await expect(page.getByText('Semantic convention findings for one service, and where to fix them.')).toBeVisible();
  });
});
