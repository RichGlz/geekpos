export type SyncState = "idle" | "syncing" | "offline" | "error";
export const SYNC_INTERVAL_MS = 5 * 60_000;
export interface ManagerState { syncState: SyncState; nextRetryAt: number; failures: number; error: string | null }
/** No router dependency: navigation cannot trigger network traffic. */
export function createSyncManager(deps: {
  online: () => boolean; active: () => boolean; run: () => Promise<void>;
  now?: () => number; changed: (state: ManagerState) => void;
}) {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: ManagerState = { syncState: "idle", nextRetryAt: 0, failures: 0, error: null };
  const publish = (next: Partial<ManagerState>) => { state = { ...state, ...next }; deps.changed(state); };
  function sync(manual = false): Promise<void> {
    if (inFlight) return inFlight;
    if (!deps.online()) { publish({ syncState: "offline" }); return Promise.resolve(); }
    if (!manual && (!deps.active() || now() < state.nextRetryAt)) return Promise.resolve();
    publish({ syncState: "syncing", error: null });
    inFlight = Promise.resolve().then(deps.run).then(() => {
      publish({ syncState: deps.online() ? "idle" : "offline", failures: 0, nextRetryAt: 0, error: null });
    }).catch((error: unknown) => {
      const failures = state.failures + 1;
      publish({
        syncState: deps.online() ? "error" : "offline", failures,
        nextRetryAt: now() + Math.min(SYNC_INTERVAL_MS, 30_000 * 2 ** Math.min(failures - 1, 4)),
        error: error instanceof Error ? error.message : "No se pudo sincronizar.",
      });
    }).finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    sync,
    start() { timer ??= setInterval(() => { void sync(); }, SYNC_INTERVAL_MS); },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    offline() { publish({ syncState: "offline" }); },
  };
}
