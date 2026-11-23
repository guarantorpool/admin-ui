import { expect, test, type Page } from '@playwright/test';
import { apiToken, call, newAdmin, newMember, post, signIn, stack, type Member } from './helpers';

// The suggestion lists and members' requests for missing entries (BlockCoop D-043). The lists are shared by every
// test in a run, so each test adds names of its own, with a tag, and looks only at those.

const KEEP = ['LISTS.READ', 'LISTS.MANAGE'];
const tag = () => Date.now().toString(36);
const entries = (page: Page, list: string) => page.getByRole('table', { name: list });
const entryRow = (page: Page, list: string, name: string) => entries(page, list).getByRole('row').filter({ hasText: name });
const requestRow = (page: Page, name: string) => page.getByRole('table', { name: 'Requests' }).getByRole('row').filter({ hasText: name });

async function choose(page: Page, row: ReturnType<typeof requestRow>, name: string, action: string) {
  await row.getByRole('button', { name: `Options for ${name}` }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

/** The member ticks the background box, once: setting the background again replaces it, withdrawing their requests. */
const shareBackground = (member: Member) => call('PUT', `${stack().apiBase}/members/${member.id}/background`, { shared: true }, member.token);

/** The member asks for a missing entry. */
async function ask(member: Member, list: string, name: string, type: string) {
  const { apiBase } = stack();
  await post(`${apiBase}/members/${member.id}/list-requests`, { list, name, type }, member.token);
}

test.describe('suggestion lists (BlockCoop D-043)', () => {
  test('an admin adds interests one at a time and in bulk, renames one and retires it', async ({ page }) => {
    const t = tag();
    const admin = await newAdmin(page, KEEP, 'Lists');
    await signIn(page, admin.email, admin.password);
    await page.goto('/lists');
    await expect(page.getByRole('heading', { name: 'Suggestion lists' })).toBeVisible();
    await page.getByRole('tab', { name: 'Lists' }).click();
    await page.getByRole('group', { name: 'List' }).getByRole('button', { name: 'Interests' }).click();
    await expect(page).toHaveURL(/list=interests/);

    await page.getByRole('button', { name: 'Add an interest' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add an interest' });
    await dialog.getByRole('button', { name: 'Add it' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter the name.');
    await dialog.getByLabel('Name').fill(`Beekeeping ${t}`);
    await dialog.getByRole('button', { name: 'Add it' }).click();
    await expect(dialog).toBeHidden();
    await expect(entryRow(page, 'Interests', `Beekeeping ${t}`)).toContainText('Offered');

    // a name already on the list, in another case, is skipped, and so is a repeat in what is pasted
    await page.getByRole('button', { name: 'Add many' }).click();
    dialog = page.getByRole('dialog', { name: 'Add many interests' });
    await dialog.getByLabel('Names').fill(`beekeeping ${t}\nChess ${t}\n\nchess ${t}\nHiking ${t}`);
    await expect(dialog.getByText('3 names, blank lines and repeats left out.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add 3' }).click();
    await expect(page.getByText('2 added, 1 skipped as already on the list.')).toBeVisible();
    await page.getByLabel('Search interests').fill(t);
    await expect(entries(page, 'Interests').getByRole('row')).toHaveCount(4);

    await entryRow(page, 'Interests', `Chess ${t}`).getByRole('button', { name: `Options for Chess ${t}` }).click();
    await page.getByRole('menuitem', { name: 'Change' }).click();
    dialog = page.getByRole('dialog', { name: `Change Chess ${t}` });
    await dialog.getByLabel('Name').fill(`Hiking ${t}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('That name is already on the list');
    await dialog.getByLabel('Name').fill(`Chess club ${t}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(entryRow(page, 'Interests', `Chess club ${t}`)).toBeVisible();

    await entryRow(page, 'Interests', `Hiking ${t}`).getByRole('button', { name: `Options for Hiking ${t}` }).click();
    await page.getByRole('menuitem', { name: 'Retire' }).click();
    await page.getByRole('dialog', { name: `Retire Hiking ${t}?` }).getByRole('button', { name: 'Retire' }).click();
    await expect(entryRow(page, 'Interests', `Hiking ${t}`)).toHaveCount(0);
    await page.getByRole('button', { name: 'With retired' }).click();
    await expect(entryRow(page, 'Interests', `Hiking ${t}`)).toContainText('Retired');
  });

  test('counties and sub-counties are fixed, and sub-counties narrow to a county', async ({ page }) => {
    const admin = await newAdmin(page, KEEP, 'Places');
    await signIn(page, admin.email, admin.password);
    await page.goto('/lists?view=entries&list=counties');
    await expect(page.getByText("can't be added to, renamed or retired")).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);
    await page.getByLabel('Search counties').fill('nairobi');
    await expect(entryRow(page, 'Counties', 'Nairobi')).toBeVisible();
    await expect(entries(page, 'Counties').getByRole('button', { name: /^Options/ })).toHaveCount(0);

    // a list chosen while a search is still being typed stays chosen, without the search
    await page.getByLabel('Search counties').fill('');
    await expect(page).not.toHaveURL(/q=/);
    // typed and clicked in one go, well within the wait before a search is applied
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search counties"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'mom');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="List"] button')).find((b) => b.textContent === 'Sub-counties')!.click();
    });
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/list=sub-counties/);
    expect(new URL(page.url()).searchParams.get('q')).toBeNull();
    await expect(page.getByLabel('Search sub-counties')).toHaveValue('');
    await page.getByLabel('County', { exact: true }).selectOption({ label: 'Mombasa' });
    const rows = entries(page, 'Sub-counties').getByRole('row');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasNotText: 'Mombasa' }).filter({ hasNot: page.getByRole('columnheader') })).toHaveCount(0);
  });

  test("an admin approves, merges and rejects members' requests", async ({ page }) => {
    const t = tag();
    const member = await newMember('Wanjiru', `Asks${t}`);
    const admin = await newAdmin(page, KEEP, 'Requests');
    await shareBackground(member);
    await ask(member, 'schools', `Moi Girls Eldoret ${t}`, 'SECONDARY');
    await ask(member, 'communities', `Umoja SACCO ${t}`, 'SACCO');
    await ask(member, 'communities', `Not a real group ${t}`, 'CHAMA');

    await signIn(page, admin.email, admin.password);
    await page.goto('/lists');
    await expect(page.getByRole('tab', { name: /Members' requests/ })).toContainText(/\d/);
    await expect(requestRow(page, `Moi Girls Eldoret ${t}`)).toContainText('Schools: Secondary school');
    await expect(requestRow(page, `Moi Girls Eldoret ${t}`)).toContainText(`Wanjiru Asks${t}`);

    // as a new entry, its name corrected first
    await choose(page, requestRow(page, `Moi Girls Eldoret ${t}`), `Moi Girls Eldoret ${t}`, 'Approve as a new entry');
    let dialog = page.getByRole('dialog', { name: 'Approve as a new entry' });
    await dialog.getByLabel('Name').fill(`Moi Girls High School, Eldoret ${t}`);
    await dialog.getByRole('button', { name: 'Approve and add' }).click();
    await expect(dialog).toBeHidden();
    await expect(requestRow(page, `Moi Girls Eldoret ${t}`)).toHaveCount(0);

    // as an entry already on the list
    const sacco = await call<{ name: string }>('POST', `${stack().apiBase}/lists/communities`, { name: `Umoja Sacco Society ${t}`, type: 'SACCO' }, await apiToken(admin.email, admin.password));
    await choose(page, requestRow(page, `Umoja SACCO ${t}`), `Umoja SACCO ${t}`, 'Approve as an entry already on the list');
    dialog = page.getByRole('dialog', { name: 'Approve as an entry already on the list' });
    await dialog.getByLabel('Find the entry').fill(`Umoja Sacco Society ${t}`);
    await dialog.getByRole('radio', { name: new RegExp(sacco.name) }).check();
    // a search that hides the chosen entry leaves nothing chosen
    await dialog.getByLabel('Find the entry').fill(`Nothing like it ${t}`);
    await expect(dialog.getByText('Nothing on the list matches.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose the entry it is.');
    await dialog.getByLabel('Find the entry').fill(`Umoja Sacco Society ${t}`);
    await dialog.getByRole('radio', { name: new RegExp(sacco.name) }).check();
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog).toBeHidden();

    await choose(page, requestRow(page, `Not a real group ${t}`), `Not a real group ${t}`, 'Reject');
    dialog = page.getByRole('dialog', { name: `Reject “Not a real group ${t}”?` });
    await dialog.getByLabel('Note to the member').fill('We could not find this group.');
    await dialog.getByRole('button', { name: 'Reject' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All' }).click();
    await expect(requestRow(page, `Moi Girls Eldoret ${t}`)).toContainText(`As Moi Girls High School, Eldoret ${t}`);
    await expect(requestRow(page, `Umoja SACCO ${t}`)).toContainText(`As Umoja Sacco Society ${t}`);
    await expect(requestRow(page, `Not a real group ${t}`)).toContainText('We could not find this group.');
    await expect(requestRow(page, `Not a real group ${t}`)).toContainText('Rejected');

    // the member sees the outcome and the note
    const mine = await call<{ status: string; note?: string }[]>('GET', `${stack().apiBase}/members/${member.id}/list-requests`, undefined, member.token);
    expect(mine.map((r) => r.status).sort()).toEqual(['APPROVED', 'APPROVED', 'REJECTED']);
    expect(mine.find((r) => r.status === 'REJECTED')?.note).toBe('We could not find this group.');
  });

  test('on a phone, a reviewed request shows its outcome @phone', async ({ page }) => {
    const t = tag();
    const member = await newMember('Achieng', `Phone${t}`);
    await shareBackground(member);
    await ask(member, 'communities', `Kite flying ${t}`, 'SOCIAL_GROUP');
    const admin = await newAdmin(page, KEEP, 'PhoneLists');
    const token = await apiToken(admin.email, admin.password);
    const pending = await call<{ results: { requestId: string; name: string }[] }>('GET', `${stack().apiBase}/list-requests?status=PENDING&page=1&size=100`, undefined, token);
    const mine = pending.results.find((r) => r.name === `Kite flying ${t}`)!;
    await post(`${stack().apiBase}/list-requests/${mine.requestId}/reject`, { note: 'Already offered as Kites.' }, token);
    await signIn(page, admin.email, admin.password);
    await page.goto('/lists');
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All' }).click();
    const row = page.getByRole('list', { name: 'Requests' }).getByRole('listitem').filter({ hasText: `Kite flying ${t}` });
    await expect(row).toContainText('Already offered as Kites.');
    await expect(row).toContainText('Rejected');
  });

  test('an admin who can only read sees the lists and requests, without changing them', async ({ page }) => {
    const t = tag();
    const member = await newMember('Otieno', `Reads${t}`);
    await shareBackground(member);
    await ask(member, 'organisations', `Acme Kenya ${t}`, 'EMPLOYER');
    const admin = await newAdmin(page, ['LISTS.READ'], 'ListReader');
    await signIn(page, admin.email, admin.password);
    await page.goto('/lists');
    await expect(requestRow(page, `Acme Kenya ${t}`)).toContainText('Waiting');
    await expect(requestRow(page, `Acme Kenya ${t}`).getByRole('button', { name: /^Options/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Lists' }).click();
    await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);
  });
});
