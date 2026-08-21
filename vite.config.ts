import { defineConfig } from 'vite';

// The dev server has no reason to sit on a fixed port (no OAuth
// callback, no webhook, nothing depending on 5173 specifically) — so it
// honors $PORT when set, letting the harness assign a free one instead
// of colliding with another session's server. Falls back to Vite's
// normal default when PORT isn't set (a plain `npm run dev` outside the
// harness).
export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
