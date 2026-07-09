// Zernio caps each API key at 2 connected accounts, so a studio with more
// than 2 clients needs multiple keys. Rather than hardcoding a fixed number
// of env vars, we scan process.env at request time so ops can add another
// key (ZERNIO_API_KEY_3, _4, ...) without a code change - just set the env
// var and reassign a user to it from the admin panel.
//
// Numbering convention:
//   ZERNIO_API_KEY     -> id "1" (legacy/original single-key var, kept for
//                          backwards compatibility with existing deployments)
//   ZERNIO_API_KEY_2   -> id "2"
//   ZERNIO_API_KEY_<n> -> id "<n>"
// If both ZERNIO_API_KEY and ZERNIO_API_KEY_1 are set, ZERNIO_API_KEY_1 wins.

export interface ZernioApiKeyOption {
  id: string;
  label: string;
}

const NUMBERED_KEY_PATTERN = /^ZERNIO_API_KEY_(\d+)$/;

function collectConfiguredKeys(): Map<string, string> {
  const keys = new Map<string, string>();

  if (process.env.ZERNIO_API_KEY) {
    keys.set("1", process.env.ZERNIO_API_KEY);
  }

  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(NUMBERED_KEY_PATTERN);
    if (match && value) {
      keys.set(match[1], value);
    }
  }

  return keys;
}

export function hasAnyConfiguredZernioApiKey(): boolean {
  return collectConfiguredKeys().size > 0;
}

// For the admin panel's "Zernio API Key" select - never returns key values,
// only their ids/labels.
export function listConfiguredZernioApiKeys(): ZernioApiKeyOption[] {
  return [...collectConfiguredKeys().keys()]
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => ({ id, label: `Zernio API Key ${id}` }));
}

// Resolves a user's assigned key id to its actual secret value. A null/undefined
// apiKeyId (unassigned user) falls back to key "1" so existing single-key
// deployments keep working without every user needing an explicit assignment.
// Returns undefined if the resolved id isn't actually configured in env.
export function resolveZernioApiKey(apiKeyId: string | null | undefined): string | undefined {
  return collectConfiguredKeys().get(apiKeyId || "1");
}
