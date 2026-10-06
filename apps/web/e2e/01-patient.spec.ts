import { expect, test } from '@playwright/test';
import { hasBackend, users } from './support/env';
import { expectAccessible, signIn } from './support/helpers';
import { ensurePendingDoseToday, selfPatientId } from './support/data';

// E2E 1: patient signs in, marks a dose taken, completes a tailored check-in.
test.describe('patient', () => {
  test.skip(!hasBackend, 'needs the cloud dev project (see PROGRESS.md)');

  test('marks a dose taken and completes a tailored check-in', async ({ page }) => {
    await ensurePendingDoseToday(await selfPatientId());
    await signIn(page, users.patient1);
    await expect(page).toHaveURL(/\/me$/);
    await expectAccessible(page);

    const card = page
      .getByTestId('dose-card')
      .filter({ has: page.getByRole('button', { name: 'I took it' }) })
      .first();
    await card.getByRole('button', { name: 'I took it' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page
      .getByRole('link', { name: /check-in/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/me\/checkin/);
    const edit = page.getByRole('button', { name: 'Change today’s answers' });
    if (await edit.isVisible().catch(() => false)) await edit.click();
    await page.getByRole('radio', { name: /Good/ }).first().click();

    // Tailored questions: patient 1 takes a sleep medicine, so drowsiness is asked.
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const q = page.getByTestId('checkin-question');
      if (!(await q.isVisible().catch(() => false))) break;
      seen.push((await q.getAttribute('data-symptom')) ?? '');
      await page.getByRole('button', { name: 'No', exact: true }).click();
    }
    expect(seen.slice(0, 4)).toEqual([
      'fall_or_near_fall',
      'confusion',
      'dizziness',
      'shortness_of_breath',
    ]);
    expect(seen).toContain('drowsiness');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Send check-in' }).click();
    await expect(page.getByTestId('checkin-done')).toContainText('Thank you!');
  });

  test('my medicines is read-only and passes axe', async ({ page }) => {
    await signIn(page, users.patient1);
    await page.getByRole('link', { name: 'My medicines' }).first().click();
    await expect(page.getByTestId('medicine-row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /edit|stop/i })).toHaveCount(0);
    await expectAccessible(page);
  });
});
