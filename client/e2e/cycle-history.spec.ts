import { test, expect } from '@playwright/test';

/**
 * Real-browser smoke test for V1 multi-cycle history: finishing a cycle archives it
 * (never deletes it) and immediately starts a fresh one; the archived cycle remains
 * fully visible, read-only, in the "מחזורים קודמים" (previous cycles) tab.
 */
test('finishing a cycle archives it as read-only history and starts a fresh one', async ({ page }) => {
  const email = `history_${Date.now()}@example.com`;

  await page.goto('/');
  await page.getByRole('tab', { name: 'הרשמה' }).click();
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('password123');
  await page.getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.getByText(email)).toBeVisible();

  await page.getByLabel('שם המחזור החדש').fill('מחזור ראשון');
  await page.getByRole('button', { name: '+ יצירת מחזור ראשון' }).click();
  await expect(page.getByLabel('שם המחזור', { exact: true })).toHaveValue('מחזור ראשון');

  // Finish the cycle (archives it) and start a new one.
  await page.getByRole('button', { name: 'סיום מחזור והתחלת מחזור חדש' }).click();
  await page.getByLabel('שם המחזור החדש').fill('מחזור שני');
  await page.getByRole('button', { name: 'אישור וסיום המחזור' }).click();

  // The header now reflects the brand-new active cycle.
  await expect(page.getByLabel('שם המחזור', { exact: true })).toHaveValue('מחזור שני');

  // The old cycle is preserved, read-only, under "מחזורים קודמים".
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'מחזורים קודמים' }).click();
  await expect(page.getByText('כל המחזורים (2)')).toBeVisible();
  await expect(page.getByText('מחזור ראשון')).toBeVisible();
  await expect(page.getByText('הסתיים')).toBeVisible();

  await page
    .locator('li', { hasText: 'מחזור ראשון' })
    .getByRole('button', { name: 'צפייה' })
    .click();
  await expect(page.getByText('🔒 מחזור זה הסתיים ונשמר לצמיתות כהיסטוריה לקריאה בלבד')).toBeVisible();
});
