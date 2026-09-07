import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../pages/DashboardPage';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { AuthUser } from '../context/AuthContext';
import type { DashboardBundle, PartnershipsState, RegisteredUser, WamDetail } from '../lib/types';
import type { ProfileData } from '../hooks/useProfile';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      putBinary: vi.fn(),
      postBinary: vi.fn(),
    },
  };
});

describe('DashboardPage whole-week album and execution views', () => {
  it('renders one execution grid in Week, scopes its sole album to navigation, and keeps Home quick execution', async () => {
    const bundle: DashboardBundle = {
      ...EMPTY_BUNDLE,
      cycle: {
        id: 10, name: 'Synthetic cycle', currentWeek: 3, isActive: true,
        vision: '', successDefinition: '', whyItMatters: '', blockers: '', risks: '', lagMeasures: '', leadMeasures: '', notes: '',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
      goals: [{ id: 1, title: 'Goal', color: 'emerald', tactics: [{
        id: 50, title: 'Synthetic tactic', weekdays: [0, 1, 2, 3, 4, 5, 6], startWeek: 1, endWeek: 12, completions: [],
      }] }],
      weekScores: [1, 2, 3].map((week) => ({ week, score: 0, completed: 0, scheduled: 7 })),
    };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return AUTH_USER;
      if (path === '/partnerships') return { partner: null };
      if (path === '/partnerships/candidates') return { users: [] };
      if (path === '/dashboard/1') return bundle;
      if (path.startsWith('/weekly-planning/')) return { access: 'owner', ritual: null };
      if (path.startsWith('/execution-recovery/')) return { access: 'owner', risk: null, plan: null };
      if (path.startsWith('/week-evidence/')) return { access: 'owner', items: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue({});
    renderDashboard();
    expect(await screen.findByText('ביצוע השבוע — שבוע 3')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'אלבום שבוע 3' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'השבוע' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('ביצוע השבוע — שבוע 3')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const weekPicker = screen.getByLabelText('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)');
    fireEvent.change(weekPicker, { target: { value: '2' } });
    expect(await screen.findByLabelText('הוספת תמונות או קבצים לשבוע 2')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^אלבום שבוע/ })).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith('/week-evidence/10/2');
    expect(screen.queryByRole('button', { name: /עדות שבועית עבור/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Synthetic tactic — א׳, לביצוע' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/completions/toggle', { tacticId: 50, week: 2, weekday: 0, done: true }));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'בית' }));
    expect(await screen.findByText('ביצוע השבוע — שבוע 3')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'אלבום שבוע 3' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const AUTH_USER: AuthUser = {
  id: 1,
  email: 'owner@a.com',
  displayName: '',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  successStreak: 4,
};

const EMPTY_BUNDLE: DashboardBundle = {
  access: 'owner',
  targetEmail: 'owner@a.com',
  cycle: null,
  goals: [],
  weekScores: [],
  averageScore: null,
};

const PROFILE: ProfileData = {
  id: 1,
  email: 'owner@a.com',
  displayName: '',
  bio: '',
  hasAvatar: false,
  avatarVersion: 0,
  successStreak: 4,
};

/** Mirrors App.tsx's real gating (only mounts DashboardPage once the authenticated user has
 *  loaded) — DashboardPage itself assumes a non-null user, exactly like in production. */
function Gate() {
  const { user, loading } = useAuth();
  if (loading || !user) return <div>loading-gate</div>;
  return <DashboardPage />;
}

function renderDashboard() {
  return render(
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function openMore() {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'עוד' }));
}

async function travelHistory(delta: number) {
  await act(async () => {
    const moved = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    window.history.go(delta);
    await moved;
  });
}

/**
 * Regression coverage for the "no-cycle nav" fix: with no active cycle, Home still shows its
 * own onboarding card, but switching to a tab that works without a cycle (Profile) must show
 * only that tab's own content — never the Home-only onboarding/loading card stacked above it.
 */
describe('DashboardPage: cycle status cards are scoped to Home (and cycle-dependent tabs)', () => {
  function setupApiMocks() {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return AUTH_USER;
      if (path === '/partnerships') return { partner: null } satisfies PartnershipsState;
      if (path === '/partnerships/candidates') return { users: [] as RegisteredUser[] };
      if (path === '/dashboard/1') return EMPTY_BUNDLE;
      if (path === '/profile') return PROFILE;
      if (path === '/cycles/1') return { access: 'owner', cycles: [] };
      if (path.startsWith('/archive-search?')) return { query: 'Astra', limit: 5, totalCount: 0, groups: [] };
      throw new Error(`unexpected GET ${path}`);
    });
  }

  it('shows the empty-cycle onboarding card on Home', async () => {
    setupApiMocks();
    renderDashboard();

    expect(await screen.findByText('עדיין אין מחזור פעיל')).toBeInTheDocument();
  });

  it('does NOT show the empty-cycle onboarding card (or loading text) once on the Profile tab', async () => {
    setupApiMocks();
    renderDashboard();

    await screen.findByText('עדיין אין מחזור פעיל'); // wait for the initial Home render/settle

    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'פרופיל' }));

    await screen.findByText('הפרופיל שלי');
    expect(screen.queryByText('עדיין אין מחזור פעיל')).not.toBeInTheDocument();
    expect(screen.queryByText('טוען לוח...')).not.toBeInTheDocument();
  });

  it('the Profile nav button is enabled even though it requires no cycle', async () => {
    setupApiMocks();
    renderDashboard();
    await screen.findByText('עדיין אין מחזור פעיל');

    openMore();
    expect(screen.getByRole('button', { name: 'פרופיל' })).not.toBeDisabled();
    // Cycle-requiring tabs stay disabled with no active cycle.
    expect(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'מטרות' })).toBeDisabled();
  });

  it('does NOT show the onboarding card on the cycle-history tab either (also cycle-independent)', async () => {
    setupApiMocks();
    renderDashboard();
    await screen.findByText('עדיין אין מחזור פעיל');

    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'מחזורים קודמים' }));
    await waitFor(() => expect(screen.queryByText('עדיין אין מחזור פעיל')).not.toBeInTheDocument());
  });

  it('makes global search available without an active cycle and does not show onboarding above it', async () => {
    setupApiMocks();
    renderDashboard();
    await screen.findByText('עדיין אין מחזור פעיל');
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש בארכיון' }));
    expect(screen.queryByText('עדיין אין מחזור פעיל')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('מה לחפש?'), { target: { value: 'Astra' } });
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/archive-search?q=Astra'));
    expect(await screen.findByText(/לא נמצאו תוצאות/)).toBeVisible();
  });
});

