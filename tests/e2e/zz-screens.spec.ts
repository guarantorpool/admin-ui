import { test } from '@playwright/test';
import { signIn, stack } from './helpers';

// Not a check: screenshots for review, only when SHOTS_DIR is set.
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'SHOTS_DIR not set');

for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} @shots`, async ({ page }, info) => {
    const tag = `${info.project.name}-${scheme}`;
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/sign-in');
    await page.screenshot({ path: `${dir}/${tag}-1-sign-in.png` });
    const { admin } = stack();
    await signIn(page, admin.email, admin.password);
    if (info.project.name === 'desktop') await page.getByRole('button', { name: 'Pool' }).click();
    await page.screenshot({ path: `${dir}/${tag}-2-first-screen.png` });
    await page.goto('/account');
    await page.getByRole('heading', { name: 'Your details' }).waitFor();
    await page.screenshot({ path: `${dir}/${tag}-3-account.png` });
    if (info.project.name === 'phone') {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.screenshot({ path: `${dir}/${tag}-4-menu.png` });
    }
  });
}
