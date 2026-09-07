/**
 * Tiny module-level pub/sub (same pattern as saveStatusBus.ts) so that a BROOST mutation
 * performed in one mounted component (e.g. marking a BROOST read from the TopBar bell's
 * popover) can prompt every *other* mounted BROOST surface (e.g. the BROOST page's history
 * list) to refresh, without threading state through unrelated components — `TopBar` and
 * `DashboardPage` are rendered as siblings (see App.tsx), so there is no parent/child prop
 * path between the bell and the page at all.
 *
 * Each publisher includes its own `sourceId` so a hook instance that already refreshed
 * itself directly (immediately after its own mutation) can ignore its own broadcast and
 * avoid a redundant duplicate reload — only *other* instances react to a given publish.
 */
type BroostChangeListener = (sourceId: string) => void;

const listeners = new Set<BroostChangeListener>();

export function publishBroostChange(sourceId: string): void {
  listeners.forEach((listener) => listener(sourceId));
}

export function subscribeBroostChange(listener: BroostChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Generates a short, cheap-to-compare per-hook-instance id — never persisted, purely an
 *  in-memory tag used to distinguish "my own publish" from "someone else's". */
export function createBroostInstanceId(): string {
  return `broost-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
