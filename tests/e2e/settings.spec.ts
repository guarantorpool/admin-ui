import { expect, test, type Page } from '@playwright/test';
import { apiToken, newAdmin, post, signIn, stack } from './helpers';

// Pool settings are shared by every test in a run, so these change only settings no other test reads (alerts and
// invite links), and the pillar weights only in a set that is rejected.

const ALL = ['PARAMETERS.READ', 'PARAMETERS.PROPOSE', 'PARAMETERS.APPROVE'];

const tag = () => Date.now().toString(36);
const group = (page: Page, title: string) => page.getByRole('region', { name: title });
const groupLink = (page: Page, title: string) => page.getByRole('navigation', { name: 'Setting groups' }).getByRole('link', { name: new RegExp(`^${title}\\b`) });
const row = (page: Page, key: string) => page.getByRole('link').filter({ has: page.getByText(key, { exact: true }) });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Pool setting' });
const waiting = (page: Page) => page.getByRole('list', { name: 'Waiting changes' }).getByRole('listitem');
const history = (page: Page) => page.getByRole('list', { name: 'Setting changes' }).getByRole('listitem');

test.describe('Pool settings (slice 8)', () => {
  test('the groups are a menu, and the chosen group shows all its settings', async ({ page }) => {
    const admin = await newAdmin(page, ['PARAMETERS.READ'], 'Groups');
    await signIn(page, admin.email, admin.password);
    await page.goto('/pool/settings');
    // the first group opens, and only one group shows at a time
    await expect(group(page, 'Trust Score pillar weights')).toBeVisible();
    await expect(group(page, 'Trust Score benchmarks')).toHaveCount(0);
    await expect(groupLink(page, 'Trust Score pillar weights')).toHaveAttribute('aria-current', 'true');
    await expect(groupLink(page, 'Trust Score benchmarks')).toContainText('11');

    // a big group shows every setting, with no pages, and its last one is on the page
    await groupLink(page, 'Trust Score benchmarks').click();
    await expect(page).toHaveURL(/group=trust-score-benchmarks/);
    const benchmarks = group(page, 'Trust Score benchmarks');
    await expect(benchmarks.getByRole('link')).toHaveCount(11);
    await expect(benchmarks.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    const last = row(page, 'benchmark_loans_taken');
    await last.scrollIntoViewIfNeeded();
    await expect(last.getByText('benchmark_loans_taken', { exact: true })).toBeInViewport({ ratio: 1 });

    // a setting opened by its link shows its own group behind it, and closing it keeps that group
    await page.goto('/pool/settings/claim_grace_days');
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator('section[aria-label="Claims"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/pool\/settings\?group=claims$/);
    await expect(row(page, 'claim_grace_days')).toBeVisible();
    // and a setting opened from the group comes back to it
    await row(page, 'claim_waiting_days').click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(group(page, 'Claims')).toBeVisible();
  });

  test('shows every setting in its group, and one that applies at once changes straight away', async ({ page }) => {
    const admin = await newAdmin(page, ALL, 'AtOnce');
    await signIn(page, admin.email, admin.password);
    await page.goto('/pool/settings');
    await expect(page.getByRole('heading', { name: 'Pool settings', level: 1 })).toBeVisible();
    for (const title of ['Trust Score pillar weights', 'Trust Score benchmarks', 'Pricing inputs', 'Operating fee', 'Quotes and tenures', 'Haircuts', 'Applies at once']) {
      await expect(groupLink(page, title)).toBeVisible();
    }
    await groupLink(page, 'Operating fee').click();
    await expect(row(page, 'operating_fee_rate')).toContainText('Two admins');
    await groupLink(page, 'Pricing inputs').click();
    await expect(row(page, 'recovery_rate_calculated')).toContainText('0 (off)');
    // the five that apply at once, and only those
    await groupLink(page, 'Applies at once').click();
    const atOnce = group(page, 'Applies at once');
    await expect(atOnce.getByRole('link')).toHaveCount(5);
    await expect(atOnce.getByText('Two admins')).toHaveCount(0);

    await row(page, 'invite_token_ttl_hours').click();
    await expect(page).toHaveURL(/\/pool\/settings\/invite_token_ttl_hours\?group=applies-at-once$/);
    await expect(sheet(page).getByText('At once, when changed on its own')).toBeVisible();
    await expect(sheet(page).getByText("It hasn't been changed since it was set up.")).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Change this setting' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change invite_token_ttl_hours' });
    await expect(dialog.getByText('This setting applies at once, with no approval')).toBeVisible();
    const apply = dialog.getByRole('button', { name: 'Apply now' });
    await apply.click();
    await expect(dialog.getByText('Enter the new value.')).toBeVisible();
    await dialog.getByLabel('New value').fill('72');
    await apply.click();
    await expect(dialog.getByText('Enter a value that differs from the current one.')).toBeVisible();
    await dialog.getByLabel('New value').fill('96 hours');
    await apply.click();
    await expect(dialog.getByText(/^Enter a number of 0 or more/)).toBeVisible();
    await dialog.getByLabel('New value').fill('96');
    await dialog.getByLabel('Reason (optional)').fill('Members asked for longer links');
    await apply.click();
    await expect(page.getByText('invite_token_ttl_hours is changed.')).toBeVisible();

    const changes = sheet(page).getByRole('list', { name: 'Changes to this setting' }).getByRole('listitem');
    await expect(changes.first()).toContainText('invite_token_ttl_hours: 72 to 96');
    await expect(changes.first()).toContainText('Applied at once');
    await expect(changes.first()).toContainText('Changed by you');
    await expect(sheet(page).getByText('96', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row(page, 'invite_token_ttl_hours')).toContainText('96');
  });

  test('a change takes a second admin, who sees the GP API refuse a value out of range', async ({ page, browser }) => {
    const first = await newAdmin(page, ALL, 'Proposer');
    await signIn(page, first.email, first.password);
    await page.goto('/pool/settings/alert_refund_held_hours');
    await sheet(page).getByRole('button', { name: 'Change this setting' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change alert_refund_held_hours' });
    await expect(dialog.getByText('A second admin must approve this before it takes effect.')).toBeVisible();
    // the backend's own rule, shown as it gives it
    await dialog.getByLabel('New value').fill('36.5');
    await dialog.getByRole('button', { name: 'Propose the change' }).click();
    await expect(dialog.getByText('alert_refund_held_hours must be a whole number from 0 to 8760')).toBeVisible();
    const reason = `Payouts take a day and a half ${tag()}`;
    await dialog.getByLabel('New value').fill('36');
    await dialog.getByLabel('Reason (optional)').fill(reason);
    await dialog.getByRole('button', { name: 'Propose the change' }).click();
    await expect(page.getByText('Change proposed. A second admin approves it.')).toBeVisible();
    // nothing changes until it's approved, and no second change can be proposed meanwhile
    await expect(sheet(page).getByText('A change to this setting is waiting for approval')).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Change this setting' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(row(page, 'alert_refund_held_hours')).toContainText('24');
    await expect(row(page, 'alert_refund_held_hours')).toContainText('Waiting for approval');

    await page.getByRole('tab', { name: /Waiting for approval/ }).click();
    await expect(page).toHaveURL(/view=waiting/);
    const mine = waiting(page).filter({ hasText: reason });
    await expect(mine).toContainText('alert_refund_held_hours: 24 to 36');
    await expect(mine).toContainText('Proposed by you');
    await expect(mine).toContainText('You proposed it, so a different admin approves or rejects it.');
    await expect(mine.getByRole('button', { name: 'Approve' })).toBeDisabled();

    const other = await browser.newPage();
    const second = await newAdmin(other, ALL, 'Approver');
    await signIn(other, second.email, second.password);
    await other.goto('/pool/settings?view=waiting');
    const theirs = waiting(other).filter({ hasText: reason });
    await expect(theirs).toContainText(`Proposed by ${first.email}`);
    await theirs.getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this change?' });
    await expect(approve.getByText(reason)).toBeVisible();
    await approve.getByLabel('Note (optional)').fill('Agreed at the operations meeting');
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText('Approved: alert_refund_held_hours: 24 to 36.')).toBeVisible();
    await expect(theirs).toHaveCount(0);

    await other.getByRole('tab', { name: 'History' }).click();
    await other.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Approved' }).click();
    const done = history(other).filter({ hasText: reason });
    await expect(done).toContainText(`approved by ${second.email}`);
    await expect(done).toContainText('Note: Agreed at the operations meeting');
    await other.getByRole('tab', { name: 'Current settings' }).click();
    await groupLink(other, 'Pool upkeep and alerts').click();
    await expect(row(other, 'alert_refund_held_hours')).toContainText('36');
    await expect(row(other, 'alert_refund_held_hours')).toContainText('Two admins');
    await other.close();
  });

  test('pillar weights change together as a set, and a set is approved or rejected whole', async ({ page, browser }) => {
    const first = await newAdmin(page, ALL, 'SetProposer');
    await signIn(page, first.email, first.password);
    await page.goto('/pool/settings/pillar_weight_identity');
    await expect(sheet(page).getByText('they change together as one change set')).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Change this setting' })).toHaveCount(0);
    await sheet(page).getByRole('button', { name: 'Change the four weights' }).click();

    const dialog = page.getByRole('dialog', { name: 'Propose a change set' });
    const propose = dialog.getByRole('button', { name: 'Propose the set' });
    await expect(dialog.getByRole('list', { name: 'Settings in the set' }).getByRole('listitem')).toHaveCount(4);
    await dialog.getByLabel('New value for pillar_weight_identity').fill('0.2');
    await dialog.getByLabel('New value for pillar_weight_relationship').fill('0.3');
    await expect(dialog.getByText('The four pillar weights would total 1.1.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove pillar_weight_activity' }).click();
    await propose.click();
    await expect(dialog.getByText('pillar_weight_financial: Enter the new value.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove pillar_weight_financial' }).click();
    await propose.click();
    await expect(dialog.getByText('The four pillar weights must total 1, but would total 1.1.')).toBeVisible();
    await dialog.getByLabel('New value for pillar_weight_relationship').fill('0.2');
    await expect(dialog.getByText('The four pillar weights would total 1.')).toBeVisible();
    // any setting can go in a set, even one that would otherwise apply at once
    await dialog.getByRole('button', { name: 'Add a setting' }).click();
    await dialog.getByLabel('Setting 3', { exact: true }).selectOption('invite_max_unused');
    await dialog.getByLabel('New value for invite_max_unused').fill('12');
    const reason = `Identity counts for more ${tag()}`;
    await dialog.getByLabel('Reason (optional)').fill(reason);
    await propose.click();
    await expect(page.getByText('Change set proposed. A second admin approves it.')).toBeVisible();

    await page.goto('/pool/settings?view=waiting');
    const set = waiting(page).filter({ hasText: reason });
    await expect(set).toContainText('Change set of 3');
    await expect(set).toContainText('pillar_weight_identity: 0.15 to 0.2');
    await expect(set).toContainText('invite_max_unused: 10 to 12');
    await expect(set.getByRole('button', { name: 'Reject' })).toBeDisabled();

    // a second set, proposed through the GP API, for the approval
    const { apiBase } = stack();
    const token = await apiToken(first.email, first.password);
    const approveReason = `Alert on fewer failures ${tag()}`;
    await post(`${apiBase}/parameter-change-sets`, { changes: [{ key: 'alert_reader_failures', value: 4 }, { key: 'alert_refund_window_hours', value: 48 }], reason: approveReason }, token);

    const other = await browser.newPage();
    const second = await newAdmin(other, ALL, 'SetApprover');
    await signIn(other, second.email, second.password);
    await other.goto('/pool/settings?view=waiting');
    await waiting(other).filter({ hasText: reason }).getByRole('button', { name: 'Reject' }).click();
    const reject = other.getByRole('dialog', { name: 'Reject this change set?' });
    await expect(reject.getByText('0.15 to 0.2')).toBeVisible();
    await expect(reject.getByText('10 to 12')).toBeVisible();
    await reject.getByRole('button', { name: 'Reject the set' }).click();
    await expect(other.getByText('Rejected: the change set of 3.')).toBeVisible();

    await waiting(other).filter({ hasText: approveReason }).getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this change set?' });
    await expect(approve.getByText('Every value in the set takes effect together.', { exact: false })).toBeVisible();
    await approve.getByRole('button', { name: 'Approve the set' }).click();
    await expect(other.getByText('Approved: the change set of 2.')).toBeVisible();

    await other.goto('/pool/settings');
    await expect(row(other, 'pillar_weight_identity')).toContainText('0.15');
    await groupLink(other, 'Pool upkeep and alerts').click();
    await expect(row(other, 'alert_reader_failures')).toContainText('4');
    await expect(row(other, 'alert_refund_window_hours')).toContainText('48');
    await other.goto('/pool/settings?view=history&key=pillar_weight_identity');
    const rejected = history(other).filter({ hasText: reason });
    await expect(rejected).toContainText('Rejected');
    await expect(rejected).toContainText('Part of a change set');
    await other.close();
  });

  test('a role that can only read sees the settings but no way to change them', async ({ page }) => {
    const reader = await newAdmin(page, ['PARAMETERS.READ'], 'Reader');
    await signIn(page, reader.email, reader.password);
    await page.goto('/pool/settings');
    await groupLink(page, 'Haircuts').click();
    await expect(group(page, 'Haircuts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose a change set' })).toHaveCount(0);
    await row(page, 'blocks_haircut').click();
    await expect(sheet(page).getByText('Proposed, then approved by a second admin')).toBeVisible();
    await expect(sheet(page).getByRole('button')).toHaveCount(1); // only Close
  });
});
