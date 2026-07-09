import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/public": "http://localhost:3000",
      // Login/Setup/logout are server-rendered by the backend, not part of
      // the React Router SPA — proxy them too so the full-page redirects in
      // lib/api.ts (and direct navigation) land on the real pages in dev.
      "/login": "http://localhost:3000",
      "/setup": "http://localhost:3000",
      "/logout": "http://localhost:3000",
    },
  },
});
