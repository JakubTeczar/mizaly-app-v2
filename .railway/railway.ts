import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  const source = () => github("JakubTeczar/mizaly-app-v2", { branch: "master", rootDirectory: "." });

  // Root Directory stays the repo root for all three services (yarn
  // workspaces need to see each other), so the actual build recipe per
  // service lives in its own apps/<name>/railpack.json instead - pointed at
  // via RAILPACK_CONFIG_FILE, since Railway would otherwise read the same
  // single railpack.json for every service sharing that root.
  const backend = service("backend", {
    source: source(),
    healthcheck: "/health",
    env: {
      RAILPACK_CONFIG_FILE: "apps/backend/railpack.json",
      DATABASE_URL: db.env.DATABASE_URL,
      PORT: "4000",
      BACKEND_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      MOBILE_APP_URL: "https://${{mobile.RAILWAY_PUBLIC_DOMAIN}}",
      JWT_SECRET: preserve(),
      JWT_REFRESH_SECRET: preserve(),
      ZERNIO_API_KEY_1: preserve(),
      ZERNIO_API_KEY_2: preserve(),
      ZERNIO_WEBHOOK_SECRET: preserve(),
      OPENAI_API_KEY: preserve(),
      APIFY_API_KEY: preserve(),
      SCRAPE_DO_KEY: preserve(),
      MAIL_IMAP_HOST: preserve(),
      MAIL_IMAP_PORT: preserve(),
      MAIL_SMTP_HOST: preserve(),
      MAIL_SMTP_PORT: preserve(),
      MAIL_USER: preserve(),
      MAIL_PASSWORD: preserve(),
      CLOUDINARY_CLOUD_NAME: preserve(),
      CLOUDINARY_API_KEY: preserve(),
      CLOUDINARY_API_SECRET: preserve(),
      R2_ACCOUNT_ID: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      R2_ENDPOINT: preserve(),
      R2_BUCKET_NAME: preserve(),
    },
  });

  const mobile = service("mobile", {
    source: source(),
    env: {
      RAILPACK_CONFIG_FILE: "apps/mobile/railpack.json",
    },
  });

  const admin = service("admin", {
    source: source(),
    env: {
      RAILPACK_CONFIG_FILE: "apps/admin/railpack.json",
    },
  });

  return project("mizaly-app-v2", {
    resources: [db, backend, mobile, admin],
  });
});
