import { expect, test, type Page } from '@playwright/test';
import { newAdmin, randomHash, resolveAlert, seedAlert, signIn } from './helpers';

// Alerts are seeded into the throwaway database (see seedAlert): a local run never has the Lipa API refuse a
// payment or the KES rate go stale.

const details = (page: Page) => page.getByRole('dialog', { name: 'Alert details' });
const quoteNumber = () => `GPQ-${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')}`;

/** An alert for a refused Lipa payment, as LipaPaymentService raises one. */
function refusedPayment() {
  const quote = quoteNumber();
  const summary = `A Lipa payment for quote ${quote} was refused: the amount sent was less than the amount due`;
  const id = seedAlert({
    type: 'LIPA_PAYMENT_REFUSED',
    summary,
    count: 3,
    minutesAgo: 0,
    details: { quoteId: quote, paymentId: 'lipa-pay-81273', txHash: randomHash(), reason: 'the amount sent was less than the amount due' }
  });
  return { id, quote, summary };
}

test.describe('Alerts (slice 10)', () => {
  test('lists open alerts, shows what triggered one, and acknowledges it with a note', async ({ page }) => {
    const refused = refusedPayment();
    const stale = seedAlert({
      type: 'KES_RATE_STALE',
      summary: `The KES rate is out of date, so KES deposits count for nothing as backing (${quoteNumber()})`,
      minutesAgo: 5,
      details: { rateSource: 'manual', rateUpdatedAt: '2026-10-30T09:00:00Z', maxAgeHours: 48 }
    });
    const done = seedAlert({ type: 'REFUND_VOLUME', severity: 'WARNING', summary: `12 refunds in the last 24 hours (${quoteNumber()})`, status: 'RESOLVED', note: 'Lipa fixed their rounding', minutesAgo: 10 });
    const admin = await newAdmin(page, ['ALERTS.READ', 'ALERTS.MANAGE', 'GUARANTEES.READ'], 'AlertManager');
    await signIn(page, admin.email, admin.password);

    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible();
    // opens on the open alerts, most recently seen first
    await expect(page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Open/ })).toHaveAttribute('aria-pressed', 'true');
    const rows = page.getByRole('table', { name: 'Alerts' });
    await expect(rows.getByRole('link').first()).toContainText(refused.summary);
    await expect(rows.getByRole('link', { name: new RegExp(refused.quote) })).toContainText('Lipa payment refused');
    await expect(rows.getByRole('link', { name: new RegExp(refused.quote) })).toContainText('3 times');
    await expect(rows.getByText(/12 refunds in the last 24 hours/)).toHaveCount(0);

    await page.getByLabel('Triggered by').selectOption('KES_RATE_STALE');
    await expect(page).toHaveURL(/type=KES_RATE_STALE/);
    await expect(rows.getByRole('link').first()).toContainText('KES rate out of date');
    await expect(rows.getByText(refused.summary)).toHaveCount(0);
    await page.getByLabel('Triggered by').selectOption('');
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Resolved/ }).click();
    await expect(rows.getByRole('link').filter({ hasText: '12 refunds in the last 24 hours' })).toContainText('Resolved');
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Open/ }).click();

    await rows.getByRole('link', { name: new RegExp(refused.quote) }).click();
    await expect(page).toHaveURL(new RegExp(`/alerts/${refused.id}$`));
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: 'Lipa payment refused' })).toBeVisible();
    await expect(panel.getByText(refused.summary)).toBeVisible();
    const triggered = panel.getByRole('region', { name: 'What triggered it' });
    await expect(triggered.getByText('the amount sent was less than the amount due')).toBeVisible();
    await expect(triggered.getByRole('link', { name: refused.quote })).toHaveAttribute('href', `/guarantees/quotes/${refused.quote}`);
    await expect(triggered.getByText('lipa-pay-81273')).toBeVisible();

    await panel.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(panel.getByText('Say what was done.')).toBeVisible();
    await panel.getByLabel('What was done').fill('Asked the member to pay the rest; Lipa refunds the short payment');
    await panel.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Alert acknowledged.')).toBeVisible();
    await expect(panel.getByText(`${admin.email},`)).toBeVisible();
    await expect(panel.getByText('Asked the member to pay the rest; Lipa refunds the short payment')).toBeVisible();
    await expect(panel.getByText(/It resolves on its own once its condition clears/)).toBeVisible();
    await expect(panel.getByRole('form', { name: 'Acknowledge' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(rows.getByText(refused.summary)).toHaveCount(0);
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Acknowledged/ }).click();
    await expect(rows.getByRole('link', { name: new RegExp(refused.quote) })).toContainText('Acknowledged');

    // an alert not on the list shown still opens from its link
    await page.goto(`/alerts/${done}`);
    await expect(details(page).getByText('Lipa fixed their rounding')).toBeVisible();
    await expect(details(page).getByText(/Resolved: its condition cleared/)).toBeVisible();

    // one that resolves while it's open can't be acknowledged any more
    await page.goto(`/alerts/${stale}`);
    await expect(details(page).getByRole('heading', { name: 'KES rate out of date' })).toBeVisible();
    resolveAlert(stale);
    await details(page).getByLabel('What was done').fill('Entered a new rate');
    await details(page).getByRole('button', { name: 'Acknowledge' }).click();
    await expect(details(page).getByText('Only an open alert can be acknowledged; this one is resolved')).toBeVisible();
  });

  test('the bell shows the open alerts, each opening on the Alerts screen', async ({ page }) => {
    const refused = refusedPayment();
    const reader = await newAdmin(page, ['ALERTS.READ'], 'AlertReader');
    await signIn(page, reader.email, reader.password);
    const bell = page.getByRole('button', { name: /^Notifications, \d+ open alerts?$/ });
    await bell.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toContainText(refused.summary);
    await menu.getByRole('menuitem').first().click();
    await expect(page).toHaveURL(new RegExp(`/alerts/${refused.id}$`));
    await expect(details(page).getByText(refused.summary)).toBeVisible();
    // a role that can only read sees no way to acknowledge
    await expect(details(page).getByText("Your role can view this but can't acknowledge it.")).toBeVisible();
    await expect(details(page).getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
    // and the quote isn't a link without GUARANTEES.READ
    await expect(details(page).getByRole('link', { name: refused.quote })).toHaveCount(0);
  });

  test('is closed to a role without ALERTS.READ, whose bell shows no alerts', async ({ page }) => {
    refusedPayment();
    const other = await newAdmin(page, ['MEMBERS.READ'], 'NoAlerts');
    await signIn(page, other.email, other.password);
    await expect(page.getByRole('navigation', { name: 'Admin screens' }).getByRole('link', { name: 'Alerts' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Not available to your role' })).toBeVisible();
  });
});
