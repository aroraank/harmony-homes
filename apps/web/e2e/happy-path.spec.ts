import { expect, test } from '@playwright/test';

const user = process.env.E2E_ADMIN_USER ?? 'admin';
const password = process.env.E2E_ADMIN_PASSWORD;
const unit = process.env.E2E_UNIT ?? 'P2-GF';

test.skip(!password, 'Set E2E_ADMIN_PASSWORD to run the happy path');

test('login → record payment → month report', async ({ page }) => {
  const utr = `E2E${Date.now()}`.slice(0, 20);

  await page.goto('/login');
  await page.getByPlaceholder('P1-GF').fill(user);
  await page.locator('input[type=password]').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Society balance')).toBeVisible();

  // make sure this month's dues exist (idempotent)
  await page.goto('/admin/dues');
  await page.getByRole('button', { name: 'Generate dues' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Generate dues' }).click();
  await expect(page.getByText(/dues created|already exist/)).toBeVisible();

  await page.goto('/admin/payment');
  const unitSelect = page.locator('select').first();
  const value = await unitSelect.locator('option', { hasText: `${unit} —` }).first().getAttribute('value');
  await unitSelect.selectOption(value!);
  await page.getByPlaceholder('800').fill('800');
  await page.locator('select').nth(1).selectOption('upi');
  await page.getByLabel('UTR / reference').fill(utr);
  await expect(page.getByText('This payment')).toBeVisible();
  await page.getByRole('button', { name: 'Review and save' }).click();
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/recorded for .* receipt HH\//)).toBeVisible();

  await page.goto('/ledger');
  await page.getByLabel('Search').fill(utr);
  await expect(page.getByText(`${unit} · Maintenance`).first()).toBeVisible();

  await page.goto('/reports/month');
  await expect(page.getByText('Opening balance')).toBeVisible();
  await expect(page.getByText('Closing balance')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(unit) }).first()).toBeVisible();
});
