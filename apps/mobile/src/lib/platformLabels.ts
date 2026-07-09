const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  threads: "Threads",
  pinterest: "Pinterest",
  reddit: "Reddit",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
