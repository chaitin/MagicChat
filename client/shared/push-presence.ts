export const PUSH_PRESENCE_HEARTBEAT_MS = 15_000;

// Serialize updates so a slow foreground request cannot overwrite a later
// background/logout update. Failures are best-effort; server leases expire.
export function createPushPresenceReporter(
  send: (foreground: boolean) => Promise<unknown>,
) {
  let pending: boolean | null = null;
  let running = false;
  let stopped = false;
  let lastCompleted: boolean | null = null;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending !== null) {
        const foreground = pending;
        pending = null;
        if (!foreground && lastCompleted === false) continue;
        lastCompleted = null;
        try {
          await send(foreground);
          lastCompleted = foreground;
        } catch {
          // The next heartbeat retries without affecting chat or sign-out.
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    report(foreground: boolean) {
      if (stopped) return;
      pending = foreground;
      void drain();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      pending = false;
      void drain();
    },
  };
}
