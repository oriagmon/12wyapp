import { test, expect, type APIRequestContext } from '@playwright/test';

async function register(api: APIRequestContext, name: string) {
  const email = `astra_${name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}@example.test`;
  await expect(await api.post('/api/auth/register', { data: { email, password: 'isolated-test-password' } })).toBeOK();
  await expect(await api.patch('/api/profile', { data: { displayName: name, bio: '' } })).toBeOK();
  const response = await api.get('/api/auth/me');
  await expect(response).toBeOK();
  const user: { id: number } = await response.json();
  return user.id;
}

async function seedSuccessfulWeek(api: APIRequestContext, doneDays = 7) {
  await expect(await api.post('/api/cycle', { data: { name: 'מחזור מקור Astra' } })).toBeOK();
  const goalResponse = await api.post('/api/goals', { data: { title: 'מטרת מקור Astra' } });
  await expect(goalResponse).toBeOK();
  const goal: { id: number } = await goalResponse.json();
  const tacticResponse = await api.post('/api/tactics', {
    data: { goalId: goal.id, title: 'פעולת מקור Astra', weekdays: [0, 1, 2, 3, 4, 5, 6], startWeek: 1, endWeek: 12 },
  });
  await expect(tacticResponse).toBeOK();
  const tactic: { id: number } = await tacticResponse.json();
  for (let weekday = 0; weekday < doneDays; weekday++) {
    await expect(await api.post('/api/completions/toggle', {
      data: { tacticId: tactic.id, week: 1, weekday, done: true },
    })).toBeOK();
  }
}

test('archive search opens the exact historical tactic without changing the active cycle', async ({ page }) => {
  const userId = await register(page.request, 'Archive');
  await seedSuccessfulWeek(page.request);
  await expect(await page.request.post('/api/cycle/reset', { data: { name: 'מחזור חדש Astra', confirm: true } })).toBeOK();
  await page.goto('/');
  await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'עוד' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'חיפוש בארכיון' }).click();
  await page.getByLabel('מה לחפש?').fill('פעולת מקור Astra');
  await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
  await page.getByRole('button', { name: /פעולת מקור Astra/ }).click();
  await expect(page.getByText('🔒 מחזור זה הסתיים ונשמר לצמיתות כהיסטוריה לקריאה בלבד')).toBeVisible();
  await expect(page.getByText('פעולת מקור Astra').first()).toBeVisible();
  const dashboard = await page.request.get(`/api/dashboard/${userId}`);
  await expect(dashboard).toBeOK();
  const data: { cycle: { name: string; currentWeek: number } } = await dashboard.json();
  expect(data.cycle).toMatchObject({ name: 'מחזור חדש Astra', currentWeek: 1 });
});

test('Duo celebration fits mobile, traps focus, and never replays after reload', async ({ page, browser, baseURL }, testInfo) => {
  const partner = await browser.newContext({ baseURL });
  try {
    await register(page.request, 'Astra Alpha');
    const partnerId = await register(partner.request, 'Astra Beta');
    await seedSuccessfulWeek(page.request);
    await seedSuccessfulWeek(partner.request);
    await expect(await page.request.post('/api/partnerships/pair', { data: { targetUserId: partnerId } })).toBeOK();
    await expect(await page.request.post('/api/wams', { data: { week: 1 } })).toBeOK();
    await page.goto('/');
    await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'פגישה משותפת' }).click();
    await page.getByRole('button', { name: 'פתיחה', exact: true }).first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '✓ סימון הפגישה כהושלמה' }).click();
    await page.getByRole('button', { name: 'אישור השלמה ללא תיאום פגישה הבאה' }).click();
    const dialog = page.getByRole('dialog', { name: 'הצלחה משותפת!' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Astra Alpha', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Astra Beta', { exact: true })).toBeVisible();
    const close = dialog.getByRole('button', { name: 'סגירה' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('duo-mobile.png') });
    await close.click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  } finally {
    await partner.close();
  }
});

test('profile heatmap has 84 inspectable days and keyboard navigation', async ({ page }) => {
  await register(page.request, 'Heatmap');
  await seedSuccessfulWeek(page.request);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'עוד' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'פרופיל', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const avatarControls = page.locator('[class*="avatarControls"]');
  await expect(avatarControls).toHaveCSS('flex-basis', 'auto');
  const controlsBounds = await avatarControls.boundingBox();
  expect(controlsBounds).not.toBeNull();
  expect(controlsBounds!.height).toBeLessThan(200);
  const grid = page.getByRole('grid', { name: 'מפת ביצוע: 12 שבועות, 7 ימים בשבוע' });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('button')).toHaveCount(84);
  const first = grid.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(grid.getByRole('button').nth(1)).toBeFocused();
  await expect(page.getByText('יום ראשון · שבוע 2', { exact: true })).toBeVisible();
});

