import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:5000";
  const nextcloudProxyTarget =
    env.VITE_NEXTCLOUD_PROXY_TARGET || env.NC_BASE_URL || "http://localhost:8090";
  const port = Number(env.VITE_PORT || 5173);
  const httpsEnabled = env.VITE_HTTPS === "true";
  const host = env.VITE_HOST || "0.0.0.0";

  return {
    plugins: [
      react(),
      httpsEnabled ? basicSsl() : null,
    ].filter(Boolean),
    root: "client",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client/src"),
        "@shared": path.resolve(__dirname, "shared"),
      },
    },
    server: {
      host,
      https: httpsEnabled,
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          secure: false,  // accept self-signed certs
        },
        "/remote.php": {
          target: nextcloudProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/ocs": {
          target: nextcloudProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: "../dist",
    },
  };
});
