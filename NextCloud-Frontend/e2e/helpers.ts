import { type Page, expect } from "@playwright/test";
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

const VITE_HTTPS = process.env.VITE_HTTPS ?? readLocalEnvValue("VITE_HTTPS");
const BASE_PROTOCOL = VITE_HTTPS === "true" ? "https" : "http";
export const BASE_URL = `${BASE_PROTOCOL}://localhost:${process.env.VITE_PORT || "5173"}`;
const E2E_EMAIL = process.env.E2E_EMAIL || "e2e-user";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "set-e2e-password";

function assertE2ECredentialsConfigured() {
  if (E2E_EMAIL === "e2e-user" || E2E_PASSWORD === "set-e2e-password") {
    throw new Error("Set E2E_EMAIL and E2E_PASSWORD before running Playwright tests.");
  }
}

export async function login(page: Page) {
  assertE2ECredentialsConfigured();
  await loginAs(page, E2E_EMAIL, E2E_PASSWORD);
}

export async function loginAs(page: Page, emailValue: string, passwordValue: string) {
  await page.goto("/#/");
  await page.waitForLoadState("networkidle");

  const onLogin = page.url().includes("/login");
  const sidebarVisible = !onLogin && (await page.locator("aside").isVisible().catch(() => false));
  if (sidebarVisible) return;

  await page.goto("/#/login");
  await page.waitForLoadState("networkidle");

  const email = page.locator("#email");
  const password = page.locator("#password");
  const hasLoginForm = await email.isVisible({ timeout: 3000 }).catch(() => false);

  if (hasLoginForm) {
    await email.fill(emailValue);
    await password.fill(passwordValue);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/#\/$/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("aside")).toBeVisible();
    return;
  }

  await page.request.post("/api/auth/login", {
    data: { email: emailValue, password: passwordValue },
  });
  await page.goto("/#/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("aside")).toBeVisible();
}

export async function expectToast(page: Page, textMatch?: string | RegExp) {
  const toast = page.locator("#cs-toast");
  await expect(toast).toBeVisible({ timeout: 5000 });
  if (textMatch) {
    if (typeof textMatch === "string") {
      await expect(toast).toContainText(textMatch);
    } else {
      await expect(toast).toHaveText(textMatch);
    }
  }
}

export async function navigateTo(page: Page, path: string) {
  await page.goto(`/#${path}`);
  await page.waitForLoadState("networkidle");
}

export async function waitForData(page: Page) {
  await page.waitForLoadState("networkidle");
}
