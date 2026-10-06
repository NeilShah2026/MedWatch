import { expect, type Page } from '@playwright/test';

export function isoDaysAgo(n: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() - n * 864e5),
  );
}

export async function addMedication(page: Page, name: string, drugClass: string, daysAgo: number) {
  await page.getByRole('tab', { name: 'Medications' }).click();
  await page.getByRole('button', { name: 'Add medicine' }).click();
  const form = page.getByTestId('medication-form');
  await form.getByLabel('Medicine name').fill(name);
  await form.getByLabel('Drug class').selectOption(drugClass);
  await form.getByLabel('Dose amount').fill('25');
  await form.getByLabel('Times of day').fill('21:00');
  await form.getByLabel('Effective date').fill(isoDaysAgo(daysAgo));
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Medicine saved. The check-in will update.')).toBeVisible();
}

/** Answer the check-in: "Yes / A lot" for `yesTo`, "No" for everything else. */
export async function completeCheckin(page: Page, yesTo: string | null) {
  await expect(page.getByTestId('checkin-flow').or(page.getByTestId('checkin-done'))).toBeVisible();
  if (await page.getByTestId('checkin-done').isVisible())
    await page.getByRole('button', { name: 'Change today’s answers' }).click();
  await page.getByRole('radio', { name: /Okay/ }).first().click();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const q = page.getByTestId('checkin-question');
    if (!(await q.isVisible().catch(() => false))) break;
    const code = (await q.getAttribute('data-symptom')) ?? '';
    seen.push(code);
    if (code === yesTo) {
      await page.getByRole('button', { name: 'Yes', exact: true }).click();
      await page.getByRole('radio', { name: 'A lot' }).click();
    } else await page.getByRole('button', { name: 'No', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Send check-in' }).click();
  await expect(page.getByTestId('checkin-done')).toBeVisible();
  return seen;
}
