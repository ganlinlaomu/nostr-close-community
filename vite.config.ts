import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const DEFAULT_PORT = 5173;


const rawAllowed = (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1,pwa.lostr.space").trim();
const ALLOWED_HOSTS = rawAllowed === "" ? [] : rawAllowed.split(",").map(s => s.trim());

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "海内 - 封闭式朋友圈",
        short_name: "海内",
        description: "基于Nostr协议的加密朋友圈",
        theme_color: "#ffffff",
        icons: [
          {
            src: "icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml"
          },
          {
            src: "icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    host: "0.0.0.0",
    port: DEFAULT_PORT,
    cors: true,
    // Vite 支持 allowedHosts: 可以是 string[] 或 'all'
    // 当 ALLOWED_HOSTS 包含 "*" 时，设为 'all'（允许所有 host）
    allowedHosts: ALLOWED_HOSTS.includes("*") ? "all" : ALLOWED_HOSTS,
    // 额外中间件：双重保护（可选），保留以便更灵活的自定义响应
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          if (ALLOWED_HOSTS.length === 0 || ALLOWED_HOSTS.includes("*")) {
            return next();
          }
          const hostHeader = (req.headers.host || "").toString();
          const hostOnly = hostHeader.split(":")[0];
          if (ALLOWED_HOSTS.includes(hostOnly)) {
            return next();
          }
          res.statusCode = 403;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Host not allowed by dev server configuration.");
        } catch (err) {
          next();
        }
      });
    }
  }
});
