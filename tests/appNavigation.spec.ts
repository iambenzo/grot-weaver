import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('service page', () => {
  test('renders without a working trace backend', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Service}`);
    await expect(page.getByRole('heading', { name: 'Service' })).toBeVisible();
    await expect(page.getByText('Semantic convention findings for one service, and where to fix them.')).toBeVisible();
  });
});
