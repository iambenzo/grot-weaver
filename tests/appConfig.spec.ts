import { test, expect } from './fixtures';

test('saves app settings', async ({ appConfigPage, page }) => {
  await expect(page.getByText('Default window')).toBeVisible();
  await page
    .getByRole('switch', { name: /weight scores by volume/i })
    .or(page.getByLabel(/weight scores by volume/i))
    .first()
    .click({ force: true });

  const saveResponse = appConfigPage.waitForSettingsResponse();
  await page.getByRole('button', { name: /save settings/i }).click();
  await expect(saveResponse).toBeOK();
});
