import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { partnershipsRouter } from './routes/partnerships.js';
import { dashboardRouter } from './routes/dashboard.js';
import { cycleRouter } from './routes/cycle.js';
import { cyclesRouter } from './routes/cycles.js';
import { goalsRouter } from './routes/goals.js';
import { tacticsRouter } from './routes/tactics.js';
import { completionsRouter } from './routes/completions.js';
import { settingsRouter } from './routes/settings.js';
import { wamsRouter } from './routes/wams.js';
import { exportRouter } from './routes/export.js';
import { weeklyPlanningRouter } from './routes/weeklyPlanning.js';
import { executionRecoveryRouter } from './routes/executionRecovery.js';
import { broostsRouter } from './routes/broosts.js';
import { profileRouter } from './routes/profile.js';
import { remindersRouter } from './routes/reminders.js';
import { tacticEvidenceRouter } from './routes/tacticEvidence.js';
import { weekEvidenceRouter } from './routes/weekEvidence.js';
import { executionHeatmapRouter } from './routes/executionHeatmap.js';
import { archiveSearchRouter } from './routes/archiveSearch.js';
import { monitoringRouter } from './routes/monitoring.js';
import { getAccessPolicy } from './lib/accessPolicy.js';
import { createOriginGuard } from './middleware/origin.js';

export function createApp() {
  getAccessPolicy(); // Fail startup loudly rather than serving an unconfigured production app.
  const originGuard = createOriginGuard();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(...originGuard);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/partnerships', partnershipsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/cycle', cycleRouter);
  app.use('/api/cycles', cyclesRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/tactics', tacticsRouter);
  app.use('/api/completions', completionsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/wams', wamsRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/weekly-planning', weeklyPlanningRouter);
  app.use('/api/execution-recovery', executionRecoveryRouter);
  app.use('/api/broosts', broostsRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/tactic-evidence', tacticEvidenceRouter);
  app.use('/api/week-evidence', weekEvidenceRouter);
  app.use('/api/execution-heatmap', executionHeatmapRouter);
  app.use('/api/archive-search', archiveSearchRouter);
  app.use('/api/monitoring', monitoringRouter);

  // Serve the built frontend in production, if present.
  if (fs.existsSync(config.clientDistPath)) {
    app.use(express.static(config.clientDistPath));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(config.clientDistPath, 'index.html'));
    });
  }

  // Centralized error handler: never leak internals, always return JSON. Body-parser /
  // express.raw() payload-too-large errors surface here with status 413 — the avatar route
  // keeps its specific "2MB image" wording, while every other oversized request (e.g. a large
  // JSON body) gets a generic Hebrew "request too large" message instead of the image-specific
  // one.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 413) {
      const isAvatarUpload = req.originalUrl.startsWith('/api/profile/avatar');
      const isEvidenceUpload = (req.originalUrl.startsWith('/api/tactic-evidence/') && req.originalUrl.endsWith('/file')) ||
        (req.originalUrl.startsWith('/api/week-evidence/') && req.originalUrl.endsWith('/files'));
      res.status(413).json({
        error: isAvatarUpload
          ? 'התמונה גדולה מדי — הגודל המרבי הוא 2MB'
          : isEvidenceUpload
            ? 'הקובץ גדול מדי — הגודל המרבי הוא 8MB'
            : 'הבקשה גדולה מדי',
      });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת פנימית' });
  });

  return app;
}
