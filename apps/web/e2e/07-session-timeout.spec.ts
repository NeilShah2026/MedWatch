import { expect, test } from '@playwright/test';
import { hasBackend, users } from './support/env';
import { signIn } from './support/helpers';

// E2E 7: session timeout signs the user out (warning first, then sign-out).
test.describe('session timeout', () => {
  test.skip(!hasBackend, 'needs the cloud dev project (see PROGRESS.md)');

  test('warns, then signs out an idle user', async ({ page }) => {
    // Test hook (non-production only): 70-second timeout → warning appears after ~35s.
    await page.addInitScript(() =>
      window.localStorage.setItem('medwatch.e2e.sessionTimeoutSeconds', '70'),
    );
    await signIn(page, users.caregiver1);
    await expect(page.getByTestId('session-timeout-modal')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/you will be signed out in \d+ seconds/i)).toBeVisible();
    await page.waitForURL(/\/signin\?reason=timeout/, { timeout: 60_000 });
    await expect(page.getByText('You were signed out after a period of inactivity.')).toBeVisible();
  });

  test('"Stay signed in" keeps the session', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('medwatch.e2e.sessionTimeoutSeconds', '70'),
    );
    await signIn(page, users.caregiver1);
    await expect(page.getByTestId('session-timeout-modal')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(page.getByTestId('session-timeout-modal')).toBeHidden();
    await expect(page).toHaveURL(/\/care/);
  });
});
