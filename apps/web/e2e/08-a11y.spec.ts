import { expect, test } from '@playwright/test';
import { hasBackend, users } from './support/env';
import { expectAccessible, signIn } from './support/helpers';
import { linkedPatientIds } from './support/data';

// E2E 8: axe (WCAG 2.1 AA) on each main page, per role.
test.describe('accessibility of main pages', () => {
  test.skip(!hasBackend, 'needs the cloud dev project (see PROGRESS.md)');

  test('patient pages', async ({ page }) => {
    await signIn(page, users.patient1);
    for (const p of ['/me', '/me/checkin', '/me/medicines']) {
      await page.goto(p);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectAccessible(page);
    }
  });

  test('caregiver pages', async ({ page }) => {
    const [pid] = await linkedPatientIds(users.caregiver1);
    await signIn(page, users.caregiver1);
    await expectAccessible(page);
    await page.goto(`/care/${pid}`);
    for (const tab of ['Today', 'Check-in', 'Medicines', 'Flags', 'Summary']) {
      await page.getByRole('tab', { name: tab }).click();
      await expectAccessible(page);
    }
  });

  test('nurse patient detail tabs', async ({ page }) => {
    const [pid] = await linkedPatientIds(users.patient1);
    await signIn(page, users.nurse1);
    await page.goto(`/clinic/patients/${pid}`);
    for (const tab of [
      'Timeline',
      'Medications',
      'Flags',
      'Doses',
      'Symptoms',
      'Summary',
      'People',
    ]) {
      await page.getByRole('tab', { name: tab }).click();
      await expectAccessible(page);
    }
  });
});
