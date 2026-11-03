import { expect, test, type Page } from '@playwright/test';
import { Wallet } from 'ethers';
import { apiToken, call, newAdmin, newSafe, post, signIn, stack } from './helpers';

// Pool wallets are Safes on the chain stand-in (newSafe): the backend reads their signers and threshold from it, as
// it would from BNB Smart Chain. Only one proposal waits at a time, so each test decides the wallets it proposes.

const HEALTH = ['POOL.READ', 'POOL.MANAGE'];
const WALLETS = ['POOL.READ', 'WALLETS.PROPOSE', 'WALLETS.APPROVE'];

const tag = () => Date.now().toString(36);
const movements = (page: Page) => page.getByRole('list', { name: 'Movements' }).getByRole('listitem');
const wallet = (page: Page) => page.getByRole('dialog', { name: 'Pool wallet details' });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The extra liquidity tile's figure, as a number. */
async function extraLiquidity(page: Page): Promise<number> {
  const tile = page.getByRole('tabpanel').getByText('Extra liquidity', { exact: true }).locator('..');
  await expect(tile).not.toContainText('…');
  return Number((await tile.locator('span').nth(2).innerText()).replace(/,/g, ''));
}

async function enterMovement(page: Page, direction: 'top_up' | 'withdrawal', amount: string, reason: string) {
  await page.getByRole('button', { name: 'Enter a movement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enter a movement of extra liquidity' });
  await dialog.getByLabel('Direction').selectOption(direction);
  await dialog.getByLabel('Amount, in USDT').fill(amount);
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: 'Enter the movement' }).click();
  await expect(page.getByText('Movement entered. A second admin approves it.').last()).toBeVisible();
}

async function propose(page: Page, address: string, note?: string) {
  await page.getByRole('button', { name: 'Propose a new wallet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose a new pool wallet' });
  await dialog.getByLabel('Safe address').fill(address);
  if (note) await dialog.getByLabel('Note (optional)').fill(note);
  await dialog.getByRole('button', { name: 'Propose the wallet' }).click();
  return dialog;
}

