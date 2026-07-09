import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Admin panel dev server runs on a dedicated port so it doesn't collide with
// the mobile app (which uses Vite's default 5173) when both run locally at once.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
});
