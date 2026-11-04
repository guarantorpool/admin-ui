import { expect, test, type Page } from '@playwright/test';
import { Wallet } from 'ethers';
import { newAdmin, newMember, seedKesActivity, signIn } from './helpers';

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

    // a type chosen while the typed filter waits is kept when it lands
    await page.getByLabel('Source').fill('');
    await page.getByLabel('Member number').fill(member.number);
    await page.getByLabel('Type').selectOption('LOAN_REPAYMENT');
    await expect(page).toHaveURL(new RegExp(`member=${member.number}`));
    await expect(page).toHaveURL(/type=LOAN_REPAYMENT/);
    await expect(records(page)).toHaveCount(1);
    await page.getByLabel('Type').selectOption('');

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

  test('lists KES activity read from the Lipa API, filtered by member, wallet, type and status (C4)', async ({ page }) => {
    const member = await newMember('Wairimu', 'K' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(''));
    // stored as the backend stores wallets, in lower case; the filter takes any case
    const wallet = Wallet.createRandom().address.toLowerCase();
    seedKesActivity(member, { wallet, amountKes: 2580, receipt: 'TJK4H7Q2LM', hoursAgo: 3 });
    seedKesActivity(member, { wallet, type: 'PAYMENT', status: 'REVERSED', amountKes: 645, receipt: 'TJL9P3X8RA', hoursAgo: 2 });
    seedKesActivity(member, { wallet, status: 'FAILED', amountKes: 1000, onChain: false, hoursAgo: 1 });
    const user = await newAdmin(page, ['LEDGER.READ'], 'KesReader');
    await signIn(page, user.email, user.password);

    await page.goto('/activity');
    await page.getByRole('tab', { name: 'KES activity from the Lipa API' }).click();
    await expect(page).toHaveURL(/view=kes/);
    await expect(page.getByText('Planned: KES activity')).toHaveCount(0);
    await page.getByLabel('Member number').fill(member.number);
    await expect(page).toHaveURL(new RegExp(`member=${member.number}`));
    const rows = page.getByRole('table', { name: 'KES activity' }).getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(rows).toHaveCount(3);
    // the latest change first
    await expect(rows.nth(0)).toContainText('Failed');
    await expect(rows.nth(0)).toContainText('Not on-chain');
    await expect(rows.nth(1)).toContainText('Payment');
    await expect(rows.nth(1)).toContainText('PAYBILL · 888880');
    await expect(rows.nth(1)).toContainText('Reversed');
    await expect(rows.nth(2)).toContainText('2,580');
    await expect(rows.nth(2)).toContainText('20.00 USD');
    await expect(rows.nth(2)).toContainText('TJK4H7Q2LM');

    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('REVERSED');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('TJL9P3X8RA');
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('');
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('DEPOSIT');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('Member number').fill('');
    await page.getByLabel('Wallet address').fill(wallet.toUpperCase().replace('0X', '0x'));
    await expect(page).toHaveURL(/wallet=0x/);
    await expect(rows).toHaveCount(2);

    // the records tab keeps its own filters
    await page.getByRole('tab', { name: 'Activity records' }).click();
    await expect(page).not.toHaveURL(/view=|wallet=/);
    await expect(page.getByRole('table', { name: 'Activity records' }).or(page.getByText('No activity records yet.'))).toBeVisible();
  });

  test('is closed to a role without LEDGER.READ', async ({ page }) => {
    const user = await newAdmin(page, ['MEMBERS.READ'], 'NoLedger');
    await signIn(page, user.email, user.password);
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });
});
