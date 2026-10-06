import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/helpers';

// Runs without a backend: public pages render, show the demo banner, and pass axe.
test.describe('public pages', () => {
  for (const path of ['/signin', '/forgot-password', '/privacy', '/terms', '/about-flags']) {
    test(`${path} renders with the demo banner and passes axe`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId('demo-banner')).toHaveText(
        'Demo environment — synthetic data only. Not for clinical use.',
      );
      await expectAccessible(page);
    });
  }

  test('legal pages are marked as drafts needing attorney review', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByTestId('draft-banner')).toHaveText('DRAFT — requires attorney review');
    await page.goto('/terms');
    await expect(page.getByTestId('draft-banner')).toBeVisible();
  });

  test('protected routes redirect to sign-in', async ({ page }) => {
    await page.goto('/clinic');
    await expect(page).toHaveURL(/\/signin\?next=%2Fclinic/);
  });
});
