import { createApp } from './app.js';
import { getDb } from './db.js';
import { runMigrations } from './migrate.js';
import { config } from './config.js';
import { ensureEvidenceDir } from './lib/tacticEvidence.js';

// Validate admission/origin configuration before migrations or evidence setup can write.
const app = createApp();
const db = getDb();
runMigrations(db);
// Fails loudly (throws, crashing startup) if EVIDENCE_DIR can't be created/secured — a
// confusing later file-write failure on the first upload would be a much worse failure mode
// than an explicit one here. See its own doc comment in lib/tacticEvidence.ts.
ensureEvidenceDir();

app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://${config.host}:${config.port} (env: ${config.nodeEnv})`);
});
