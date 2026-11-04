import { expect, test, type Page } from '@playwright/test';
import { apiToken, loseKycKey, newAdmin, newMember, post, randomHash, randomIdNumber, seedLipaEvent, seedQuote, signIn, stack, submitKyc } from './helpers';

const keyRow = (page: Page, name: string) => page.getByRole('table', { name: 'Service keys' }).getByRole('row').filter({ hasText: name });
const logRows = (page: Page) => page.getByRole('table', { name: 'Audit log' }).getByRole('row');

test.describe('service keys, the KYC key and the audit log (slice 13)', () => {
  test('the system admin creates a key, sees it once, rotates and revokes it', async ({ page }) => {
    const { admin } = stack();
    const name = `Ledger sync ${Date.now().toString(36)}`;
    await signIn(page, admin.email, admin.password);
    await page.goto('/service-keys');
    await expect(page.getByRole('heading', { name: 'Service keys' })).toBeVisible();

    await page.getByRole('button', { name: 'Create a key' }).click();
    let dialog = page.getByRole('dialog', { name: 'Create a key' });
    await dialog.getByRole('button', { name: 'Create the key' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name for the key.');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create the key' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose what the key can do.');
    await dialog.getByLabel('Send activity records').check();
    await dialog.getByRole('button', { name: 'Create the key' }).click();

    let secret = page.getByRole('dialog', { name: `The key for ${name}` });
    const first = await secret.getByLabel('Key').inputValue();
    expect(first).toMatch(/^bck_/);
    await secret.getByRole('button', { name: 'Done' }).click();
    await expect(secret).toBeHidden();
    const row = keyRow(page, name);
    await expect(row).toContainText('Send activity records');
    await expect(row).toContainText('In use');
    await expect(row).toContainText('Never used');
    await expect(row).toContainText(first.slice(0, 12));

    await row.getByRole('button', { name: `Options for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Rotate' }).click();
    await page.getByRole('dialog', { name: `Rotate ${name}?` }).getByRole('button', { name: 'Rotate' }).click();
    secret = page.getByRole('dialog', { name: `The new key for ${name}` });
    await expect(secret.getByText('The old key has stopped working.')).toBeVisible();
    const second = await secret.getByLabel('Key').inputValue();
    expect(second).toMatch(/^bck_/);
    expect(second).not.toBe(first);
    await secret.getByRole('button', { name: 'Done' }).click();
    await expect(keyRow(page, name)).toHaveCount(1);

    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All, with revoked' }).click();
    await expect(page).toHaveURL(/show=all/);
    await expect(keyRow(page, name)).toHaveCount(2);
    const rotated = keyRow(page, name).filter({ hasText: /Rotated/ });
    await expect(rotated).toHaveCount(1);
    await expect(rotated.getByRole('button')).toHaveCount(0);

    await keyRow(page, name).filter({ hasText: 'In use' }).getByRole('button', { name: `Options for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Revoke' }).click();
    dialog = page.getByRole('dialog', { name: `Revoke ${name}?` });
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${name} is revoked.`)).toBeVisible();
    await expect(keyRow(page, name).filter({ hasText: /Revoked/ })).toHaveCount(1);

    // the audit log has each step, and choosing the record shows only that key's entries
    await page.goto('/audit');
    await page.getByLabel('Action').selectOption('SERVICE_KEY_CREATED');
    await expect(page).toHaveURL(/action=SERVICE_KEY_CREATED/);
    const created = logRows(page).filter({ hasText: name }).first();
    await expect(created).toContainText('Service key created');
    await created.getByRole('button', { name: /^[0-9a-f-]{36}$/ }).click();
    await expect(page).toHaveURL(/type=service_key/);
    await page.getByLabel('Action').selectOption('');
    await expect(logRows(page).filter({ hasText: 'Service key created' })).toHaveCount(1);
    await expect(logRows(page).filter({ hasText: 'Service key rotated' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear the filters' }).click();
    await expect(page).toHaveURL(/\/audit$/);
  });

  test('a role with read access sees the keys and the log, but not the KYC key', async ({ page }) => {
    const { apiBase, admin } = stack();
    await post(`${apiBase}/service-keys`, { name: `Reports ${Date.now().toString(36)}`, scopes: ['facts:read'] }, await apiToken(admin.email, admin.password));
    const reader = await newAdmin(page, ['SERVICE_KEYS.READ', 'AUDIT.READ'], 'Keyreader');
    await signIn(page, reader.email, reader.password);
    await page.goto('/service-keys');
    await expect(page.getByRole('heading', { name: 'Service keys' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'KYC encryption key' })).toHaveCount(0);
    await page.goto('/kyc-key');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();

    // without ADMINS.READ there's no list of admins to choose from; clicking a name in the log filters by them
    await page.goto('/audit');
    await expect(page.getByLabel('Who')).toHaveCount(0);
    await page.getByLabel('Action').selectOption('SERVICE_KEY_CREATED');
    await expect(page).toHaveURL(/action=SERVICE_KEY_CREATED/);
    await logRows(page).filter({ hasText: admin.email }).first().getByRole('button', { name: admin.email }).click();
    await expect(page).toHaveURL(/admin=/);
    await expect(page.getByLabel('Who')).toHaveValue(/[0-9a-f-]{36}/);
    await expect(page.getByLabel('Who').locator('option:checked')).toHaveText(admin.email);
    // the header row, and only what that admin did
    await expect(logRows(page).filter({ hasNotText: admin.email })).toHaveCount(1);
  });

  test('lists the Lipa API callbacks and status checks, with their filters (C6)', async ({ page }) => {
    const member = await newMember('Njoki', 'L' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(''));
    const { quoteId } = seedQuote(member);
    const failed = `lipa-pay-${Date.now().toString(36)}a`;
    const paid = `lipa-pay-${Date.now().toString(36)}b`;
    const txHash = randomHash();
    seedLipaEvent(quoteId, { paymentId: failed, status: 'PROCESSING', amount: '158.4', minutesAgo: 30 });
    seedLipaEvent(quoteId, { paymentId: failed, status: 'FAILED', amount: '158.4', reason: 'INSUFFICIENT_FUNDS', message: 'Payment failed, please try again.', source: 'STATUS_CHECK', minutesAgo: 25 });
    seedLipaEvent(quoteId, { paymentId: paid, status: 'SUCCESS', amount: '158.4', txHash, minutesAgo: 5 });
    const user = await newAdmin(page, ['AUDIT.READ', 'GUARANTEES.READ'], 'LipaLog');
    await signIn(page, user.email, user.password);

    await page.goto('/audit');
    await expect(page.getByText('Planned: Lipa API callbacks')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Lipa API callbacks and status checks' }).click();
    await expect(page).toHaveURL(/view=lipa/);
    await page.getByLabel('Quote ID').fill(quoteId.toLowerCase());
    await expect(page).toHaveURL(new RegExp(`quote=${quoteId}`));
    const rows = page.getByRole('table', { name: 'Lipa API callbacks and status checks' }).getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(rows).toHaveCount(3);
    // newest first
    await expect(rows.nth(0)).toContainText('Success');
    await expect(rows.nth(0)).toContainText(txHash.slice(0, 10));
    await expect(rows.nth(1)).toContainText('Status check');
    await expect(rows.nth(1)).toContainText('INSUFFICIENT_FUNDS');
    await expect(rows.nth(1)).toContainText('Member told: Payment failed, please try again.');
    await expect(rows.nth(2)).toContainText('Processing');

    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('FAILED');
    await expect(rows).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('');
    await page.getByLabel('How').selectOption('callback');
    await expect(rows).toHaveCount(2);
    // a payment ID shows only that attempt
    await rows.nth(1).getByRole('button', { name: failed }).click();
    await expect(page).toHaveURL(new RegExp(`payment=${failed}`));
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear the filters' }).click();
    await expect(page).toHaveURL(/\/audit\?view=lipa$/);

    // the quote opens on its Lipa tab
    await page.getByLabel('Quote ID').fill(quoteId);
    await rows.first().getByRole('link', { name: quoteId }).click();
    await expect(page).toHaveURL(new RegExp(`/guarantees/quotes/${quoteId}\\?tab=lipa$`));
  });

  test('the system admin previews and runs the key-loss reset', async ({ page }) => {
    const { admin } = stack();
    // one member whose key is lost, beside one whose details still read
    const member = await newMember('Wanjiku', 'Lost');
    await submitKyc(member, { idType: 'national_id', idNumber: randomIdNumber(), dateOfBirth: '1991-03-08', address: 'Ngong Road, Nairobi' });
    await submitKyc(await newMember('Otieno', 'Kept'), { idType: 'national_id', idNumber: randomIdNumber(), dateOfBirth: '1988-11-21', address: 'Thika Road, Nairobi' });
    await signIn(page, admin.email, admin.password);
    await page.goto('/kyc-key');
    await expect(page.getByRole('heading', { name: 'KYC encryption key' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Members by key' })).toContainText('k1');

    await page.getByRole('button', { name: 'Re-encrypt' }).click();
    await page.getByRole('dialog', { name: 'Re-encrypt the KYC details?' }).getByRole('button', { name: 'Re-encrypt' }).click();
    await expect(page.getByText('KYC details re-encrypted')).toBeVisible();

    await page.getByRole('button', { name: 'Preview the reset' }).click();
    await expect(page.getByText("Every member's details can be read. The reset has nothing to do.")).toBeVisible();

    loseKycKey(member);
    await page.reload();
    await expect(page.getByText(/1 member's details can't be read/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Members by key' })).toContainText('k0');
    await page.getByRole('button', { name: 'Preview the reset' }).click();
    const affected = page.getByRole('list', { name: 'Members the reset would affect' });
    await expect(affected.getByRole('listitem')).toHaveCount(1);
    await expect(affected).toContainText(member.number);
    await expect(affected).toContainText('1 file');

    await page.getByRole('button', { name: 'Run the reset' }).click();
    const dialog = page.getByRole('dialog', { name: 'Run the key-loss reset?' });
    const typed = dialog.getByLabel('Type “reset 1 member” to confirm');
    await typed.fill('reset');
    await dialog.getByRole('button', { name: 'Delete and reset' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Type “reset 1 member” to confirm.');
    await typed.fill('Reset 1 member');
    await dialog.getByRole('button', { name: 'Delete and reset' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('The reset is done: 1 member emailed to submit their KYC again.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Members by key' })).not.toContainText('k0');
    await expect(page.getByText(/can't be read with any key/)).toHaveCount(0);

    await page.goto(`/audit?type=member&record=${member.id}`);
    await expect(logRows(page).filter({ hasText: 'KYC details reset after key loss' })).toHaveCount(1);
  });
});
