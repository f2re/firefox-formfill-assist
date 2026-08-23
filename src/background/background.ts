import type { RpcResponse, TabRequest } from "../shared/types";

async function activeTab(): Promise<browser.tabs.Tab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Не удалось определить активную вкладку.");
  return tab;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const response = (await browser.tabs.sendMessage(tabId, { action: "ping" })) as RpcResponse;
    if (response?.ok) return;
  } catch {
    // Inject below.
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (error) {
    throw new Error(
      `Нет доступа к странице. Откройте обычный http/https сайт и повторно нажмите кнопку расширения. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}

async function sendToActiveTab(request: TabRequest): Promise<RpcResponse> {
  const tab = await activeTab();
  await ensureContentScript(tab.id!);
  return (await browser.tabs.sendMessage(tab.id!, {
    action: request.action,
    payload: request.payload,
  })) as RpcResponse;
}

async function openSidebar(): Promise<void> {
  try {
    await browser.sidebarAction.open();
  } catch {
    // Firefox may reject programmatic opening outside a direct user gesture.
  }
}

browser.action.onClicked.addListener(async (tab) => {
  await openSidebar();
  if (tab.id) {
    try {
      await ensureContentScript(tab.id);
    } catch {
      // Sidebar will show the detailed access error on scan.
    }
  }
});

browser.runtime.onMessage.addListener(async (message: unknown): Promise<RpcResponse | undefined> => {
  if (!message || typeof message !== "object") return undefined;
  const request = message as Partial<TabRequest>;
  if (request.scope !== "tab" || !request.action) return undefined;

  try {
    return await sendToActiveTab(request as TabRequest);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Ошибка связи с вкладкой." };
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (!["analyze-form", "paste-json", "fill-preview"].includes(command)) return;
  await browser.storage.local.set({
    pendingCommand: { command, createdAt: Date.now() },
  });
  await openSidebar();
});
