import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build works both on Netlify (served at "/")
  // and inside Electron (loaded over the file:// protocol).
  base: "./",
  server: {
    port: 5173,
    host: true,
  },
});
