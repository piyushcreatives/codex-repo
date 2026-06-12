import { test, expect, type Page } from "@playwright/test";
import { login, navigateTo } from "./helpers";

type TalkConversation = {
  id: number;
  name: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getUsableConversation(page: Page): Promise<TalkConversation> {
  const conversationsResponse = await page.request.get("/api/conversations");
  const conversationsPayload = await conversationsResponse.json() as {
    data: TalkConversation[];
  };
  const usableConversation = conversationsPayload.data.find((item) => item.name === "Note to self")
    ?? conversationsPayload.data.find((item) => !/Talk updates/i.test(item.name))
    ?? conversationsPayload.data[0];

  expect(usableConversation).toBeTruthy();
  return usableConversation!;
}

async function openUsableConversation(page: Page) {
  const conversation = await getUsableConversation(page);
  const activeTitle = page.locator("main p.font-semibold").first();
  const activeConversationName = (await activeTitle.textContent().catch(() => ""))?.trim();
  if (activeConversationName?.toLowerCase() === conversation.name.toLowerCase()) {
    return conversation;
  }

  const sidebarTarget = sidebarConversation(page, conversation.name);
  if (await sidebarTarget.isVisible().catch(() => false)) {
    await sidebarTarget.click({ timeout: 10000 });
    return conversation;
  }

  const firstVisibleConversation = page.locator("aside button").filter({ hasText: /\S/ }).first();
  await firstVisibleConversation.click({ timeout: 10000 });
  return conversation;
}

async function openGroupConversation(page: Page, name = "Wholesome Group") {
  await page.getByRole("tab", { name: "Groups" }).click();
  const target = page.locator('[role="tabpanel"]').getByText(new RegExp(`^\\s*${escapeRegExp(name)}(\\s|$)`, "i")).first();
  await expect(target).toBeVisible({ timeout: 10000 });
  await target.click();
}

function sidebarConversation(page: Page, name: string) {
  return page.locator("aside button").filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i") }).first();
}

test.describe("Talk", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, "/talk");
    await page.waitForLoadState("networkidle");
  });

  test("Conversation list loads", async ({ page }) => {
    const conversationButton = page.locator("aside button").filter({ hasText: /\S/ }).first();
    await expect(conversationButton).toBeVisible({ timeout: 10000 });
  });

  test("Open a conversation and load messages", async ({ page }) => {
    await openUsableConversation(page);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible({ timeout: 10000 });
    await expect(page.locator("main, div").filter({ hasText: /No messages yet|Today|Yesterday|\w+/ }).first()).toBeVisible();
  });

  test("Send a message in a writable conversation", async ({ page }) => {
    const openedConversation = await openUsableConversation(page);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible({ timeout: 10000 });

    const message = `Playwright Talk ${Date.now()}`;
    await composer.fill(message);
    const sendRequest = page.waitForResponse(
      (response) =>
        response.url().includes("/api/conversations/") &&
        response.url().includes("/messages") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 20000 },
    );
    await page.getByRole("button").filter({ has: page.locator("svg.lucide-send-horizontal") }).click();
    await sendRequest;

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("textarea").first().waitFor({ state: "visible", timeout: 20000 });
    await openUsableConversation(page);
    await expect(page.getByText(message)).toBeVisible({ timeout: 20000 });
  });

  test("Search within a conversation filters visible messages", async ({ page }) => {
    await openUsableConversation(page);

    const uniqueMessage = `Searchable Talk ${Date.now()}`;
    const composer = page.locator("textarea").first();
    await composer.fill(uniqueMessage);
    await page.getByRole("button").filter({ has: page.locator("svg.lucide-send-horizontal") }).click();
    await expect(page.getByText(uniqueMessage)).toBeVisible({ timeout: 20000 });

    await page.getByLabel("Search messages").click();
    const searchInput = page.getByPlaceholder("Search in conversation...");
    await searchInput.fill(uniqueMessage);
    await expect(page.getByText(uniqueMessage)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/1 match|matches/i)).toBeVisible({ timeout: 10000 });
  });

  test("Attach a file and send it into the current conversation", async ({ page }) => {
    const conversation = await openUsableConversation(page);

    const fileName = `talk-upload-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Talk upload from Playwright"),
    });

    const uploadsFolder = `/Talk Uploads/${conversation.name === "Note to self" ? "Note to self" : "Direct Messages"}`;
    await expect.poll(async () => {
      const filesResponse = await page.request.get(`/api/files?path=${encodeURIComponent(uploadsFolder)}`);
      const filesPayload = await filesResponse.json() as {
        data: Array<{ name: string }>;
      };
      return filesPayload.data.some((file) => file.name === fileName);
    }, { timeout: 30000 }).toBeTruthy();

    await expect.poll(async () => {
      const messagesResponse = await page.request.get(`/api/conversations/${conversation!.id}/messages`);
      const messagesPayload = await messagesResponse.json() as {
        data: Array<{ content: string }>;
      };
      return messagesPayload.data.some((message) => message.content.includes(fileName));
    }, { timeout: 30000 }).toBeTruthy();
  });

  test("Group conversations tab opens a real group chat", async ({ page }) => {
    await openGroupConversation(page);
    await expect(page.locator("p.font-semibold").filter({ hasText: "Wholesome Group" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: 10000 });
  });
});
