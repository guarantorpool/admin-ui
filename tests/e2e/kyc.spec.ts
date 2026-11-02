import { expect, test, type Page } from '@playwright/test';
import { newAdmin, newMember, randomIdNumber, signIn, submitAddress, submitKyc } from './helpers';

/** A surname no other test's member has, so a search finds only this test's members (letters only, as names must be). */
const surname = () => 'K' + Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const search = (page: Page) => page.getByRole('searchbox', { name: /Search by name/ });
const review = (page: Page) => page.getByRole('dialog', { name: 'Review' });
const REVIEWER = ['MEMBERS.READ', 'MEMBERS.KYC'];

test.describe('KYC and address review (slice 3)', () => {
  test('rejects one KYC submission with a reason and verifies another', async ({ page }) => {
    const last = surname();
    const amina = await newMember('Amina', last);
    const brian = await newMember('Brian', last);
    const aminaId = randomIdNumber();
    await submitKyc(amina, { idType: 'national_id', idNumber: aminaId, dateOfBirth: '1990-02-04', address: 'Kilimani, Nairobi' });
    await submitKyc(brian, { idType: 'passport', idNumber: `AK${randomIdNumber()}`, dateOfBirth: '1985-07-19', address: 'Milimani, Kisumu' });
    const user = await newAdmin(page, REVIEWER, 'Kyc');
    await signIn(page, user.email, user.password);

    await page.goto('/kyc');
    await expect(page.getByRole('heading', { name: 'KYC and address review' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await search(page).fill(last);
    await expect(page).toHaveURL(new RegExp(`q=${last}`));
    const rows = page.getByRole('table', { name: 'KYC submissions' }).getByRole('link');
    await expect(rows).toHaveCount(2);

    // the details are shown decrypted, with the ID document
    await rows.filter({ hasText: `Amina ${last}` }).click();
    await expect(page).toHaveURL(new RegExp(`/kyc/${amina.id}\\?q=${last}$`));
    const panel = review(page);
    await expect(panel.getByRole('heading', { name: `Amina ${last}` })).toBeVisible();
    await expect(panel.getByText(aminaId)).toBeVisible();
    await expect(panel.getByText('National ID', { exact: true })).toBeVisible();
    await expect(panel.getByText('4 Feb 1990')).toBeVisible();
    await expect(panel.getByText('Kilimani, Nairobi')).toBeVisible();
    await expect(panel.getByRole('list', { name: 'ID documents' })).toContainText('National ID, both sides');

    // R2 isn't reached locally, so the signed link is answered by a stand-in
    await page.route('**/api/uploads/file/*', (route) => route.fulfill({ json: { url: 'http://localhost:3001/stand-in-file' } }));
    const [file] = await Promise.all([page.waitForEvent('popup'), panel.getByRole('button', { name: 'Open the file' }).click()]);
    await expect(file).toHaveURL('http://localhost:3001/stand-in-file');
    await file.close();

    // a rejection needs a reason, which the member sees
    await panel.getByRole('button', { name: 'Reject' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject this KYC submission?' });
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(reject.getByText('Give a reason. The member sees it.')).toBeVisible();
    await reject.getByLabel('Reason').fill('The photo of the ID is unreadable');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText(`KYC rejected for Amina ${last}.`)).toBeVisible();
    await expect(panel.getByText('Reason: The photo of the ID is unreadable')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Verify' })).toHaveCount(0);

    // only Brian is still waiting
    await page.keyboard.press('Escape');
    await expect(review(page)).toBeHidden();
    await expect(rows).toHaveCount(1);
    await rows.click();
    await review(page).getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('dialog', { name: 'Verify this KYC submission?' }).getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(`KYC verified for Brian ${last}.`)).toBeVisible();
    await expect(review(page).getByText(/^Verified /)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Nothing is waiting for review.')).toBeVisible();

    await page.getByRole('button', { name: 'Verified', exact: true }).click();
    await expect(rows).toHaveText([new RegExp(`Brian ${last}`)]);
    await page.getByRole('button', { name: 'Rejected', exact: true }).click();
    await expect(rows).toHaveText([new RegExp(`Amina ${last}`)]);
    await expect(page).toHaveURL(/status=rejected/);
  });

  test("reviews a member's proof of address from their page", async ({ page }) => {
    const last = surname();
    const grace = await newMember('Grace', last);
    await submitAddress(grace, { latitude: -1.2921, longitude: 36.8219, comment: 'Behind the market, blue gate' });
    const user = await newAdmin(page, REVIEWER, 'Address');
    await signIn(page, user.email, user.password);

    await page.goto(`/members/${grace.id}`);
    await expect(page.getByRole('dialog', { name: 'Member details' }).getByText('Map pin only')).toBeVisible();
    await page.getByRole('link', { name: 'Review proof of address' }).click();
    await expect(page).toHaveURL(new RegExp(`/kyc/address/${grace.id}$`));
    const panel = review(page);
    await expect(panel.getByRole('tab', { name: 'Proof of address' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByText('-1.2921, 36.8219')).toBeVisible();
    await expect(panel.getByText('Behind the market, blue gate')).toBeVisible();
    const document = panel.getByRole('list', { name: 'Documents' }).getByRole('listitem');
    await expect(document).toContainText('Utility bill');
    await expect(document).toContainText('Pending');

    await document.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve this document?' }).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(`Document approved for Grace ${last}.`)).toBeVisible();
    await expect(document).toContainText('Approved');
    await expect(document).toContainText('counts until');
    await expect(document.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(panel.getByText('Complete', { exact: true })).toBeVisible();

    // the same member's KYC is a tab away
    await panel.getByRole('tab', { name: 'KYC submission' }).click();
    await expect(panel.getByText("This member hasn't submitted KYC details.")).toBeVisible();

    // the address tab finds members one at a time until there's one queue
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/kyc\/address$/);
    await expect(page.getByText('Planned: one queue of documents')).toBeVisible();
    await expect(page.getByText('Search for the member whose documents you want to review.')).toBeVisible();
    await search(page).fill(last);
    const row = page.getByRole('table', { name: 'Members' }).getByRole('link');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Complete');
  });

  test('is closed to a role without MEMBERS.KYC', async ({ page }) => {
    const member = await newMember('Peter', surname());
    const user = await newAdmin(page, ['MEMBERS.READ'], 'NoKyc');
    await signIn(page, user.email, user.password);
    await expect(page.getByRole('link', { name: 'KYC and address review' })).toHaveCount(0);
    await page.goto('/kyc');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
    await page.goto(`/members/${member.id}`);
    await expect(page.getByRole('dialog', { name: 'Member details' }).getByRole('heading', { name: member.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review KYC' })).toHaveCount(0);
  });
});
