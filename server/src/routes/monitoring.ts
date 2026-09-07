import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { defaultStatFile, getMonitoringSnapshot, type MonitoringDependencies } from '../lib/monitoring.js';
import { positiveSeconds, readOperationalProbe } from '../lib/monitoringProbe.js';
import { isUserAdmitted } from '../lib/accessPolicy.js';

export function createMonitoringRouter(overrides: Partial<MonitoringDependencies> = {}): Router {
  const probeStaleAfterSeconds = positiveSeconds(process.env.MONITORING_PROBE_MAX_AGE_SECONDS, 900, 86_400);
  const deps: MonitoringDependencies = {
    db: getDb, now: () => new Date(), uptime: () => process.uptime(), statFile: defaultStatFile,
    probeStaleAfterSeconds,
    backupStaleAfterSeconds: positiveSeconds(process.env.MONITORING_BACKUP_MAX_AGE_SECONDS, 129_600, 2_592_000),
    readProbe: (now) => readOperationalProbe({
      directory: process.env.MONITORING_STATE_DIR?.trim(), now, staleAfterSeconds: overrides.probeStaleAfterSeconds ?? probeStaleAfterSeconds,
    }),
    ...overrides,
  };
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    const token: unknown = req.cookies?.[config.sessionCookieName];
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    try {
      // Existing requireAuth deletes expired sessions. This endpoint must remain SELECT-only.
      const session = deps.db().prepare(`SELECT sessions.expires_at AS expiresAt, users.id AS userId
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?`).get(token) as { expiresAt: string; userId: number } | undefined;
      if (!session || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= deps.now().getTime() || !isUserAdmitted(session.userId)) {
        res.status(401).json({ error: 'authentication_required' });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: 'monitoring_unavailable' });
    }
  });
  router.get('/', async (_req, res) => {
    try {
      const snapshot = await getMonitoringSnapshot(deps);
      res.status(snapshot.database.status === 'error' ? 503 : 200).json(snapshot);
    } catch {
      res.status(503).json({ error: 'monitoring_unavailable' });
    }
  });
  router.all('/', (_req, res) => {
    res.set('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'read_only' });
  });
  return router;
}

export const monitoringRouter = createMonitoringRouter();
