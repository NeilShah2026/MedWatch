import { expect, test } from '@playwright/test';
import { hasBackend, users } from './support/env';
import { expectAccessible, signIn } from './support/helpers';
import { ensurePendingDoseToday, linkedPatientIds, unlinkedPatientId } from './support/data';

// E2E 2: caregiver confirms a dose for a linked patient and cannot open an unlinked patient by URL.
test.describe('caregiver', () => {
  test.skip(!hasBackend, 'needs the cloud dev project (see PROGRESS.md)');

  test('confirms a dose on behalf of a linked patient', async ({ page }) => {
    const [linked] = await linkedPatientIds(users.caregiver1);
    await ensurePendingDoseToday(linked!);
    await signIn(page, users.caregiver1);
    await expect(page).toHaveURL(/\/care$/);
    await expect(page.getByTestId('person-card')).toHaveCount(2);
    await expectAccessible(page);

    await page.goto(`/care/${linked}`);
    const card = page
      .getByTestId('dose-card')
      .filter({ has: page.getByRole('button', { name: 'Given' }) })
      .first();
    await card.getByRole('button', { name: 'Given' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await expect(page.getByText('Confirmed by caregiver').first()).toBeVisible();
    await expectAccessible(page);

    for (const tab of ['Medicines', 'Flags', 'Summary']) {
      await page.getByRole('tab', { name: tab }).click();
      await expectAccessible(page);
    }
  });

  test('cannot open an unlinked patient by URL', async ({ page }) => {
    const other = await unlinkedPatientId(users.caregiver1);
    await signIn(page, users.caregiver1);
    await page.goto(`/care/${other}`);
    await expect(page.getByTestId('forbidden')).toBeVisible();
    await expect(page.getByTestId('dose-card')).toHaveCount(0);
  });
});
