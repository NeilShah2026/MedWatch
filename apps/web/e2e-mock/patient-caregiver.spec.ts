import { expect, test } from '@playwright/test';
import { expectAccessible, expectHealthy, signIn, trackErrors } from './support';

test('patient: today, dose, tailored check-in, medicines', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, 'patient1@demo.medwatch');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId('dose-progress')).toBeVisible();
  await expectHealthy(page);
  await expectAccessible(page, '/me');

  const card = page
    .getByTestId('dose-card')
    .filter({ has: page.getByRole('button', { name: 'I took it' }) })
    .first();
  await card.getByRole('button', { name: 'I took it' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/me/checkin');
  await expect(page.getByTestId('checkin-flow').or(page.getByTestId('checkin-done'))).toBeVisible();
  if (await page.getByTestId('checkin-done').isVisible())
    await page.getByRole('button', { name: 'Change today’s answers' }).click();
  await page.getByRole('radio', { name: /Good/ }).first().click();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const q = page.getByTestId('checkin-question');
    if (!(await q.isVisible().catch(() => false))) break;
    seen.push((await q.getAttribute('data-symptom')) ?? '');
    if (i === 0) await expectAccessible(page, '/me/checkin');
    if (seen.at(-1) === 'drowsiness') {
      await page.getByRole('button', { name: 'Yes', exact: true }).click();
      await page.getByRole('radio', { name: 'Some' }).click();
    } else {
      await page.getByRole('button', { name: 'No', exact: true }).click();
    }
  }
  expect(seen.slice(0, 4)).toEqual([
    'fall_or_near_fall',
    'confusion',
    'dizziness',
    'shortness_of_breath',
  ]);
  expect(seen).toContain('drowsiness');
  await expectAccessible(page, 'extra');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Send check-in' }).click();
  await expect(page.getByTestId('checkin-done')).toContainText('Thank you!');
  await expect(page.getByTestId('checkin-done')).toContainText('Drowsiness');

  await page.getByRole('link', { name: 'My medicines' }).first().click();
  await expect(page.getByTestId('medicine-row').first()).toBeVisible();
  await expectAccessible(page, '/me/medicines');
  expect(errors).toEqual([]);
});

test('caregiver: people, confirm a dose, tabs, forbidden URL', async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, 'caregiver1@demo.medwatch');
  await expect(page).toHaveURL(/\/care$/);
  await expect(page.getByTestId('person-card')).toHaveCount(2);
  await expectAccessible(page, '/care');
  await page.getByTestId('person-card').first().click();
  await expect(page.getByRole('tab', { name: 'Today' })).toBeVisible();
  const given = page.getByRole('button', { name: 'Given' }).first();
  if (await given.isVisible().catch(() => false)) {
    await given.click();
    await expect(page.getByText('Confirmed by caregiver').first()).toBeVisible();
    await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0);
  }
  await expectAccessible(page, 'care today');
  for (const tab of ['Check-in', 'Medicines', 'Flags', 'Summary']) {
    await page.getByRole('tab', { name: tab }).click();
    await expectHealthy(page);
    await expectAccessible(page, `care ${tab}`);
  }
  await page.getByRole('tab', { name: 'Flags' }).click();
  await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Why?' }).first()).toBeVisible();

  await page.goto('/care/00000000-0000-4000-8000-000000000000');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await page.goto('/clinic');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  expect(errors).toEqual([]);
});
