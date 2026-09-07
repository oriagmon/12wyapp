import { test, expect } from '@playwright/test';

/**
 * Real-browser smoke test: registers a fresh user, creates a cycle, adds a goal and a
 * tactic via the goals/tactics tab, and verifies the weekly grid updates. Uses a random
 * email each run so it can be re-run against a persistent dev database without colliding.
 */
test('register, create cycle/goal/tactic, and see the dashboard update', async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '12wyapp' })).toBeVisible();

  await page.getByRole('tab', { name: 'הרשמה' }).click();
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('password123');
  await page.getByRole('button', { name: 'הרשמה' }).click();

  await expect(page.getByText(email)).toBeVisible();

  // Empty-cycle state: create the first cycle.
  await page.getByLabel('שם המחזור החדש').fill('מחזור בדיקה');
  await page.getByRole('button', { name: '+ יצירת מחזור ראשון' }).click();

  await expect(page.getByLabel('שם המחזור')).toHaveValue('מחזור בדיקה');

  // Switch to the goals/tactics tab and use the first-goal empty-state CTA.
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'מטרות וטקטיקות' }).click();
  await page.getByRole('button', { name: '+ הוספת מטרה ראשונה' }).click();
  await page.getByLabel('שם מטרה חדשה').fill('מטרת בדיקה');
  await page.getByRole('button', { name: 'הוספה' }).click();
  await expect(page.getByLabel('שם המטרה')).toHaveValue('מטרת בדיקה');

  await page.getByRole('button', { name: '+ הוספת טקטיקה' }).click();
  await page.getByLabel('שם הטקטיקה').fill('טקטיקת בדיקה');
  await page.getByRole('button', { name: 'א׳' }).click();
  await page.getByRole('button', { name: 'הוספה' }).first().click();

  await expect(page.getByText('טקטיקת בדיקה').first()).toBeVisible();

  // Weekly grid (in the "week dashboard" tab) should reflect the new tactic too.
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'מעקב שבועי' }).click();
  await expect(page.getByText('טקטיקת בדיקה').first()).toBeVisible();
});
