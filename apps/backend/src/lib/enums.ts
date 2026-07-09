// String-literal mirrors of the enums declared in packages/shared/src/index.ts
// and prisma/schema.prisma. Kept as plain literals (rather than importing the
// TS enum from @mizaly/shared) so `tsc -b` doesn't need to pull a sibling
// workspace package's raw .ts source into this package's rootDir-constrained
// build. If packages/shared ever ships compiled type declarations, these can
// be replaced with a direct import - values must stay in sync either way.

export const SOCIAL_PLATFORM_VALUES = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "facebook",
  "threads",
  "pinterest",
  "reddit",
  "bluesky",
  "whatsapp",
  "telegram",
  "discord",
  "snapchat",
  "google_business",
] as const;

export const CONTENT_STATUS_VALUES = ["draft", "scheduled", "published"] as const;

export const MESSAGE_DIRECTION_VALUES = ["inbound", "outbound"] as const;