test('BROOST popover and compact navigation fit narrow and wide viewports', async ({ page, browser, baseURL }, testInfo) => {
  const candidate = await browser.newContext({ baseURL });
  try {
    await register(candidate.request, 'Viewport candidate with a long identifier');
  } finally {
    await candidate.close();
  }
  await register(page.request, 'Long display name for responsive header');
  await page.goto('/');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.getByRole('navigation', { name: width <= 720 ? 'ניווט ראשי בנייד' : 'ניווט ראשי', exact: true });
    await expect(nav.getByRole('button')).toHaveCount(5);
    await page.getByRole('button', { name: /BROOST —/ }).click();
    const popup = page.getByRole('dialog', { name: 'התראות BROOST' });
    await expect(popup).toBeVisible();
    await expect.poll(async () => {
      const bounds = await popup.boundingBox();
      return bounds !== null && bounds.x >= 0 && bounds.y >= 0 &&
        bounds.x + bounds.width <= width && bounds.y + bounds.height <= 844;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`popover-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible();
    await nav.getByRole('button', { name: 'עוד' }).click();
    await expect(page.getByRole('dialog').getByRole('region', { name: 'תכנון' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('region', { name: 'חשבון ומערכת' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('every confirmed 85% crossing has fireworks even after the surprise quota, but reload never replays', async ({ page }, testInfo) => {
  const accountId = await register(page.request, 'Milestone');
  await seedSuccessfulWeek(page.request, 5);
  await page.addInitScript((id) => {
    sessionStorage.setItem(`12-week:celebrations:v1:${id}`, JSON.stringify({ seen: [], count: 4, lastAt: Date.now() }));
  }, accountId);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'השבוע' }).click();
  const grid = page.getByRole('region', { name: 'רשת ביצועים שבועית — ניתן לגלול לרוחב' });
  const action = grid.getByRole('button', { name: 'פעולת מקור Astra — ו׳, לביצוע', exact: true });
  await action.click();
  await expect(page.getByRole('progressbar', { name: 'התקדמות שבועית: 86%' })).toBeVisible();
  await expect(page.getByTestId('milestone-fireworks')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('85-percent-fireworks.png') });
  await page.reload();
  await expect(page.getByTestId('milestone-fireworks')).not.toBeVisible();
  await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'השבוע' }).click();
  const toggle = grid.getByRole('button', { name: /^פעולת מקור Astra — ו׳,/ });
  await toggle.click();
  await expect(page.getByRole('progressbar', { name: 'התקדמות שבועית: 71%' })).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId('milestone-fireworks')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('milestone-fireworks')).not.toBeVisible();
  await expect(page.getByText('85% — עמדתם ביעד! 🎆')).toBeVisible();
});

test('one whole-week album persists multiple files without per-tactic attachments or duplicate execution views', async ({ page }) => {
  await register(page.request, 'Weekly evidence');
  await seedSuccessfulWeek(page.request, 1);
  await page.goto('/');
  const openWeek = () => page.getByRole('navigation', { name: 'ניווט ראשי', exact: true })
    .getByRole('button', { name: 'השבוע' }).click();
  await openWeek();
  const grid = page.getByRole('region', { name: 'רשת ביצועים שבועית — ניתן לגלול לרוחב' });
  await expect(grid.getByRole('button', { name: /עדות|צרופות/ })).toHaveCount(0);
  await expect(page.getByText('ביצוע השבוע — שבוע 1')).toHaveCount(0);
  const album = page.getByRole('region', { name: 'אלבום שבוע 1', exact: true });
  await expect(album).toHaveCount(1);
  await album.getByText('הוספת הערה או קישור לשבוע').click();
  await album.getByLabel('הערה לשבוע').fill('One note for the whole week');
  await album.getByRole('button', { name: 'הוספה לאלבום', exact: true }).click();
  await expect(album.getByText('One note for the whole week', { exact: true })).toBeVisible();
  await album.getByLabel('הוספת תמונות או קבצים לשבוע 1').setInputFiles([
    { name: 'weekly-one.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic first file\n') },
    { name: 'weekly-two.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic second file\n') },
  ]);
  await expect(album.getByText(/weekly-one\.txt/)).toBeVisible();
  await expect(album.getByText(/weekly-two\.txt/)).toBeVisible();
  await page.reload();
  await openWeek();
  await expect(album.getByText('One note for the whole week', { exact: true })).toBeVisible();
  await expect(album.getByRole('button', { name: 'הורדה', exact: true })).toHaveCount(2);
  await page.getByLabel('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)').selectOption('2');
  await expect(page.getByRole('region', { name: 'אלבום שבוע 2', exact: true })).toBeVisible();
  await expect(page.getByText(/weekly-one\.txt/)).toHaveCount(0);
  await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).getByRole('button', { name: 'בית', exact: true }).click();
  await expect(page.getByText('ביצוע השבוע — שבוע 1')).toBeVisible();
  await expect(album.getByText(/weekly-one\.txt/)).toBeVisible();
});
