import { expect, test } from '@playwright/test';
import { signIn } from './support';

// E2E 7 (mock): idle warning, then automatic sign-out. Uses the non-production test hook
// that shortens the org's session timeout.
test('session timeout warns and signs the user out', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() =>
    window.localStorage.setItem('medwatch.e2e.sessionTimeoutSeconds', '20'),
  );
  await signIn(page, 'caregiver2@demo.medwatch');
  await expect(page.getByTestId('session-timeout-modal')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/you will be signed out in \d+ seconds/i)).toBeVisible();
  await page.waitForURL(/\/signin\?reason=timeout/, { timeout: 30_000 });
  await expect(page.getByText('You were signed out after a period of inactivity.')).toBeVisible();
  // Protected pages now require signing in again
  await page.goto('/care');
  await expect(page).toHaveURL(/\/signin/);
});

test('"Stay signed in" keeps the session', async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem('medwatch.e2e.sessionTimeoutSeconds', '20'),
  );
  await signIn(page, 'caregiver2@demo.medwatch');
  await expect(page.getByTestId('session-timeout-modal')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(page.getByTestId('session-timeout-modal')).toBeHidden();
  await expect(page).toHaveURL(/\/care$/);
});