describe('DashboardPage: personal planning and WAM share one destination', () => {
  function bundleFor(userId: number, currentWeek: number | null): DashboardBundle {
    return {
      ...EMPTY_BUNDLE,
      access: userId === 1 ? 'owner' : 'partner',
      targetEmail: userId === 1 ? AUTH_USER.email : 'partner@example.test',
      cycle: currentWeek === null ? null : {
        id: userId * 10, name: `cycle-${userId}`, currentWeek, isActive: true,
        vision: '', successDefinition: '', whyItMatters: '', blockers: '', risks: '', lagMeasures: '', leadMeasures: '', notes: '',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
    };
  }

  function setup(currentWeek: number | null = 3, hasPartner = true, pendingPartnership?: Promise<PartnershipsState>) {
    const partnership = { id: 1, initiatorId: 1, inviteeId: 2, initiatorEmail: AUTH_USER.email, inviteeEmail: 'partner@example.test' };
    const participant = (userId: number) => ({
      userId, email: `synthetic-${userId}@example.test`, displayName: '', hasAvatar: false, avatarVersion: 0,
    });
    const duoStreak: WamDetail['duoStreak'] = {
      currentStreak: 0, bestStreak: 0, totalDuoWins: 0, latestDuoSuccess: null,
      participants: [participant(1), participant(2)],
    };
    const review = (userId: number) => ({
      userId, email: `synthetic-${userId}@example.test`, rating: null, scoreSnapshot: null,
      live: { hasCycle: false, cycleId: null, cycleName: null, cycleIsActive: false, currentWeek: null, score: null, scheduled: 0, completed: 0 },
    });
    const wam: WamDetail = {
      id: 77, week: 2, status: 'draft', isHistorical: false, wins: '', misses: '', blockers: '', lessonsLearned: '', notes: '', adjustmentNotes: '',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', completedAt: null, partnership, mismatch: false,
      nextWam: { at: null, durationMinutes: null, sequence: 0 },
      calendarInvitations: { a: { status: null, error: null, sentAt: null }, b: { status: null, error: null, sentAt: null } },
      reviews: { a: review(1), b: review(2) }, commitments: [], punishments: [], duePunishments: [], canAddPunishment: true, duoStreak,
    };
    const archived = { ...bundleFor(1, 12), cycle: { ...bundleFor(1, 12).cycle!, id: 11, name: 'Archived cycle 11', isActive: false } };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return AUTH_USER;
      if (path === '/partnerships') return pendingPartnership ?? { partner: hasPartner ? { id: 2, email: 'partner@example.test', displayName: '', partnershipId: 1 } : null };
      if (path === '/partnerships/candidates') return { users: [] };
      if (path === '/dashboard/1') return bundleFor(1, currentWeek);
      if (path === '/dashboard/2') return bundleFor(2, 8);
      if (path.startsWith('/weekly-planning/')) return { access: path.includes('/20/') ? 'partner' : 'owner', ritual: null };
      if (path.startsWith('/execution-recovery/')) return { access: 'owner', risk: null, plan: null };
      if (path.startsWith('/week-evidence/')) return { access: 'owner', items: [] };
      if (path === '/cycles/1') return { access: 'owner', cycles: [archived.cycle] };
      if (path === '/cycles/1/11') return archived;
      if (path === '/wams/77') return wam;
      if (path === '/reminders') return { reminders: [{
        id: 51, title: 'Archive reminder 51', body: 'Synthetic reminder',
        scheduledFor: '2099-06-15T07:00:00.000Z', scheduledForIsraelWallTime: '2099-06-15T10:00',
        status: 'sent', attemptCount: 1, lastError: null, sentAt: '2026-01-01T00:00:00.000Z',
        recipient: { id: 1, email: AUTH_USER.email, isSelf: true },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] };
      if (path === '/wams') return {
        partnership, duoStreak, wams: [{
          id: wam.id, week: wam.week, status: 'draft', isHistorical: false, updatedAt: wam.updatedAt, completedAt: null,
          ratingA: null, ratingB: null, scoreSnapshotA: null, scoreSnapshotB: null,
          commitmentsTotal: 0, commitmentsDone: 0, punishmentsDueTotal: 0, punishmentsDueDone: 0,
        }],
      };
      if (path.startsWith('/archive-search?')) return {
        query: 'meeting', totalCount: 1, limit: 5,
        groups: [{
          category: 'wams', count: 1, hasMore: false, items: [{
            id: 77, title: 'Exact meeting result', snippet: 'meeting', matchedField: 'notes',
            cycleName: 'earlier cycle', isArchived: true, ownership: 'shared',
            target: { kind: 'wam', userId: 1, cycleId: null, wamId: 77, week: 2 },
          }],
        }],
      };
      throw new Error(`unexpected GET ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue(wam);
    vi.mocked(api.patch).mockImplementation(async (_path, input) => ({ ...wam, ...input as object }));
    vi.mocked(api.put).mockImplementation(async (_path, input) => ({
      access: 'owner',
      ritual: {
        id: 500, cycleId: 10, targetWeek: 4, workedWell: '', improveNext: '', weeklyFocus: '', commitment: '',
        tacticsReviewed: false, status: 'draft', completedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-02', ...input as object,
      },
    }));
  }

  function openCombinedPage() {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'פגישה משותפת' }));
  }

  it.each([
    ['home', 'בית', false], ['week', 'השבוע', false], ['goals', 'מטרות', false],
    ['wams', 'פגישה משותפת', false], ['planning', 'תכנון המחזור', true],
    ['history', 'מגמות', true], ['cycleHistory', 'מחזורים קודמים', true],
    ['broosts', 'BROOST', true], ['profile', 'פרופיל', true],
    ['reminders', 'תזכורות', true], ['search', 'חיפוש בארכיון', true],
    ['monitoring', 'בריאות המערכת', true],
  ] as const)('writes the actual menu destination %s and stable board to the URL', async (page, label, inMore) => {
    setup();
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    if (inMore) openMore();
    const container = inMore ? screen.getByRole('dialog') : screen.getByRole('navigation', { name: 'ניווט ראשי' });
    await act(async () => fireEvent.click(within(container).getByRole('button', { name: label })));
    expect(new URLSearchParams(window.location.search).get('page')).toBe(page);
    expect(new URLSearchParams(window.location.search).get('board')).toBe('1');
  });

  // A menu entry that updates the URL but renders nothing is indistinguishable from a dead
  // link to the person clicking it, so every destination is asserted to actually paint.
  it.each([
    ['week', 'השבוע', 'מעקב שבועי', false], ['goals', 'מטרות', 'מטרות וטקטיקות', false],
    ['wams', 'פגישה משותפת', 'פגישה משותפת', false], ['planning', 'תכנון המחזור', 'תכנון המחזור', true],
    ['history', 'מגמות', 'מגמות', true], ['cycleHistory', 'מחזורים קודמים', 'מחזורים קודמים', true],
    ['broosts', 'BROOST', 'BROOST', true], ['profile', 'פרופיל', 'פרופיל', true],
    ['reminders', 'תזכורות', 'תזכורות', true], ['search', 'חיפוש בארכיון', 'חיפוש בארכיון', true],
    ['monitoring', 'בריאות המערכת', 'בריאות המערכת', true],
  ] as const)('paints the %s destination after choosing it in the menu', async (_page, label, region, inMore) => {
    setup();
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    if (inMore) openMore();
    const container = inMore ? screen.getByRole('dialog') : screen.getByRole('navigation', { name: 'ניווט ראשי' });
    await act(async () => fireEvent.click(within(container).getByRole('button', { name: label })));
    expect(await screen.findByRole('region', { name: region })).toBeInTheDocument();
  });

  it('offers one shared destination in each nav, none in More, and sends the Home planning CTA there', async () => {
    setup();
    renderDashboard();
    const homeCta = await within(await screen.findByRole('main')).findByRole('button', { name: 'פגישה משותפת' });
    for (const label of ['ניווט ראשי', 'ניווט ראשי בנייד']) {
      const nav = within(screen.getByRole('navigation', { name: label }));
      expect(nav.getAllByRole('button', { name: 'פגישה משותפת' })).toHaveLength(1);
      fireEvent.click(nav.getByRole('button', { name: 'עוד' }));
      const menu = within(screen.getByRole('dialog'));
      expect(menu.queryByRole('button', { name: /תכנון אישי/ })).not.toBeInTheDocument();
      expect(menu.queryByRole('button', { name: 'פגישה משותפת' })).not.toBeInTheDocument();
      expect(menu.getByRole('button', { name: 'תכנון המחזור' })).toBeInTheDocument();
      fireEvent.click(menu.getByRole('button', { name: 'סגירת תפריט ניווט' }));
    }
    fireEvent.click(homeCta);
    const page = screen.getByRole('region', { name: 'פגישה משותפת' });
    expect(within(page).getByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    expect(await within(page).findByRole('heading', { name: 'פגישה משותפת · WAM' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'פגישה משותפת' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'מעבר למטרות וטקטיקות לעדכון' }));
    expect(screen.getByRole('region', { name: 'מטרות וטקטיקות' })).toBeInTheDocument();
  });

  it('keeps current+1 planning independent of historical Week navigation and WAM selection/mutations', async () => {
    setup();
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'השבוע' }));
    fireEvent.change(screen.getByLabelText('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)'), { target: { value: '8' } });
    openCombinedPage();
    expect(await screen.findByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('מה עבד השבוע?'), { target: { value: 'personal only' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת טיוטה' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/weekly-planning/10/4', expect.objectContaining({ workedWell: 'personal only' })));
    fireEvent.change(await screen.findByLabelText('שבוע לפגישה'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת הפגישה' }));
    const wins = await screen.findByLabelText('ניצחונות / הישגים');
    expect(api.post).toHaveBeenCalledWith('/wams', { week: 2 });
    expect(new URLSearchParams(window.location.search).get('wam')).toBe('77');
    expect(new URLSearchParams(window.location.search).get('week')).toBe('2');
    expect(screen.getByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    fireEvent.change(wins, { target: { value: 'shared only' } });
    fireEvent.blur(wins);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/wams/77', { wins: 'shared only' }));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalledWith('/weekly-planning/10/9');
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    expect(await screen.findByText('כל הפגישות (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('מה עבד השבוע?')).toHaveValue('personal only');
    expect(new URLSearchParams(window.location.search).has('wam')).toBe(false);
    await travelHistory(-1);
    expect(await screen.findByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('wam')).toBe('77');
    await travelHistory(1);
    expect(await screen.findByText('כל הפגישות (1)')).toBeInTheDocument();
  });

  it('retains editable personal planning and honest WAM onboarding without a partner', async () => {
    setup(3, false);
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    openCombinedPage();
    expect(await screen.findByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירת טיוטה' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'פגישת האחריות השבועית שלכם' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/wams');
  });

  it.each([12, null])('keeps WAM accessible and explains personal planning at cycle week %s', async (week) => {
    setup(week);
    renderDashboard();
    await screen.findByText(week === null ? 'עדיין אין מחזור פעיל' : 'ביצוע השבוע — שבוע 12');
    openCombinedPage();
    expect(await screen.findByRole('heading', { name: 'פגישה משותפת · WAM' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תכנון אישי לשבוע הבא' })).toBeInTheDocument();
    expect(screen.getByText(week === null ? /לתכנון אישי נדרש מחזור פעיל/ : /המחזור הגיע לשבוע 12/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שמירת טיוטה' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/weekly-planning/10/13');
  });

  it('keeps partner planning read-only while shared meeting actions remain scoped to the authenticated participant', async () => {
    setup();
    renderDashboard();
    fireEvent.click(await screen.findByRole('tab', { name: /צפייה בלבד/ }));
    await screen.findByText('ביצוע השבוע — שבוע 8');
    openCombinedPage();
    expect(await screen.findByRole('heading', { name: 'תכנון אישי — לקראת שבוע 9' })).toBeInTheDocument();
    expect(screen.getByLabelText('מה עבד השבוע?')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'שמירת טיוטה' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/weekly-planning/20/9');
    fireEvent.click((await screen.findAllByRole('button', { name: 'פתיחה' }))[0]);
    expect(await screen.findByLabelText('ניצחונות / הישגים')).toBeEnabled();
    expect(api.get).toHaveBeenCalledWith('/wams/77');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('opens an exact archive WAM on the combined page and Back returns to its list without losing personal planning', async () => {
    setup();
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש בארכיון' }));
    fireEvent.change(screen.getByLabelText('מה לחפש?'), { target: { value: 'meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'חיפוש' }));
    fireEvent.click(await screen.findByRole('button', { name: /Exact meeting result/ }));
    expect(await screen.findByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/wams/77');
    expect(screen.getByRole('region', { name: 'פגישה משותפת' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת הפגישות' }));
    expect(await screen.findByText('כל הפגישות (1)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
  });

  it('refreshes on the URL-selected partner/week and supports browser Back/Forward without an own-board fallback', async () => {
    window.history.replaceState(null, '', '/?page=week&board=2&week=7');
    setup();
    const first = renderDashboard();
    expect(await screen.findByLabelText('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)')).toHaveValue('7');
    expect(screen.getByRole('tab', { name: /צפייה בלבד/ })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).toHaveBeenCalledWith('/dashboard/2');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/week-evidence/20/7'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getByRole('button', { name: 'בית' }));
    expect(new URLSearchParams(window.location.search).get('board')).toBe('2');
    expect(new URLSearchParams(window.location.search).get('page')).toBe('home');
    first.unmount();
    renderDashboard();
    expect(await screen.findByText('ביצוע השבוע — שבוע 8')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /צפייה בלבד/ })).toHaveAttribute('aria-selected', 'true');
    await travelHistory(-1);
    expect(await screen.findByLabelText('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)')).toHaveValue('7');
    await travelHistory(1);
    expect(await screen.findByText('ביצוע השבוע — שבוע 8')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'אלבום שבוע 8' })).toBeInTheDocument();
  });

  it('waits for partnership resolution before displaying a bookmarked partner board', async () => {
    window.history.replaceState(null, '', '/?page=week&board=2&week=7');
    let finish!: (value: PartnershipsState) => void;
    setup(3, true, new Promise((resolve) => { finish = resolve; }));
    renderDashboard();
    expect(await screen.findByText('טוען את הלוח המבוקש...')).toBeInTheDocument();
    expect(screen.queryByText('ביצוע השבוע — שבוע 3')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^אלבום שבוע/ })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/2');
    await act(async () => finish({ partner: { id: 2, email: 'partner@example.test', displayName: '', partnershipId: 1 } }));
    expect(await screen.findByLabelText('בחירת שבוע לצפייה (ניווט היסטורי, לא משנה נתונים)')).toHaveValue('7');
    expect(screen.getByRole('tab', { name: /צפייה בלבד/ })).toHaveAttribute('aria-selected', 'true');
  });

  it.each(['?page=unknown&board=2', '?page=week&board=oops', '?page=week&board=2&week=13'])(
    'silently repairs an unusable address to the own home board without loading it: %s',
    async (query) => {
      window.history.replaceState(null, '', `/${query}`);
      setup();
      renderDashboard();
      expect(await screen.findByText('ביצוע השבוע — שבוע 3')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // The board named in the broken address is never resolved or fetched — recovery lands
      // on the caller's own board, not on whichever one the malformed URL happened to name.
      expect(new URLSearchParams(window.location.search).get('page')).toBe('home');
      expect(new URLSearchParams(window.location.search).get('board')).toBe('1');
      expect(api.get).not.toHaveBeenCalledWith('/dashboard/2');
    },
  );

  it('recovers a broken address well enough that the menu still navigates', async () => {
    window.history.replaceState(null, '', '/?page=unknown&board=2');
    setup();
    renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    openMore();
    await act(async () =>
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'תזכורות' })));
    expect(new URLSearchParams(window.location.search).get('page')).toBe('reminders');
  });

  it('does not map an old bookmarked partner ID to a different current partner', async () => {
    window.history.replaceState(null, '', '/?page=week&board=2&week=7');
    setup(3, true, Promise.resolve({ partner: { id: 3, email: 'another@example.test', displayName: '', partnershipId: 2 } }));
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent('אינו זמין');
    expect(window.location.search).toContain('board=2');
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/2');
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/3');
    expect(screen.queryByText('ביצוע השבוע — שבוע 3')).not.toBeInTheDocument();
  });

  it('restores a bookmarked WAM after partnership loading, without showing unrelated onboarding or creating a meeting', async () => {
    window.history.replaceState(null, '', '/?page=wams&board=1&week=2&wam=77');
    let finish!: (value: PartnershipsState) => void;
    setup(3, true, new Promise((resolve) => { finish = resolve; }));
    renderDashboard();
    expect(await screen.findByText('טוען את השותפות לפגישה...')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'פגישת האחריות השבועית שלכם' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/wams/77');
    await act(async () => finish({ partner: { id: 2, email: 'partner@example.test', displayName: '', partnershipId: 1 } }));
    expect(await screen.findByLabelText('ניצחונות / הישגים')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/wams/77');
    expect(api.post).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('wam')).toBe('77');
  });

  it('shows an unavailable WAM detail when its partnership is absent and only clears the detail explicitly', async () => {
    window.history.replaceState(null, '', '/?page=wams&board=1&week=2&wam=77');
    setup(3, false);
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent('הפגישה שבכתובת אינה זמינה');
    expect(new URLSearchParams(window.location.search).get('wam')).toBe('77');
    expect(api.get).not.toHaveBeenCalledWith('/wams');
    expect(api.get).not.toHaveBeenCalledWith('/wams/77');
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לרשימת הפגישות' }));
    expect(await screen.findByRole('heading', { name: 'פגישת האחריות השבועית שלכם' })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has('wam')).toBe(false);
    expect(new URLSearchParams(window.location.search).get('page')).toBe('wams');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps an unavailable bookmarked board in the URL until the user explicitly chooses their own board', async () => {
    window.history.replaceState(null, '', '/?page=week&board=2&week=7');
    setup(3, false);
    renderDashboard();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('board')).toBe('2');
    expect(screen.queryByText('ביצוע השבוע — שבוע 3')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/2');
    fireEvent.click(screen.getByRole('button', { name: 'חזרה ללוח שלי' }));
    expect(await screen.findByText('ביצוע השבוע — שבוע 3')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('board')).toBe('1');
    expect(new URLSearchParams(window.location.search).get('page')).toBe('home');
  });

  it('persists manual cycle detail/week changes through refresh, Back/Forward and closing the detail', async () => {
    setup();
    const first = renderDashboard();
    await screen.findByText('ביצוע השבוע — שבוע 3');
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'מחזורים קודמים' }));
    fireEvent.click(await screen.findByRole('button', { name: 'צפייה' }));
    const picker = await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי');
    expect(new URLSearchParams(window.location.search).get('cycle')).toBe('11');
    fireEvent.change(picker, { target: { value: '9' } });
    expect(new URLSearchParams(window.location.search).get('week')).toBe('9');
    first.unmount();
    renderDashboard();
    expect(await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('9');
    expect(screen.getByRole('heading', { name: 'Archived cycle 11' })).toBeInTheDocument();
    await travelHistory(-1);
    expect(await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('1');
    await travelHistory(1);
    expect(await screen.findByLabelText('בחירת שבוע להצגה במחזור ההיסטורי')).toHaveValue('9');
    fireEvent.click(screen.getByRole('button', { name: '→ חזרה לרשימת המחזורים' }));
    expect(await screen.findByText('כל המחזורים (1)')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has('cycle')).toBe(false);
    expect(new URLSearchParams(window.location.search).get('page')).toBe('cycleHistory');
  });

  it('persists the WAM week selector without creating a meeting or changing personal next-week planning', async () => {
    window.history.replaceState(null, '', '/?page=wams&board=1&week=6');
    setup();
    const first = renderDashboard();
    expect(await screen.findByLabelText('שבוע לפגישה')).toHaveValue('6');
    fireEvent.change(screen.getByLabelText('שבוע לפגישה'), { target: { value: '5' } });
    expect(new URLSearchParams(window.location.search).get('week')).toBe('5');
    first.unmount();
    renderDashboard();
    expect(await screen.findByLabelText('שבוע לפגישה')).toHaveValue('5');
    expect(screen.getByRole('heading', { name: 'תכנון אישי — לקראת שבוע 4' })).toBeInTheDocument();
    await travelHistory(-1);
    expect(await screen.findByLabelText('שבוע לפגישה')).toHaveValue('6');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('restores a bookmarked reminder and makes its detail Back action update history without changing data', async () => {
    window.history.replaceState(null, '', '/?page=reminders&board=1&reminder=51');
    setup();
    const first = renderDashboard();
    expect(await screen.findByRole('article', { name: 'Archive reminder 51' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'חזרה לרשימת התזכורות' }));
    expect(new URLSearchParams(window.location.search).has('reminder')).toBe(false);
    expect(new URLSearchParams(window.location.search).get('page')).toBe('reminders');
    await travelHistory(-1);
    expect(screen.getByRole('article', { name: 'Archive reminder 51' })).toHaveFocus();
    first.unmount();
    renderDashboard();
    expect(await screen.findByRole('article', { name: 'Archive reminder 51' })).toHaveFocus();
    expect(new URLSearchParams(window.location.search).get('reminder')).toBe('51');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
