import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

function readLocalEnvValue(key: string) {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const APP_PORT = Number(process.env.VITE_PORT || 5173);
const APP_PROTOCOL = (process.env.VITE_HTTPS ?? readLocalEnvValue("VITE_HTTPS")) === "true" ? "https" : "http";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./playwright/global-setup.ts",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: `${APP_PROTOCOL}://localhost:${APP_PORT}`,
    ignoreHTTPSErrors: APP_PROTOCOL === "https",
    storageState: "playwright/.auth/session.json",
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
