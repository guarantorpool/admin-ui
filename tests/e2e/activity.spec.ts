import { expect, test, type Page } from '@playwright/test';
import { newAdmin, newMember, signIn } from './helpers';

const HEADER = 'source,externalId,memberNumber,type,amount,occurredAt';

/** A CSV file to choose in the import dialog. */
const csv = (name: string, lines: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...lines].join('\n') + '\n') });

const records = (page: Page) => page.getByRole('table', { name: 'Activity records' }).getByRole('row').filter({ has: page.getByRole('cell') });

async function importFile(page: Page, file: ReturnType<typeof csv>) {
  await page.getByRole('button', { name: 'Import a CSV file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import activity records' });
  await dialog.getByLabel('CSV file').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Import' }).click();
  return dialog;
}

test.describe('activity (slice 11)', () => {
  test('imports records from a CSV file, skips them the second time, and finds them', async ({ page }) => {
    const member = await newMember('Wanjiku', 'Activity');
    // a source of this run's own, so only its records match
    const source = `sacco-${Date.now().toString(36)}`;
    const user = await newAdmin(page, ['LEDGER.READ', 'LEDGER.IMPORT'], 'Ledger');
    await signIn(page, user.email, user.password);
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

    const file = csv('october.csv', [`${source},D-1,${member.number},DEPOSIT,12000,2026-10-30T08:00:00Z`, `${source},R-1,${member.number.toLowerCase()},LOAN_REPAYMENT,4500.5,2026-10-31T09:30:00Z`]);
    let dialog = await importFile(page, file);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('october.csv: 2 records added.')).toBeVisible();

    await page.getByLabel('Member number').fill(member.number);
    await expect(page).toHaveURL(new RegExp(`member=${member.number}`));
    await expect(records(page)).toHaveCount(2);
    // the latest to happen first
    await expect(records(page).first()).toContainText('Loan repayment');
    await expect(records(page).first()).toContainText('4,500.50 KES');
    await expect(records(page).nth(1)).toContainText('12,000.00 KES');
    await expect(records(page).nth(1)).toContainText(source);
    await expect(records(page).nth(1)).toContainText('CSV import');

    await page.getByLabel('Type').selectOption('DEPOSIT');
    await expect(records(page)).toHaveCount(1);
    await expect(records(page)).toContainText('Deposit');
    await page.getByLabel('Type').selectOption('');
    await page.getByLabel('Member number').fill('');
    await page.getByLabel('Source').fill(source);
    await expect(page).toHaveURL(new RegExp(`source=${source}`));
    await expect(records(page)).toHaveCount(2);

    // the same rows again are already in
    dialog = await importFile(page, file);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('october.csv: 0 records added, 2 records already in and skipped.')).toBeVisible();
    await expect(records(page)).toHaveCount(2);

    // a file that's wrong goes in not at all, and says why
    dialog = await importFile(page, { ...csv('bad.csv', []), buffer: Buffer.from('memberNumber,amount\n1001,5\n') });
    await expect(dialog.getByRole('alert')).toContainText(`The first line must be: ${HEADER}`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a role that can only read them has nothing to import with', async ({ page }) => {
    const user = await newAdmin(page, ['LEDGER.READ'], 'LedgerReader');
    await signIn(page, user.email, user.password);
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Activity records' }).or(page.getByText('No activity records yet.'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import a CSV file' })).toHaveCount(0);
  });

  test('is closed to a role without LEDGER.READ', async ({ page }) => {
    const user = await newAdmin(page, ['MEMBERS.READ'], 'NoLedger');
    await signIn(page, user.email, user.password);
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });
});
