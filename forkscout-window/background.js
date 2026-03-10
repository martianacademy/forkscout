// forkscout-window/background.js — Service worker: side panel + context menu + message routing

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Context menu: "Ask Forkscout about this page"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ask-forkscout",
    title: "Ask Forkscout about this",
    contexts: ["selection", "page", "link", "image"]
  });
  chrome.contextMenus.create({
    id: "forkscout-summarize",
    title: "Summarize this page",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  // Ensure side panel is open
  await chrome.sidePanel.open({ tabId: tab.id });

  const payload =
    info.menuItemId === "forkscout-summarize"
      ? {
          type: "INJECT_PROMPT",
          prompt: "Summarize the content of this page for me."
        }
      : {
          type: "INJECT_PROMPT",
          prompt: `Tell me about: "${info.selectionText ?? info.linkUrl ?? "this page"}"`
        };

  // Small delay so side panel has time to initialize
  setTimeout(() => {
    chrome.runtime.sendMessage(payload);
  }, 400);
});

// Relay messages between content script ↔ side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // PAGE_CONTEXT: content script sends page info → side panel receives it
  if (message.type === "PAGE_CONTEXT") {
    chrome.runtime.sendMessage(message).catch(() => {}); // fan out to side panel
    sendResponse({ ok: true });
    return true;
  }

  // EXECUTE_ON_PAGE: side panel asks service worker to run script in active tab
  if (message.type === "EXECUTE_ON_PAGE") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab" });
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: /** @type {() => unknown} */ (new Function(message.code)),
          world: "MAIN"
        });
        sendResponse({ ok: true, result: results?.[0]?.result });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
    return true; // keep channel open for async sendResponse
  }

  // GET_PAGE_CONTEXT: side panel requests current page info
  if (message.type === "GET_PAGE_CONTEXT") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) return sendResponse({ ok: false });
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            url: location.href,
            title: document.title,
            text: document.body?.innerText?.slice(0, 8000) ?? "",
            selectedText: window.getSelection()?.toString() ?? ""
          })
        });
        sendResponse({ ok: true, context: results?.[0]?.result });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
    return true;
  }
});

// Update side panel with new tab context when user switches tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => ({ url: location.href, title: document.title })
    })
    .then((results) => {
      chrome.runtime
        .sendMessage({
          type: "TAB_CHANGED",
          context: results?.[0]?.result
        })
        .catch(() => {});
    })
    .catch(() => {});
});

// ─── MCP Bridge ───────────────────────────────────────────────────────────────
// Optional WebSocket client that lets forkscout-agent interact with this
// extension via a registered set of tools. Reads settings from chrome.storage
// on startup and whenever settings change.

let _mcpWs = null;
let _mcpReconnectTimer = null;
let _mcpBackoff = 1000; // ms

const MCP_CAPABILITIES = [
  "get_page_context",
  "navigate_to",
  "inject_prompt",
  "get_selection",
  "run_script",
  "get_chat_history",
  "add_memory"
];

async function mcpLoadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["fw_settings"], (result) => {
      resolve(result.fw_settings ?? null);
    });
  });
}