test.describe('Pool health and pool wallets (slice 7)', () => {
  test('shows the ratios, solvency and factor, and a movement of extra liquidity needs a second admin', async ({ page, browser }) => {
    const first = await newAdmin(page, HEALTH, 'Liquidity');
    await signIn(page, first.email, first.password);
    await page.goto('/pool/health');
    await expect(page.getByRole('heading', { name: 'Pool health' })).toBeVisible();
    for (const card of ['Ratios against their settings', 'Book-wide solvency check', 'Correction factor and the pool totals behind it', 'Liquid Funds']) {
      await expect(page.getByRole('heading', { name: card })).toBeVisible();
    }
    await expect(page.getByText('Base default rate')).toBeVisible();
    await expect(page.getByText(/^setting \d/).first()).toBeVisible();
    await expect(page.getByText('Planned: sweeping money', { exact: false })).toBeVisible();
    // only the extra liquidity tab enters movements
    await expect(page.getByRole('button', { name: 'Enter a movement' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Extra liquidity' }).click();
    await expect(page).toHaveURL(/view=liquidity/);
    const before = await extraLiquidity(page);
    await page.getByRole('button', { name: 'Enter a movement' }).click();
    const dialog = page.getByRole('dialog', { name: 'Enter a movement of extra liquidity' });
    await dialog.getByRole('button', { name: 'Enter the movement' }).click();
    await expect(dialog.getByText('Enter the amount, more than 0.')).toBeVisible();
    await dialog.getByLabel('Amount, in USDT').fill('1500.25');
    await dialog.getByRole('button', { name: 'Enter the movement' }).click();
    await expect(dialog.getByText('Enter the reason for the movement.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const topUp = `Top-up before a claim ${tag()}`;
    const out = `Returned to the sacco ${tag()}`;
    await enterMovement(page, 'top_up', '1500.25', topUp);
    await enterMovement(page, 'withdrawal', '20.123456', out);
    const mine = movements(page).filter({ hasText: topUp });
    await expect(mine).toContainText('Into Liquid Funds: 1,500.25 USDT');
    await expect(mine).toContainText('Waiting for approval');
    await expect(mine).toContainText('Entered by you');
    await expect(mine).toContainText('You entered it, so a different admin approves or rejects it.');
    await expect(mine.getByRole('button', { name: 'Approve' })).toBeDisabled();
    // waiting, so at full precision
    await expect(movements(page).filter({ hasText: out })).toContainText('Out of Liquid Funds: 20.123456 USDT');
    // nothing counts until it's approved
    expect(await extraLiquidity(page)).toBe(before);

    const other = await browser.newPage();
    const second = await newAdmin(other, HEALTH, 'LiqApprover');
    await signIn(other, second.email, second.password);
    await other.goto('/pool/health?view=liquidity&status=pending');
    const theirs = movements(other).filter({ hasText: topUp });
    await expect(theirs).toContainText(`Entered by ${first.email}`);
    await theirs.getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this movement?' });
    await expect(approve.getByText('Liquid Funds go up by this amount.')).toBeVisible();
    await expect(approve.getByText(topUp)).toBeVisible();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(other.getByText('Approved: Into Liquid Funds, 1,500.25 USDT.')).toBeVisible();
    // the waiting filter no longer lists it
    await expect(theirs).toHaveCount(0);
    expect(await extraLiquidity(other)).toBeCloseTo(before + 1500.25, 2);

    await movements(other).filter({ hasText: out }).getByRole('button', { name: 'Reject' }).click();
    const reject = other.getByRole('dialog', { name: 'Reject this movement?' });
    await expect(reject.getByText('20.123456 USDT')).toBeVisible();
    await reject.getByLabel('Note (optional)').fill('Not agreed with the sacco');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(other.getByText('Rejected: Out of Liquid Funds, 20.123456 USDT.')).toBeVisible();

    await other.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All', exact: true }).click();
    await expect(movements(other).filter({ hasText: topUp })).toContainText('Approved');
    await expect(movements(other).filter({ hasText: topUp })).toContainText(`approved by ${second.email}`);
    const rejected = movements(other).filter({ hasText: out });
    await expect(rejected).toContainText('Rejected');
    await expect(rejected).toContainText('Note: Not agreed with the sacco');
    // decided, so the list shows them to 2 decimals
    await expect(rejected).toContainText('Out of Liquid Funds: 20.12 USDT');
    await other.close();
  });

  test('a Safe is proposed, approved by a second admin, and retires the wallet before it', async ({ page, browser }) => {
    const first = await newAdmin(page, WALLETS, 'Proposer');
    await signIn(page, first.email, first.password);
    await page.goto('/pool/wallets');
    await expect(page.getByRole('heading', { name: 'Pool wallets' })).toBeVisible();

    // checked here, then by the backend against the chain
    let dialog = await propose(page, '0x1234');
    await expect(dialog.getByText('Enter the Safe address: 0x followed by 40 hexadecimal characters.')).toBeVisible();
    const ordinary = Wallet.createRandom().address;
    await dialog.getByLabel('Safe address').fill(ordinary);
    await dialog.getByRole('button', { name: 'Propose the wallet' }).click();
    await expect(dialog.getByText('is not a contract: a pool wallet must be a multisig contract', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const other = await browser.newPage();
    const second = await newAdmin(other, WALLETS, 'WalletApprover');
    await signIn(other, second.email, second.password);

    // two wallets in turn: the second retires the first
    const safes = [await newSafe(3, 2), await newSafe(5, 3)];
    for (const [i, safe] of safes.entries()) {
      // afresh, as the second admin's approval isn't pushed to this page
      await page.goto('/pool/wallets');
      dialog = await propose(page, safe.address, `Scheduled replacement ${i + 1}`);
      await expect(page.getByText('Wallet proposed. A second admin approves it.')).toBeVisible();
      await expect(page).toHaveURL(/\/pool\/wallets\/[0-9a-f-]{36}$/);
      const mine = wallet(page);
      await expect(mine.getByRole('heading', { name: `Safe ${short(safe.address)}` })).toBeVisible();
      await expect(mine.getByText(safe.address, { exact: true }).first()).toBeVisible();
      await expect(mine.getByText(`${i ? 3 : 2} of ${i ? 5 : 3}`).first()).toBeVisible();
      for (const owner of safe.owners) await expect(mine.getByRole('list', { name: 'Signers' }).getByText(owner)).toBeVisible();
      await expect(mine.getByText(/Proposed by you/)).toBeVisible();
      await expect(mine.getByText('You proposed it, so a different admin approves or rejects it.')).toBeVisible();
      await expect(mine.getByRole('button', { name: 'Approve' })).toBeDisabled();
      await page.keyboard.press('Escape');
      // one proposal waits at a time
      await expect(page.getByRole('button', { name: 'Propose a new wallet' })).toBeDisabled();
      await expect(page.getByText('A new wallet is waiting for approval.', { exact: false })).toBeVisible();

      await other.goto('/pool/wallets');
      await other.getByRole('table', { name: 'Pool wallets' }).getByRole('link').filter({ hasText: short(safe.address) }).click();
      await expect(wallet(other).getByText(`Proposed by ${first.email}`, { exact: false })).toBeVisible();
      await wallet(other).getByRole('button', { name: 'Approve' }).click();
      const approve = other.getByRole('dialog', { name: 'Approve this pool wallet?' });
      await expect(approve.getByText(safe.owners[0]!)).toBeVisible();
      await approve.getByRole('button', { name: 'Approve' }).click();
      await expect(other.getByText(`The pool wallet is now ${short(safe.address)}.`)).toBeVisible();
      await expect(wallet(other).getByText('Current', { exact: true })).toBeVisible();
      await expect(wallet(other).getByText(`${second.email}, `, { exact: false })).toBeVisible();
    }

    // the first is retired, and still watched for payments
    await other.goto('/pool/wallets');
    const rows = other.getByRole('table', { name: 'Pool wallets' }).getByRole('link');
    await expect(rows.filter({ hasText: short(safes[1]!.address) })).toContainText('Current');
    await expect(rows.filter({ hasText: short(safes[0]!.address) })).toContainText('Retired');
    await rows.filter({ hasText: short(safes[0]!.address) }).click();
    await expect(wallet(other).getByText('Watched for payments until')).toBeVisible();
    // members pay into the current one
    const { apiBase, admin } = stack();
    const current = await call<{ address: string }>('GET', `${apiBase}/pool/wallet`, undefined, await apiToken(admin.email, admin.password));
    expect(current.address).toBe(safes[1]!.address);
    await other.close();
  });

  test('approving is refused when the Safe changed after it was proposed, and it can be rejected', async ({ page, browser }) => {
    const first = await newAdmin(page, WALLETS, 'Changer');
    await signIn(page, first.email, first.password);
    await page.goto('/pool/wallets');
    const safe = await newSafe(3, 2);
    await propose(page, safe.address);
    await expect(page.getByText('Wallet proposed. A second admin approves it.')).toBeVisible();
    // a signer is swapped on the Safe while it waits
    await post(`${stack().chainUrl}/safes`, { address: safe.address, owners: [...safe.owners.slice(0, 2), Wallet.createRandom().address], threshold: 2 });

    const other = await browser.newPage();
    const second = await newAdmin(other, WALLETS, 'Refuser');
    await signIn(other, second.email, second.password);
    await other.goto(new URL(page.url()).pathname);
    await wallet(other).getByRole('button', { name: 'Approve' }).click();
    const approve = other.getByRole('dialog', { name: 'Approve this pool wallet?' });
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(approve.getByText("The wallet's signers or threshold changed after it was proposed.", { exact: false })).toBeVisible();
    await approve.getByRole('button', { name: 'Cancel' }).click();

    await wallet(other).getByRole('button', { name: 'Reject' }).click();
    const reject = other.getByRole('dialog', { name: 'Reject this pool wallet?' });
    await reject.getByLabel('Note (optional)').fill('A signer changed; propose it again');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(other.getByText(`Wallet ${short(safe.address)} rejected.`)).toBeVisible();
    await expect(wallet(other).getByText('Rejected', { exact: true }).first()).toBeVisible();
    await expect(wallet(other).getByText('A signer changed; propose it again')).toBeVisible();
    await other.keyboard.press('Escape');
    await expect(other.getByRole('button', { name: 'Propose a new wallet' })).toBeEnabled();
    await other.close();
  });

  test('a read-only role sees both screens without actions, and a role without POOL.READ neither', async ({ page, browser }) => {
    const reader = await newAdmin(page, ['POOL.READ'], 'PoolReader');
    await signIn(page, reader.email, reader.password);
    await page.goto('/pool/health?view=liquidity');
    await expect(page.getByRole('tabpanel').getByText('Extra liquidity', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter a movement' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await page.goto('/pool/wallets');
    await expect(page.getByRole('heading', { name: 'Pool wallets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose a new wallet' })).toHaveCount(0);

    const other = await browser.newPage();
    const outsider = await newAdmin(other, ['REFUNDS.READ'], 'NoPool');
    await signIn(other, outsider.email, outsider.password);
    await expect(other.getByRole('link', { name: 'Pool health' })).toHaveCount(0);
    await other.goto('/pool/wallets');
    await expect(other.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
    await other.close();
  });
});
