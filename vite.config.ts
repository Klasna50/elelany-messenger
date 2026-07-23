import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ship new versions instantly, matching the website's update behaviour:
      // the service worker updates itself and takes over on the next open.
      registerType: "autoUpdate",
      // We register the SW ourselves in main.tsx so we can skip it under
      // file:// (the Electron desktop build, where service workers don't apply).
      injectRegister: null,
      includeAssets: ["apple-touch-icon.png", "favicon-32.png"],
      manifest: {
        name: "Elelany Messenger",
        short_name: "Elelany",
        description: "Private and group chats, calls, and more.",
        theme_color: "#fb923c",
        background_color: "#fff7ed",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          // Same art flagged maskable: the "E" is centred, so it survives the
          // circle/squircle crop Android applies.
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        // The precache is the app shell only. Never let the SW serve cached
        // Supabase responses — auth, realtime and messages must hit the
        // network every time, or the chat would show stale data offline.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/realtime\//, /^\/storage\//],
      },
      // The dev server doesn't need the SW; enable only when debugging it.
      devOptions: { enabled: false },
    }),
  ],
  // Relative asset paths so the same build works both on Netlify (served at "/")
  // and inside Electron (loaded over the file:// protocol).
  base: "./",
  server: {
    port: 5173,
    host: true,
  },
});
