import { defineConfig } from 'vitest/config';

/**
 * HMR over a Cloudflare tunnel needs wss on 443, but hardcoding that breaks
 * every ordinary localhost session — the client would dial wss://localhost:443
 * and fail. Opt in with `npm run dev:tunnel`, which sets `--mode tunnel`.
 *
 * Mode rather than an env var: it needs no cross-platform shim, which matters
 * because this is developed on Windows and deployed from CI.
 */
export default defineConfig(({ mode }) => {
  const viaTunnel = mode === 'tunnel';

  return {
    base: '/',
    server: {
      // `host: true` binds 0.0.0.0 so a tunnel (or a phone on the LAN) can reach
      // it. Note this exposes an unauthenticated dev server serving source —
      // fine for a short test session, not something to leave running.
      host: true,
      port: 5173,
      allowedHosts: ['.trycloudflare.com'],
      ...(viaTunnel ? { hmr: { clientPort: 443, protocol: 'wss' as const } } : {}),
    },
    build: {
      // Safari 14+ / Chrome 87+. Covers the phones this is being tested on.
      target: 'es2020',
    },
    define: {
      // Stamped into the UI and diagnostics so a bug report ties to a build.
      __BUILD__: JSON.stringify(new Date().toISOString()),
    },
    test: {
      // Core is deliberately camera-free so these run in CI.
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
