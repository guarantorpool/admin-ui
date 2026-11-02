import { test, type Page } from '@playwright/test';
import { connect, newMember, randomIdNumber, seedGuarantee, seedQuote, signIn, stack, submitAddress, submitKyc, type Member, type SeededGuarantee, type SeededQuote } from './helpers';

// Not a check: screenshots for review, only when SHOTS_DIR is set.
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'SHOTS_DIR not set');

/** A few connected members, made once for every screenshot run. */
let members: Member[] | null = null;
let guarantees: SeededGuarantee[] = [];
let quotes: SeededQuote[] = [];

async function sampleMembers(): Promise<Member[]> {
  if (members) return members;
  const people = [['Amina', 'Wanjiru'], ['Brian', 'Otieno'], ['Grace', 'Achieng'], ['John', 'Kamau']] as const;
  const made: Member[] = [];
  for (const [first, last] of people) made.push(await newMember(first, last));
  const [a, b, c, d] = made as [Member, Member, Member, Member];
  await connect(a, b);
  await connect(c, a, 'MUTUAL_TRUST');
  await connect(a, d);
  await submitKyc(b, { idType: 'national_id', idNumber: randomIdNumber(), dateOfBirth: '1990-02-04', address: 'Kilimani, Nairobi' });
  await submitKyc(c, { idType: 'passport', idNumber: `AK${randomIdNumber()}`, dateOfBirth: '1985-07-19', address: 'Milimani, Kisumu' });
  await submitAddress(b, { latitude: -1.2921, longitude: 36.8219, comment: 'Behind the market, blue gate' });
  guarantees = [seedGuarantee(a), seedGuarantee(c, { flagged: true }), seedGuarantee(d)];
  quotes = [seedQuote(b, { flagged: true, lipa: { status: 'FAILED', message: 'Payment failed, please try again.' } }), seedQuote(d, { lipa: { status: 'PROCESSING' } }), seedQuote(c, { status: 'EXPIRED', quotedDaysAgo: 4 })];
  members = made;
  return made;
}

const settle = (page: Page) => page.waitForLoadState('networkidle');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} @shots`, async ({ page }, info) => {
    const tag = `${info.project.name}-${scheme}`;
    const phone = info.project.name === 'phone';
    await page.emulateMedia({ colorScheme: scheme });
    const [amina, brian] = await sampleMembers();
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

    await page.goto('/kyc');
    await page.getByRole('heading', { name: 'KYC and address review' }).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-14-kyc-queue.png` });
    await page.goto(`/kyc/${brian!.id}`);
    await page.getByRole('dialog', { name: 'Review' }).getByText('Kilimani, Nairobi').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-15-kyc-review.png` });
    await page.getByRole('dialog', { name: 'Review' }).getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('dialog', { name: 'Reject this KYC submission?' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-16-kyc-reject.png` });
    await page.keyboard.press('Escape');
    await page.goto(`/kyc/address/${brian!.id}`);
    await page.getByRole('dialog', { name: 'Review' }).getByText('Behind the market, blue gate').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-17-address-review.png` });
    await page.goto(`/kyc/address?q=${encodeURIComponent(brian!.name.split(' ')[1]!)}`);
    await page.getByRole('table', { name: 'Members' }).or(page.getByRole('list', { name: 'Members' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-18-address-find.png` });

    await page.goto('/guarantees');
    await page.getByRole('table', { name: 'Guarantees' }).or(page.getByRole('list', { name: 'Guarantees' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-19-guarantees.png` });
    const g = guarantees[0]!.guaranteeId;
    for (const [n, t] of [[20, 'overview'], [21, 'pricing'], [22, 'payments']] as const) {
      await page.goto(`/guarantees/${g}?tab=${t}`);
      await page.getByRole('dialog', { name: 'Guarantee details' }).getByRole('heading', { name: g }).waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/${tag}-${n}-guarantee-${t}.png` });
    }
    await page.goto(`/guarantees/${g}`);
    await page.getByRole('dialog', { name: 'Guarantee details' }).getByRole('button', { name: 'Enter a manual close' }).click();
    await page.getByRole('dialog', { name: 'Enter a manual close' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-23-manual-close.png` });
    await page.keyboard.press('Escape');
    await page.goto('/guarantees/quotes');
    await page.getByRole('table', { name: 'Quotes' }).or(page.getByRole('list', { name: 'Quotes' })).waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-24-quotes.png` });
    const q = quotes[0]!.quoteId;
    await page.goto(`/guarantees/quotes/${q}?tab=lipa`);
    await page.getByRole('dialog', { name: 'Quote details' }).getByText('Payment failed, please try again.').waitFor();
    await settle(page);
    await page.screenshot({ path: `${dir}/${tag}-25-quote-lipa.png` });
  });
}
