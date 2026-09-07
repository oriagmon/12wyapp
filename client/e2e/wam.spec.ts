import { test, expect, type Page } from '@playwright/test';

async function registerUser(page: Page, email: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '12wyapp' })).toBeVisible();
  await page.getByRole('tab', { name: 'הרשמה' }).click();
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('password123');
  await page.getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.getByText(email)).toBeVisible();
}

/**
 * Real-browser smoke test for shared Weekly Accountability Meetings (WAMs): two
 * separate users (separate browser contexts) pair up, then run a full single-flow
 * meeting — start it, edit shared content, each rates themselves, add & toggle a
 * commitment, mark complete, then reopen.
 */
test('two partners pair up and run a Weekly Accountability Meeting', async ({ browser, baseURL }) => {
  const stamp = Date.now();
  const emailA = `wam_a_${stamp}@example.com`;
  const emailB = `wam_b_${stamp}@example.com`;

  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await registerUser(pageA, emailA);
  await registerUser(pageB, emailB);

  // A's candidate list was fetched before B existed; reload to pick up the newly
  // registered user (the discoverable-users list isn't live-pushed).
  await pageA.reload();

  // A pairs directly with B — no invitation/acceptance step.
  await pageA.getByLabel('חיפוש משתמש/ת לבחירה כשותף/ה').fill(emailB);
  await pageA.getByRole('button', { name: 'בחירה כשותף/ה' }).click();
  await expect(pageA.getByText('מחובר/ת עם')).toBeVisible();

  // B sees the mutual partnership immediately too (after a reload of their own session).
  await pageB.reload();
  await expect(pageB.getByText(`מחובר/ת עם`)).toBeVisible();

  // A opens the accountability-meetings tab and starts week 1's meeting via the
  // "start/open by week" control (always targets the current active cycle).
  await pageA.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'פגישות WAM' }).click();
  await expect(pageA.getByText('כל הפגישות (0)')).toBeVisible();
  await pageA.getByRole('button', { name: 'פתיחה / התחלה' }).click();

  await expect(pageA.getByText('סקירת ציונים — שבוע 1')).toBeVisible();

  // Edit a shared content field.
  await pageA.getByLabel('ניצחונות / הישגים').fill('סיימנו את השבוע הראשון בהצלחה');
  await pageA.getByLabel('ניצחונות / הישגים').blur();
  await expect(pageA.getByText('נשמר ✓').first()).toBeVisible();

  // A rates themself (their own rating group is explicitly labeled).
  await pageA.getByRole('group', { name: 'הדירוג העצמי שלי (1-10)' }).getByRole('button', { name: '8 מתוך 10' }).click();
  await expect(pageA.getByText('8/10').first()).toBeVisible();

  // Add and toggle a shared commitment.
  await pageA.getByLabel('טקסט התחייבות חדשה').fill('לתכנן את השבוע הבא יחד');
  await pageA.getByRole('button', { name: 'הוספה', exact: true }).first().click();
  await expect(pageA.getByRole('textbox', { name: 'טקסט ההתחייבות' })).toHaveValue('לתכנן את השבוע הבא יחד');
  await expect(pageA.getByLabel('טקסט התחייבות חדשה')).toHaveValue(''); // input clears after a successful add
  await pageA.getByRole('listitem').getByRole('checkbox').click();

  // B opens the same shared meeting and sees A's content, rating, and commitment.
  await pageB.reload();
  await pageB.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'פגישות WAM' }).click();
  await pageB.getByRole('button', { name: 'פתיחה' }).first().click();
  await expect(pageB.getByLabel('ניצחונות / הישגים')).toHaveValue('סיימנו את השבוע הראשון בהצלחה');
  await expect(pageB.getByRole('textbox', { name: 'טקסט ההתחייבות' })).toHaveValue('לתכנן את השבוע הבא יחד');
  await expect(pageB.getByRole('listitem').getByRole('checkbox')).toBeChecked();

  // B rates themself too — both ratings are now visible to both users.
  await pageB.getByRole('group', { name: 'הדירוג העצמי שלי (1-10)' }).getByRole('button', { name: '6 מתוך 10' }).click();
  await expect(pageB.getByText('6/10').first()).toBeVisible();

  // Either partner can mark the meeting complete; leaving the next-WAM date empty
  // completes without scheduling one (see the WamCompletionPanel client tests for
  // the scheduled-invite path).
  await pageB.getByRole('button', { name: '✓ סימון הפגישה כהושלמה' }).click();
  await pageB.getByRole('button', { name: 'אישור השלמה ללא תיאום פגישה הבאה' }).click();
  await expect(pageB.getByText('הושלמה').first()).toBeVisible();
  await pageB.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click();

  // Content editing is now blocked until reopened.
  await expect(pageB.getByLabel('ניצחונות / הישגים')).toBeDisabled();

  // Explicit reopen brings it back to draft and unblocks editing.
  await pageB.getByRole('button', { name: '↺ פתיחה מחדש לעריכה' }).click();
  await expect(pageB.getByText('טיוטה').first()).toBeVisible();
  await expect(pageB.getByLabel('ניצחונות / הישגים')).toBeEnabled();

  await contextA.close();
  await contextB.close();
});
