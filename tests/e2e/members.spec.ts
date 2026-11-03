import { expect, test, type Page } from '@playwright/test';
import { connect, newAdmin, newMember, signIn } from './helpers';

/** A surname no other test's member has, so a search finds only this test's members (letters only, as names must be). */
const surname = () => 'Q' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const search = (page: Page) => page.getByRole('searchbox', { name: /Search by name/ });
const details = (page: Page) => page.getByRole('dialog', { name: 'Member details' });

test.describe('members (slice 2)', () => {
  test('finds a member, and shows everything about them to a read-only role', async ({ page }) => {
    const last = surname();
    const amina = await newMember('Amina', last);
    const brian = await newMember('Brian', last);
    await connect(amina, brian);
    const user = await newAdmin(page, ['MEMBERS.READ'], 'Reader');
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/members$/);
    await expect(page.getByRole('heading', { name: 'All members' })).toBeVisible();

    await search(page).fill(last);
    await expect(page).toHaveURL(new RegExp(`q=${last}`));
    const rows = page.getByRole('table', { name: 'Members' }).getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: `Amina ${last}` })).toContainText(amina.number);

    // filters narrow the same search; the address keeps them
    await page.getByRole('button', { name: 'Disabled', exact: true }).click();
    await expect(page.getByText('No members match.')).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('KYC status').selectOption('verified');
    await expect(page.getByText('No members match.')).toBeVisible();
    await page.getByLabel('KYC status').selectOption('');
    await expect(rows).toHaveCount(2);

    // a read-only role sees no row options and no actions
    await expect(page.getByRole('button', { name: /Options for/ })).toHaveCount(0);
    await rows.filter({ hasText: `Amina ${last}` }).click();
    await expect(page).toHaveURL(new RegExp(`/members/${amina.id}\\?q=${last}$`));
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: `Amina ${last}` })).toBeVisible();
    await expect(panel.getByText(amina.number)).toBeVisible();
    await expect(panel.getByText(amina.phone)).toBeVisible();
    await expect(panel.getByRole('button', { name: /Disable the member/ })).toHaveCount(0);
    // a member's guarantees need GUARANTEES.READ as well
    await expect(panel.getByRole('tab')).toHaveText(['Overview', 'Backing', 'Trust Score', 'Connections', 'Limit', 'Files']);

    await panel.getByRole('tab', { name: 'Connections' }).click();
    await expect(page).toHaveURL(/tab=connections/);
    const connection = panel.getByRole('list', { name: 'Connections' }).getByRole('listitem');
    await expect(connection).toHaveCount(1);
    await expect(connection).toContainText(`Brian ${last}`);
    await expect(connection).toContainText('Sent · Trust');
    await expect(connection).toContainText('Accepted');

    await panel.getByRole('tab', { name: 'Trust Score' }).click();
    // each pillar's inputs fold under its row until it's opened
    const identity = panel.getByRole('button', { name: /^Identity/ });
    await expect(identity).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('cell', { name: 'Phone verified' })).toHaveCount(0);
    await identity.click();
    await expect(panel.getByRole('cell', { name: 'Phone verified' })).toBeVisible();
    await panel.getByRole('button', { name: 'Open all pillars' }).click();
    await expect(panel.getByRole('button', { name: 'Close all pillars' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Financial/ })).toHaveAttribute('aria-expanded', 'true');

    await panel.getByRole('tab', { name: 'Limit' }).click();
    await expect(panel.getByText('Maximum guarantee', { exact: true })).toBeVisible();
    await expect(panel.getByText('Available headroom', { exact: true })).toBeVisible();

    await panel.getByRole('tab', { name: 'Backing' }).click();
    await expect(panel.getByText('Locked BLOCKS (read on-chain)')).toBeVisible();
    await expect(panel.getByText('Never set')).toBeVisible();

    await panel.getByRole('tab', { name: 'Files' }).click();
    await expect(panel.getByText('This member has no files.')).toBeVisible();

    // the connection opens the other member; the panel follows the address
    await panel.getByRole('tab', { name: 'Connections' }).click();
    await panel.getByRole('link', { name: `Brian ${last}` }).click();
    await expect(panel.getByRole('heading', { name: `Brian ${last}` })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/members/${brian.id}`));

    // closing returns to the list as it was
    await page.keyboard.press('Escape');
    await expect(details(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/members\\?q=${last}$`));
    await expect(search(page)).toHaveValue(last);
  });

  test('disables a member with a reason, and enables them again', async ({ page }) => {
    const last = surname();
    const member = await newMember('Grace', last);
    const user = await newAdmin(page, ['MEMBERS.READ', 'MEMBERS.UPDATE', 'GUARANTEES.READ'], 'Manager');
    await signIn(page, user.email, user.password);

    await page.goto(`/members/${member.id}?tab=guarantees`);
    const panel = details(page);
    await expect(panel.getByText('This member has no guarantees.')).toBeVisible();

    await panel.getByRole('button', { name: 'Disable the member' }).click();
    const dialog = page.getByRole('dialog', { name: `Disable Grace ${last}?` });
    await dialog.getByLabel('Reason (optional)').fill('Asked to close the account');
    await dialog.getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByText(`Grace ${last} is disabled.`)).toBeVisible();
    await panel.getByRole('tab', { name: 'Overview' }).click();
    await expect(panel.getByText('Reason: Asked to close the account')).toBeVisible();
    await expect(panel.getByText(`by ${user.email}`, { exact: false })).toBeVisible();

    // the list shows it too, and the row's menu enables them again
    await page.keyboard.press('Escape');
    await search(page).fill(last);
    const row = page.getByRole('table', { name: 'Members' }).getByRole('row').filter({ hasText: `Grace ${last}` });
    await expect(row).toContainText('Disabled');
    await page.getByRole('button', { name: 'Disabled', exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Options for Grace ${last}` }).click();
    await page.getByRole('menuitem', { name: 'Enable the member' }).click();
    await page.getByRole('dialog', { name: `Enable Grace ${last}?` }).getByRole('button', { name: 'Enable' }).click();
    await expect(page.getByText(`Grace ${last} is enabled.`)).toBeVisible();
    await expect(page.getByText('No members match.')).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(row).not.toContainText('Disabled');
  });

  test('is closed to a role without MEMBERS.READ', async ({ page }) => {
    const user = await newAdmin(page, ['REFUNDS.READ'], 'NoMembers');
    await signIn(page, user.email, user.password);
    await page.goto('/members');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All members' })).toHaveCount(0);
  });

  test('on a phone, lists members as rows and opens one full width @phone', async ({ page }) => {
    const last = surname();
    const member = await newMember('Peter', last);
    const user = await newAdmin(page, ['MEMBERS.READ'], 'Phone');
    await signIn(page, user.email, user.password);
    await search(page).fill(last);
    const item = page.getByRole('list', { name: 'Members' }).getByRole('link');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`${member.number} · ${member.phone}`);
    await item.click();
    await expect(details(page).getByRole('heading', { name: `Peter ${last}` })).toBeVisible();
    // once it has slid in, it fills the screen
    await expect.poll(async () => (await details(page).boundingBox())?.x).toBeCloseTo(0, 0);
    expect((await details(page).boundingBox())?.width).toBeCloseTo(page.viewportSize()!.width, 0);
  });
});
