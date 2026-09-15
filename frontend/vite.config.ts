import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The landing page reuses the README's walkthrough video and screenshots.
      "@docs": fileURLToPath(new URL("../docs", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        // SSE-friendly: no proxy timeouts and never buffer/compress the event stream.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.accept?.includes("text/event-stream")) {
              proxyReq.setHeader("Accept-Encoding", "identity");
              proxyReq.setHeader("Cache-Control", "no-cache");
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
});
