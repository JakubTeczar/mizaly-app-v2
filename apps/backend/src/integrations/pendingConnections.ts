// Short-lived in-memory store mapping a Zernio connect `state` value back to
// the organization + platform that initiated it, so our public callback
// route (hit by the end user's browser, with no auth header) knows which
// tenant to attach the resulting SocialAccount to.
//
// In-memory is fine for a single backend instance (current deployment target
// is one Railway container); if the backend is ever scaled horizontally,
// this needs to move to a shared store (e.g. Redis) keyed the same way.

interface PendingConnection {
  organizationId: string;
  zernioProfileId: string;
  platform: string;
  // The actual Zernio API key secret used to initiate the connect flow - the
  // public callback route has no auth header to re-resolve a user's
  // assignment from, so it must reuse the exact same key that created the
  // profile/authUrl, or Zernio will reject the re-sync call.
  apiKey: string;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const pending = new Map<string, PendingConnection>();

export function storePendingConnection(
  state: string,
  data: { organizationId: string; zernioProfileId: string; platform: string; apiKey: string }
): void {
  pending.set(state, { ...data, createdAt: Date.now() });
}

// One-time use: removes the entry once read, whether or not it was valid.
export function consumePendingConnection(state: string): Omit<PendingConnection, "createdAt"> | null {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return {
    organizationId: entry.organizationId,
    zernioProfileId: entry.zernioProfileId,
    platform: entry.platform,
    apiKey: entry.apiKey,
  };
}