async function mcpExecuteTool(toolName, args) {
  switch (toolName) {
    case "get_page_context": {
      return new Promise((resolve) => {
        chrome.tabs.query(
          { active: true, currentWindow: true },
          async ([tab]) => {
            if (!tab?.id) return resolve({ error: "No active tab" });
            try {
              const res = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => ({
                  url: location.href,
                  title: document.title,
                  text: document.body?.innerText?.slice(0, 8000) ?? "",
                  selectedText: window.getSelection()?.toString() ?? ""
                })
              });
              resolve(res?.[0]?.result ?? {});
            } catch (err) {
              resolve({ error: String(err) });
            }
          }
        );
      });
    }

    case "navigate_to": {
      const url = args?.url;
      if (!url || !url.startsWith("http")) return { error: "Invalid url" };
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (!tab?.id) return resolve({ error: "No active tab" });
          chrome.tabs.update(tab.id, { url }, () => resolve({ ok: true }));
        });
      });
    }

    case "inject_prompt": {
      const prompt = args?.prompt;
      if (!prompt) return { error: "prompt required" };
      chrome.runtime
        .sendMessage({ type: "INJECT_PROMPT", prompt })
        .catch(() => {});
      return { ok: true };
    }

    case "get_selection": {
      return new Promise((resolve) => {
        chrome.tabs.query(
          { active: true, currentWindow: true },
          async ([tab]) => {
            if (!tab?.id) return resolve({ text: "" });
            try {
              const res = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.getSelection()?.toString() ?? ""
              });
              resolve({ text: res?.[0]?.result ?? "" });
            } catch {
              resolve({ text: "" });
            }
          }
        );
      });
    }

    case "run_script": {
      const code = args?.code;
      if (!code) return { error: "code required" };
      return new Promise((resolve) => {
        chrome.tabs.query(
          { active: true, currentWindow: true },
          async ([tab]) => {
            if (!tab?.id) return resolve({ error: "No active tab" });
            try {
              const res = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: new Function(code), // eslint-disable-line no-new-func
                world: "MAIN"
              });
              resolve({ result: res?.[0]?.result });
            } catch (err) {
              resolve({ error: String(err) });
            }
          }
        );
      });
    }

    case "get_chat_history": {
      return new Promise((resolve) => {
        chrome.storage.local.get(
          ["fw_sessions", "fw_active_session"],
          (data) => {
            const sessions = data.fw_sessions ?? [];
            const activeId = data.fw_active_session;
            const active =
              sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;
            resolve({
              sessions: sessions.map((s) => ({
                id: s.id,
                title: s.title,
                messageCount: s.messages.length
              })),
              activeSession: active
            });
          }
        );
      });
    }

    case "add_memory": {
      const content = args?.content;
      if (!content) return { error: "content required" };
      return new Promise((resolve) => {
        chrome.storage.local.get(["fw_memories"], (data) => {
          const memories = data.fw_memories ?? [];
          const mem = {
            id: Date.now().toString(36),
            content,
            source: "agent",
            createdAt: Date.now()
          };
          memories.push(mem);
          chrome.storage.local.set({ fw_memories: memories }, () =>
            resolve({ ok: true, memory: mem })
          );
        });
      });
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function mcpConnect(agentUrl, agentToken) {
  if (_mcpWs) {
    try {
      _mcpWs.close();
    } catch {}
    _mcpWs = null;
  }

  // Convert http(s) → ws(s) URL, appending /ext-mcp path
  let wsUrl = agentUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ext-mcp";

  try {
    const ws = new WebSocket(wsUrl);
    _mcpWs = ws;

    ws.onopen = () => {
      _mcpBackoff = 1000;
      ws.send(
        JSON.stringify({
          type: "REGISTER",
          token: agentToken,
          capabilities: MCP_CAPABILITIES
        })
      );
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "TOOL_CALL") {
        const result = await mcpExecuteTool(msg.tool, msg.args ?? {});
        ws.send(JSON.stringify({ type: "TOOL_RESULT", id: msg.id, result }));
      }
    };

    ws.onclose = () => {
      _mcpWs = null;
      // Reconnect with exponential backoff (max 30s)
      _mcpReconnectTimer = setTimeout(async () => {
        const settings = await mcpLoadSettings();
        if (settings?.mcpBridgeEnabled) {
          mcpConnect(
            settings.agentUrl ?? "http://localhost:3200",
            settings.agentToken ?? ""
          );
        }
      }, _mcpBackoff);
      _mcpBackoff = Math.min(_mcpBackoff * 2, 30000);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  } catch (err) {
    // WebSocket unavailable (e.g. worker context restriction) — silently no-op
  }
}

async function mcpInit() {
  const settings = await mcpLoadSettings();
  if (settings?.mcpBridgeEnabled) {
    mcpConnect(
      settings.agentUrl ?? "http://localhost:3200",
      settings.agentToken ?? ""
    );
  }
}

// Start bridge on service worker boot
mcpInit();

// Re-evaluate whenever settings change
chrome.storage.local.onChanged.addListener((changes) => {
  if (!changes.fw_settings) return;
  const newSettings = changes.fw_settings.newValue;
  if (newSettings?.mcpBridgeEnabled) {
    mcpConnect(
      newSettings.agentUrl ?? "http://localhost:3200",
      newSettings.agentToken ?? ""
    );
  } else if (_mcpWs) {
    try {
      _mcpWs.close();
    } catch {}
    _mcpWs = null;
    if (_mcpReconnectTimer) {
      clearTimeout(_mcpReconnectTimer);
      _mcpReconnectTimer = null;
    }
  }
});
