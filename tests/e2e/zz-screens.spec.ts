import { test, type Page } from '@playwright/test';
import { connect, newMember, signIn, stack, type Member } from './helpers';

// Not a check: screenshots for review, only when SHOTS_DIR is set.
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'SHOTS_DIR not set');

/** A few connected members, made once for every screenshot run. */
let members: Member[] | null = null;
async function sampleMembers(): Promise<Member[]> {
  if (members) return members;
  const people = [['Amina', 'Wanjiru'], ['Brian', 'Otieno'], ['Grace', 'Achieng'], ['John', 'Kamau']] as const;
  const made: Member[] = [];
  for (const [first, last] of people) made.push(await newMember(first, last));
  const [a, b, c, d] = made as [Member, Member, Member, Member];
  await connect(a, b);
  await connect(c, a, 'MUTUAL_TRUST');
  await connect(a, d);
  members = made;
  return made;
}

const settle = (page: Page) => page.waitForLoadState('networkidle');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} @shots`, async ({ page }, info) => {
    const tag = `${info.project.name}-${scheme}`;
    const phone = info.project.name === 'phone';
    await page.emulateMedia({ colorScheme: scheme });
    const [amina] = await sampleMembers();
    await page.goto('/sign-in');
    await page.screenshot({ path: `${dir}/${tag}-1-sign-in.png` });
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    if (!phone) await page.getByRole('button', { name: 'Pool' }).click();
    await page.screenshot({ path: `${dir}/${tag}-2-first-screen.png` });
    await page.goto('/account');
    await page.getByRole('heading', { name: 'Your details' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-3-account.png` });
    if (phone) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.screenshot({ path: `${dir}/${tag}-4-menu.png` });
    }

    await page.goto('/members');
    await page.getByRole('heading', { name: 'All members' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-5-members.png` });
    for (const [n, t] of [[6, 'overview'], [7, 'trust'], [8, 'connections'], [9, 'limit'], [10, 'backing']] as const) {
      await page.goto(`/members/${amina!.id}${t === 'overview' ? '' : `?tab=${t}`}`);
      await page.getByRole('dialog', { name: 'Member details' }).getByRole('heading', { name: amina!.name }).waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-${n}-member-${t}.png`, fullPage: t === 'trust' });
    }
    if (!phone) {
      await page.goto('/members');
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-11-members-list-view.png` });
      await page.getByRole('button', { name: 'Table', exact: true }).click();
      await page.getByRole('button', { name: `Options for ${amina!.name}` }).click();
      await page.screenshot({ path: `${dir}/${tag}-12-member-options.png` });
      await page.keyboard.press('Escape');
      await page.goto(`/members/${amina!.id}`);
      await page.getByRole('button', { name: 'Disable the member' }).click();
      await page.getByRole('dialog', { name: /Disable Amina/ }).waitFor();
      await page.screenshot({ path: `${dir}/${tag}-13-disable.png` });
    }
  });
}
