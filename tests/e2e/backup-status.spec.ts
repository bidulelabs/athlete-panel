import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Isolated E2E_PASSWORD required.');

for (const theme of ['light', 'dark']) {
  for (const storage of ['local', 'remote-mount']) {
    test(`backup protection: ${storage}, ${theme}`, async ({ page }, info) => {
      await page.addInitScript(
        (value) => localStorage.setItem('athlete-panel-theme', value),
        theme,
      );
      await page.goto('/login');
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Training calendar', exact: true }),
      ).toBeVisible();
      await page.route('**/api/workspace?*', async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        const now = new Date().toISOString();
        body.operational = [
          { key: 'worker', value: { state: 'healthy', lastSeen: now } },
          { key: 'backupAttempt', value: { state: 'succeeded' } },
          { key: 'lastBackup', value: { completedAt: now, verifiedAt: now, storage } },
        ];
        await route.fulfill({ response, json: body });
      });
      await page.goto('/plugins');
      const local = 'Local backup verified; off-server copy not configured';
      const remote = 'Verified backup on registered remote storage';
      await expect(
        page.getByText(storage === 'local' ? local : remote, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(storage === 'local' ? remote : local, { exact: true }),
      ).toHaveCount(0);
      if (storage === 'local')
        await expect(
          page.getByText('Local backups do not protect against losing this server.', {
            exact: false,
          }),
        ).toBeVisible();
      await page.screenshot({ path: info.outputPath('backup-protection.png'), fullPage: true });
    });
  }
}
