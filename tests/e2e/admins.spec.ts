import { expect, test, type Page } from '@playwright/test';
import { linkFor, mailCount, newAdmin, newRole, signIn, stack } from './helpers';

const phone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** The admins list shows only the admin with this email. */
async function find(page: Page, email: string) {
  await page.getByLabel('Search by name, email or phone').fill(email);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(email)}`));
  return page.getByRole('table', { name: 'Admins' }).getByRole('row').filter({ hasText: email });
}

async function choose(page: Page, row: ReturnType<Page['getByRole']>, item: string) {
  await row.getByRole('button', { name: /^Options for / }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

const roleRow = (page: Page, label: string | RegExp) => page.getByRole('table', { name: 'Roles' }).getByRole('row').filter({ hasText: label });

test.describe('admins and roles (slice 12)', () => {
  test('the system admin invites an admin, changes them, disables, enables and deletes them', async ({ page }) => {
    const { admin } = stack();
    const reader = await newRole(['MEMBERS.READ'], 'Reader');
    const auditor = await newRole(['AUDIT.READ'], 'Auditor');
    const email = `invite-${Date.now().toString(36)}@test.local`;
    await signIn(page, admin.email, admin.password);
    await page.goto('/admins');
    await expect(page.getByRole('heading', { name: 'Admins and roles' })).toBeVisible();

    await page.getByRole('button', { name: 'Invite an admin' }).click();
    let dialog = page.getByRole('dialog', { name: 'Invite an admin' });
    await dialog.getByRole('button', { name: 'Send the invitation' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter the first and last names.');
    await dialog.getByLabel('First name').fill('Grace');
    await dialog.getByLabel('Last name').fill('Wairimu');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Phone number').fill(phone());
    await dialog.getByLabel('Role').selectOption(reader.id);
    const skip = mailCount();
    await dialog.getByRole('button', { name: 'Send the invitation' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`The invitation was sent to ${email}.`)).toBeVisible();
    expect(await linkFor(email, /.*/, 'set-password', skip)).toContain('token=');

    let row = await find(page, email);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Grace Wairimu');
    await expect(row).toContainText('Never');

    await choose(page, row, 'Update details');
    dialog = page.getByRole('dialog', { name: 'Update Grace Wairimu' });
    await dialog.getByLabel('Middle name (optional)').fill('Njoki');
    await dialog.getByLabel('Role').selectOption(auditor.id);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Grace Njoki Wairimu');
    await expect(row).toContainText(/Test auditor/);

    await choose(page, row, 'Disable');
    dialog = page.getByRole('dialog', { name: 'Disable Grace Njoki Wairimu?' });
    await dialog.getByLabel('Reason (optional)').fill('Left the team');
    await dialog.getByRole('button', { name: 'Disable' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Disabled');
    // the filter finds her among the disabled
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Disabled' }).click();
    await expect(row).toHaveCount(1);
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All' }).click();

    await choose(page, row, 'Enable');
    await page.getByRole('dialog', { name: 'Enable Grace Njoki Wairimu?' }).getByRole('button', { name: 'Enable' }).click();
    await expect(row).not.toContainText('Disabled');

    // an emptied middle name is taken away
    await choose(page, row, 'Update details');
    dialog = page.getByRole('dialog', { name: 'Update Grace Njoki Wairimu' });
    await dialog.getByLabel('Middle name (optional)').fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Grace Wairimu');

    await choose(page, row, 'Delete');
    await page.getByRole('dialog', { name: 'Delete Grace Wairimu?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No admins match.')).toBeVisible();

    // the one system admin is kept out of the list, even for themselves
    await find(page, admin.email);
    await expect(page.getByText('No admins match.')).toBeVisible();
  });

  test('the system admin creates a role, changes it and deletes it', async ({ page }) => {
    const { admin } = stack();
    const held = await newAdmin(page, ['MEMBERS.READ'], 'Held');
    const tag = Date.now().toString(36);
    await signIn(page, admin.email, admin.password);
    await page.goto('/admins/roles');

    await page.getByRole('button', { name: 'Create a role' }).click();
    let dialog = page.getByRole('dialog', { name: 'Create a role' });
    await dialog.getByLabel('Role name').fill(`Checker ${tag}`);
    await dialog.getByRole('group', { name: 'Members' }).getByLabel('All, and any added later').check();
    await expect(dialog.getByRole('group', { name: 'Members' }).getByLabel('See')).toBeDisabled();
    await dialog.getByRole('group', { name: 'Audit log' }).getByLabel('See').check();
    await dialog.getByRole('button', { name: 'Create the role' }).click();
    await expect(dialog).toBeHidden();

    const label = `Checker ${tag}`;
    // three in Members and one in Audit log
    await expect(roleRow(page, label)).toContainText('4');
    await roleRow(page, label).getByRole('link').click();
    const sheet = page.getByRole('dialog', { name: 'Role details' });
    await expect(sheet.getByRole('heading', { name: label })).toBeVisible();
    await expect(sheet).toContainText(`ROLE_CHECKER_${tag.toUpperCase()}`);
    await expect(sheet).toContainText('All, and any added later');

    await sheet.getByRole('button', { name: 'Rename or change permissions' }).click();
    dialog = page.getByRole('dialog', { name: `Change ${label}` });
    await dialog.getByLabel('Role name').fill(`Approver ${tag}`);
    await dialog.getByRole('group', { name: 'Members' }).getByLabel('All, and any added later').uncheck();
    await dialog.getByRole('group', { name: 'Members' }).getByLabel('See').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(sheet.getByRole('heading', { name: `Approver ${tag}` })).toBeVisible();
    await expect(sheet).not.toContainText('All, and any added later');

    await sheet.getByRole('button', { name: 'Delete the role' }).click();
    await page.getByRole('dialog', { name: `Delete the role Approver ${tag}?` }).getByRole('button', { name: 'Delete' }).click();
    await expect(sheet).toBeHidden();
    await expect(roleRow(page, `Approver ${tag}`)).toHaveCount(0);

    // a role an admin holds stays until they have another
    await page.goto(`/admins/roles/${held.roleId}`);
    await expect(sheet.getByRole('button', { name: 'Delete the role' })).toBeDisabled();
    await expect(sheet).toContainText('Held by 1 admin. Give them another role first.');

    // the system admin role is kept out of the list
    await page.goto('/admins/roles');
    await expect(roleRow(page, /Test held/i).first()).toBeVisible();
    await expect(roleRow(page, 'System admin')).toHaveCount(0);
  });

  test('an admin who can only update admins reaches no one above them', async ({ page }) => {
    const { admin } = stack();
    const lesser = await newAdmin(page, ['MEMBERS.READ'], 'Lesser');
    const user = await newAdmin(page, ['ADMINS.READ', 'ADMINS.UPDATE', 'MEMBERS.READ'], 'Updater');
    await signIn(page, user.email, user.password);
    await page.goto('/admins');
    await expect(page.getByRole('heading', { name: 'Admins and roles' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite an admin' })).toHaveCount(0);

    // the system admin isn't listed
    await find(page, admin.email);
    await expect(page.getByText('No admins match.')).toBeVisible();

    // nobody disables their own account
    let row = await find(page, user.email);
    await row.getByRole('button', { name: /^Options for / }).click();
    await expect(page.getByRole('menuitem', { name: /Disable/ })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /Disable/ })).toContainText("You can't disable your own account.");
    // without ADMINS.DELETE there's no delete at all
    await expect(page.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    row = await find(page, lesser.email);
    await choose(page, row, 'Update details');
    const dialog = page.getByRole('dialog', { name: 'Update Test Lesser' });
    await expect(dialog.getByLabel('Role')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await choose(page, row, 'Disable');
    await page.getByRole('dialog', { name: 'Disable Test Lesser?' }).getByRole('button', { name: 'Disable' }).click();
    await expect(row).toContainText('Disabled');

    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page).toHaveURL(/\/admins\/roles$/);
    await expect(page.getByRole('button', { name: 'Create a role' })).toHaveCount(0);
    await roleRow(page, /Test lesser/i).first().getByRole('link').click();
    await expect(page.getByRole('dialog', { name: 'Role details' }).getByRole('button', { name: 'Delete the role' })).toHaveCount(0);
  });
});
