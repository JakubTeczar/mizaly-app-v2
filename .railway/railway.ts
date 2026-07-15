import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  // Root Directory stays the repo root for all three services (yarn
  // workspaces need to see each other) - each service instead points at its
  // own Dockerfile (apps/<name>/Dockerfile), which is given full explicit
  // control over what gets copied/built rather than relying on Railway's
  // auto-detected Railpack builder (which had unpredictable, hard-to-debug
  // behavior with this monorepo's checkout/caching).
  //
  // NOTE: the `dockerfilePath` field on github() looked correct but never
  // actually took effect server-side (config apply reported success, the
  // live service kept using Railpack) - the Dockerfile path is instead set
  // per-service via the RAILWAY_DOCKERFILE_PATH env var below, which does
  // work. Don't add `dockerfilePath` back here without re-verifying against
  // `railway config pull` that it's actually applied - a `config apply` that
  // "succeeds" isn't proof by itself for this field.
  const source = () => github("JakubTeczar/mizaly-app-v2", { branch: "master", rootDirectory: "." });

  const backend = service("backend", {
    source: source(),
    healthcheck: "/health",
    env: {
      RAILWAY_DOCKERFILE_PATH: preserve(),
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
      RAILWAY_DOCKERFILE_PATH: preserve(),
      VITE_API_URL: "https://${{backend.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  const admin = service("admin", {
    source: source(),
    env: {
      RAILWAY_DOCKERFILE_PATH: preserve(),
      VITE_API_URL: "https://${{backend.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("mizaly-app-v2", {
    resources: [db, backend, mobile, admin],
  });
});
