import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { MonitoringPanel, monitoringAge } from '../components/MonitoringPanel';
import { fetchMonitoringSnapshot, isMonitoringSnapshot, MonitoringRequestError } from '../lib/monitoringApi';
import type { MonitoringSnapshot } from '../lib/monitoringTypes';
import type { MonitoringSnapshot as ServerSnapshot } from '../../../server/src/lib/monitoringTypes';

const snapshot = (): MonitoringSnapshot => ({
  version: 1, status: 'good', checkedAt: '2026-09-05T08:00:00.000Z',
  process: { status: 'good', uptimeSeconds: 7200, startedAt: '2026-09-05T06:00:00.000Z' },
  database: { status: 'good', bytes: 2_097_152, walBytes: 1024 },
  wamBackup: { status: 'good', count: 3, latestAt: '2026-09-04T08:00:00.000Z' },
  email: { status: 'good', scope: 'current_delivery_records', channels: (['weekly', 'reminders', 'broost', 'calendar'] as const).map((id) => ({
    id, status: 'good', counts: { sent: 2, failed: 0, pending: 0, sending: 0, cancelled: 0 },
  })) },
  probe: { status: 'good', reason: 'fresh', sampledAt: '2026-09-05T07:59:00.000Z', ageSeconds: 60, staleAfterSeconds: 900 },
  fileBackup: { status: 'good', state: 'observed', latestAt: '2026-09-05T07:00:00.000Z', ageSeconds: 3600, staleAfterSeconds: 129600 },
  cloudBackup: { status: 'unknown', state: 'not_configured', latestAt: null, ageSeconds: null, archiveBytes: null, staleAfterSeconds: 129600 },
  certificate: { status: 'good', state: 'observed', validFrom: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', daysRemaining: 118 },
  timers: (['weekly', 'reminders', 'broost', 'backup'] as const).map((id) => ({
    id, state: 'active', status: 'good', nextRunAt: '2026-09-06T00:00:00.000Z',
  })),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MonitoringPanel read-only presentation', () => {
  it('distinguishes empty delivery history from unreadable counts without turning it green', async () => {
    const data = snapshot();
    data.email.status = 'unknown';
    for (const channel of data.email.channels.slice(1)) {
      channel.status = 'unknown';
      channel.counts = { sent: 0, failed: 0, pending: 0, sending: 0, cancelled: 0 };
    }
    render(<MonitoringPanel loadSnapshot={vi.fn().mockResolvedValue(data)} />);
    const card = await screen.findByRole('region', { name: 'מסירת דואר — סיכום מצרפי' });
    expect(within(card).getByText('מידע חלקי')).toHaveClass('monitoring-badge--unknown');
    expect(within(card).getAllByText('טרם נשלחו הודעות')).toHaveLength(3);
    expect(within(card).getByText('תקין')).toBeInTheDocument();
    expect(card).toHaveTextContent('אינו כשל בשליחה וגם לא אישור שהשליחה פעילה');
  });
  it('keeps the additive client and server contract aligned', () => {
    expectTypeOf<MonitoringSnapshot>().toMatchTypeOf<ServerSnapshot>();
    expectTypeOf<ServerSnapshot>().toMatchTypeOf<MonitoringSnapshot>();
  });
  it('shows loading, Hebrew RTL cards, freshness and a single manual refresh control', async () => {
    let resolve!: (value: MonitoringSnapshot) => void;
    const loader = vi.fn(() => new Promise<MonitoringSnapshot>((done) => { resolve = done; }));
    render(<MonitoringPanel loadSnapshot={loader} />);
    expect(screen.getByRole('region', { name: 'ניטור מערכת' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('status')).toHaveTextContent('טוען תמונת מצב');
    expect(screen.getByRole('button', { name: /מרענן/ })).toBeDisabled();
    await act(async () => resolve(snapshot()));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /רענון מצב/ })).toBeEnabled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText(/גיל המדידה בעת הרענון: דקה/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'מסד נתונים מקומי' })).toHaveTextContent('2.0 MiB');
    expect(screen.getByRole('region', { name: 'גיבויי WAM בלתי־משתנים' })).toHaveTextContent('3');
    expect(screen.getByRole('table')).toHaveTextContent('הזמנות ליומן');
    expect(screen.getByText(/אין הפעלה או עצירה של שירותים/)).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('refreshes only manually; no interval or timed provider execution', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue(snapshot());
    render(<MonitoringPanel loadSnapshot={loader} />);
    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTime(3_600_000));
    expect(loader).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /רענון מצב/ }));
    await act(async () => undefined);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('distinguishes stale/warning/error and unconfigured observations without green fallbacks', async () => {
    const data = snapshot();
    data.status = 'error';
    data.probe = { ...data.probe, status: 'warn', reason: 'stale', ageSeconds: 1800 };
    data.certificate = { ...data.certificate, status: 'error', daysRemaining: -1 };
    data.fileBackup = { ...data.fileBackup, state: 'not_configured', status: 'unknown', latestAt: null, ageSeconds: null };
    data.timers[0] = { ...data.timers[0], status: 'unknown', state: 'not_configured', nextRunAt: null };
    render(<MonitoringPanel loadSnapshot={vi.fn().mockResolvedValue(data)} />);
    await screen.findByText(/המדידה המקומית ישנה/);
    expect(within(screen.getByRole('region', { name: 'עדכניות הבדיקה המקומית' })).getByText('לתשומת לב')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'תוקף תעודה מקומית' })).getByText('שגיאה')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'תוקף תעודה מקומית' })).toHaveTextContent('-1 ימים');
    expect(screen.getByRole('region', { name: 'גיבוי קבצים' })).toHaveTextContent('לא הוגדר');
    expect(screen.getByRole('region', { name: 'משימות מתוזמנות' })).toHaveTextContent('לא הוגדר');
  });
  it('shows explicit empty backup history and unavailable DB counts', async () => {
    const data = snapshot();
    data.wamBackup = { count: 0, latestAt: null, status: 'unknown' };
    data.database = { status: 'error', bytes: null, walBytes: null };
    data.email.channels[0].counts = null;
    data.email.channels[0].status = 'error';
    render(<MonitoringPanel loadSnapshot={vi.fn().mockResolvedValue(data)} />);
    await screen.findByText(/עדיין אין היסטוריית גיבויים/);
    expect(screen.getByRole('region', { name: 'מסד נתונים מקומי' })).toHaveTextContent('קריאת מסד הנתונים נכשלה');
    expect(screen.getByRole('table')).toHaveTextContent('—');
  });
  it('clears previous data on expired authentication and never renders raw errors', async () => {
    const loader = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new MonitoringRequestError('authentication'));
    render(<MonitoringPanel loadSnapshot={loader} />);
    await screen.findByText('2.0 MiB');
    fireEvent.click(screen.getByRole('button', { name: /רענון מצב/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('נדרשת התחברות מחדש');
    expect(screen.queryByText('2.0 MiB')).not.toBeInTheDocument();
    loader.mockRejectedValueOnce(new Error('Password=secret user@example.invalid /private/db.sqlite'));
    fireEvent.click(screen.getByRole('button', { name: /רענון מצב/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('לא ניתן לקרוא'));
    expect(document.body.textContent).not.toMatch(/secret|@|private|sqlite/);
  });
  it('aborts an in-flight request when unmounted', async () => {
    let signal!: AbortSignal;
    const view = render(<MonitoringPanel loadSnapshot={(next) => { signal = next; return new Promise(() => undefined); }} />);
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it('keeps stale cloud attestation distinct from fresh local backup success', async () => {
    const data = snapshot();
    data.cloudBackup = { status: 'warn', state: 'observed', latestAt: '2026-09-01T07:00:00.000Z', ageSeconds: 349200, archiveBytes: 2_097_152, staleAfterSeconds: 129600 };
    render(<MonitoringPanel loadSnapshot={vi.fn().mockResolvedValue(data)} />);
    const cloud = await screen.findByRole('region', { name: 'גיבוי ענן פרטי — מחוץ לשרת' });
    expect(cloud).toHaveTextContent('לתשומת לב');
    expect(cloud).toHaveTextContent('2.0 MiB');
    expect(cloud).toHaveTextContent('הרענון כאן אינו פונה לענן');
    expect(within(screen.getByRole('region', { name: 'גיבוי קבצים' })).getByText('תקין')).toBeInTheDocument();
  });
  it('formats freshness without implying unknown is zero', () => {
    expect(monitoringAge(null)).toBe('לא ידוע');
    expect(monitoringAge(0)).toBe('פחות מדקה');
    expect(monitoringAge(60)).toBe('דקה');
    expect(monitoringAge(3600)).toBe('שעה');
    expect(monitoringAge(86400)).toBe('יום');
  });
});

describe('monitoring API client', () => {
  it('performs only credentialed, no-store GET and accepts error-status snapshots', async () => {
    const data = snapshot();
    data.status = 'error';
    data.database.status = 'error';
    const fetchMock = vi.fn().mockResolvedValue({ status: 503, ok: false, text: async () => JSON.stringify(data) });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    expect(await fetchMonitoringSnapshot(controller.signal)).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith('/api/monitoring', { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
  });
  it.each([401, 403])('maps authentication status %d without reading sensitive response text', async (status) => {
    const text = vi.fn().mockResolvedValue('private server error');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: false, text }));
    await expect(fetchMonitoringSnapshot(new AbortController().signal)).rejects.toMatchObject({ kind: 'authentication' });
    expect(text).not.toHaveBeenCalled();
  });
  it.each([
    [200, '{malformed'],
    [200, JSON.stringify({ version: 1 })],
    [503, JSON.stringify({ error: 'private details' })],
    [500, JSON.stringify({ error: 'private details' })],
    [200, 'x'.repeat(32769)],
  ])('rejects malformed/unavailable API responses with generic messages', async (status, content) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status === 200, text: async () => content }));
    await expect(fetchMonitoringSnapshot(new AbortController().signal)).rejects.toMatchObject({ kind: 'unavailable', message: 'unavailable' });
  });
  it('rejects arbitrary labels, invalid counts and invalid date shapes', () => {
    const data = snapshot();
    expect(isMonitoringSnapshot(data)).toBe(true);
    expect(isMonitoringSnapshot({ ...data, checkedAt: 'private error' })).toBe(false);
    expect(isMonitoringSnapshot({ ...data, database: { ...data.database, bytes: -1 } })).toBe(false);
    expect(isMonitoringSnapshot({ ...data, timers: data.timers.map((timer) => ({ ...timer, id: 'unknown.service' })) })).toBe(false);
    expect(isMonitoringSnapshot({ ...data, email: { ...data.email, channels: [data.email.channels[0]] } })).toBe(false);
  });
});
