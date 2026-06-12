import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, ".auth");
const STORAGE_STATE_PATH = path.join(AUTH_DIR, "session.json");
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
const API_BASE_URL = process.env.VITE_API_PROXY_TARGET || `http://localhost:${process.env.PORT || "5000"}`;
const E2E_EMAIL = process.env.E2E_EMAIL || "e2e-user";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "set-e2e-password";

function assertE2ECredentialsConfigured() {
  if (E2E_EMAIL === "e2e-user" || E2E_PASSWORD === "set-e2e-password") {
    throw new Error(
      "Playwright E2E credentials are not configured. Set E2E_EMAIL and E2E_PASSWORD before running tests.",
    );
  }
}

async function globalSetup() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  assertE2ECredentialsConfigured();

  // Log in via the API to establish a session cookie
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: (process.env.VITE_HTTPS ?? readLocalEnvValue("VITE_HTTPS")) === "true",
  });
  const page = await context.newPage();

  // POST login to get session cookie
  const response = await page.request.post(`${API_BASE_URL}/api/auth/login`, {
    data: {
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    },
  });

  if (!response.ok()) {
    throw new Error(`Global setup login failed: ${response.status()} ${response.statusText()}`);
  }

  // Save the authenticated storage state (cookies + localStorage)
  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}

export default globalSetup;
