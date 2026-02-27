import { tool } from "ai";
import { generateText } from "ai";

export const IS_BOOTSTRAP_TOOL = true;
import { z } from "zod";
import { mkdirSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { log } from "@/logs/logger.ts";
import { getConfig } from "@/config.ts";
import { getModelForRole } from "@/providers/index.ts";
import type { BrowserContext, Page } from "playwright";

// ─── Schema (defined outside tool() so we can reference the inferred type) ──

const browseSchema = z.object({
    action: z.enum([
        "navigate",        // go to url
        "click",           // click element by selector or visible text
        "type",            // append text into element
        "fill",            // clear + fill input
        "scroll",          // scroll page or into element view
        "screenshot",      // capture screenshot → image sent to LLM vision
        "get_text",        // get visible text of page or element
        "hover",           // hover over element
        "select_option",   // pick dropdown option
        "press",           // keyboard key press
        "wait_for",        // wait until selector is visible
        "evaluate",        // run arbitrary JavaScript on the page
        "go_back",         // browser history back
        "go_forward",      // browser history forward
        "get_url",         // return current URL
        "get_title",       // return page title
        "click_xy",        // click at exact x,y pixel coordinates (use centerX/centerY from find_elements)
        "drag",            // drag from source to target — use selector+targetSelector OR x+y+targetX+targetY
        "find_elements",   // find visible elements by CSS selector; returns tag, text, attrs, and viewport positions. selector defaults to all visible elements (*)
        "search_text",     // find elements anywhere on the full page whose text/aria-label/placeholder contains the given text (case-insensitive). Returns positions even if off-screen — use y vs scrollY to decide if you need to scroll first.
        "new_tab",         // open a new browser tab (optionally navigate to url)
        "close_tab",       // close a tab by tabIndex (default: current tab)
        "switch_tab",      // switch active tab by tabIndex
        "list_tabs",       // list all open tabs with index, url, title
        "list_profiles",   // list all available browser profiles
        "create_profile",  // create a new browser profile
        "switch_profile",  // switch to a different browser profile
        "close",           // close the entire browser session
    ]).describe("Browser action to perform"),

    profile: z.string().optional()
        .describe("Browser profile name to use (creates .agents/browser-profile-{name} if not exists)"),

    url: z.string().optional()
        .describe("URL to navigate to (required for: navigate)"),

    selector: z.string().optional()
        .describe("CSS selector for the target element"),

    text: z.string().optional()
        .describe("Visible text to locate element by, or text to type/append"),

    value: z.string().optional()
        .describe("Value for fill or select_option"),

    key: z.string().optional()
        .describe("Key to press, e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown'"),

    script: z.string().optional()
        .describe("JavaScript expression to evaluate on the page"),

    direction: z.enum(["up", "down", "left", "right"]).optional()
        .describe("Scroll direction (default: down)"),

    amount: z.number().optional()
        .describe("Pixels to scroll (default: 600)"),

    timeout: z.number().optional()
        .describe("Timeout ms for wait_for (default 15000, minimum 15000 — do NOT pass a lower value, dynamic pages need time)"),

    x: z.number().int().optional()
        .describe("X coordinate for click_xy (pixels from left edge of viewport)"),

    y: z.number().int().optional()
        .describe("Y coordinate for click_xy (pixels from top edge of viewport)"),

    tabIndex: z.number().int().optional()
        .describe("0-based tab index for switch_tab, close_tab (omit = current tab)"),

    targetSelector: z.string().optional()
        .describe("CSS selector of the drop target element (for drag action)"),

    targetX: z.number().int().optional()
        .describe("X coordinate of the drop target in viewport pixels (for drag action)"),

    targetY: z.number().int().optional()
        .describe("Y coordinate of the drop target in viewport pixels (for drag action)"),

    elementId: z.string().optional()
        .describe("Element ID returned by find_elements or search_text (e.g. 'e3'). Use instead of selector or x/y — agent should prefer this when available."),

    targetElementId: z.string().optional()
        .describe("Element ID of the drop target returned by find_elements or search_text (for drag action)."),
});

type BrowseInput = z.infer<typeof browseSchema>;
type TabInfo = { index: number; url: string; title: string; active: boolean };

type ElementInfo = { id: string; tag: string; text: string; attrs: Record<string, string>; score: number; inViewport: boolean; x: number; y: number; width: number; height: number; centerX: number; centerY: number };
type PageInfo = { viewportWidth: number; viewportHeight: number; pageWidth: number; pageHeight: number; scrollX: number; scrollY: number };

type BrowseOutput = {
    success: boolean;
    action: string;
    url?: string;
    title?: string;
    text?: string;
    result?: unknown;
    error?: string;
    elements?: ElementInfo[];
    pageInfo?: PageInfo;
    tabs?: TabInfo[];
    activeTab?: number;
    profiles?: string[];
};

const logger = log("browser");

// ─── Globals ─────────────────────────────────────────────────────────────

let _context: BrowserContext | null = null;
let _page: Page | null = null;
let _currentProfile: string = "default";
const PROFILES_DIR = ".agents";

// ─── Helpers ─────────────────────────────────────────────────────────────

function getProfileDir(profileName: string): string {
    return join(PROFILES_DIR, `browser-profile-${profileName}`);
}

function listAllProfiles(): string[] {
    try {
        if (!existsSync(PROFILES_DIR)) return ["default"];
        const entries = readdirSync(PROFILES_DIR, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && e.name.startsWith("browser-profile-"))
            .map(e => e.name.replace("browser-profile-", ""));
    } catch {
        return ["default"];
    }
}

async function getPage(profileName?: string): Promise<Page> {
    const cfg = getConfig();
    const targetProfile = profileName ?? _currentProfile;
    const profileDir = getProfileDir(targetProfile);

    // If profile changed, close current and recreate
    if (_context && targetProfile !== _currentProfile) {
        logger.info(`switching profile: ${_currentProfile} → ${targetProfile}`);
        await _context.close().catch(() => { });
        _context = null;
        _page = null;
    }

    // Lazy-create persistent context
    if (!_context) {
        mkdirSync(profileDir, { recursive: true });

        const { chromium } = await import("playwright");

        // Merge user config with defaults
        const launchOpts = {
            headless: cfg.browser?.headless ?? true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                ...(cfg.browser?.extraArgs ?? []),
            ],
        };

        const contextOpts = {
            viewport: cfg.browser?.viewport ?? { width: 1280, height: 800 },
            userAgent: cfg.browser?.userAgent,
            locale: cfg.browser?.locale ?? "en-US",
            timezoneId: cfg.browser?.timezone ?? "Asia/Kolkata",
            permissions: ["geolocation"],
            ...cfg.browser?.context,
        };

        _context = await chromium.launchPersistentContext(profileDir, {
            ...launchOpts,
            ...contextOpts,
        }) as unknown as BrowserContext;

        // Attach global element counter to window for vision overlay
        await _context.addInitScript(() => {
            (window as any).__forkscoutFid = 0;
        });

        const pages = _context.pages();
        _page = pages.length > 0 ? pages[0] : await _context.newPage();
        _currentProfile = targetProfile;

        logger.info(`browser started with profile: ${targetProfile}`);
    }

    return _page!;
}

function requireContext(action: string): BrowserContext | { success: boolean; action: string; error: string } {
    if (!_context) return { success: false, action, error: "Browser not initialized. Use navigate first." };
    return _context;
}

/**
 * Strip common LLM quoting artefacts from a CSS selector:
 *   - Balanced surrounding quotes: '"[sel]"' → '[sel]'
 *   - Lone trailing quote after closing CSS token: '[sel]'' → '[sel]'
 */
function sanitizeSelector(sel: string): string {
    sel = sel.trim();
    if (
        (sel.startsWith('"') && sel.endsWith('"')) ||
        (sel.startsWith("'") && sel.endsWith("'"))
    ) {
        sel = sel.slice(1, -1).trim();
    }
    sel = sel.replace(/([)\]>\w])['"]$/, "$1");
    return sel;
}

function resolveSelector(selector?: string, elementId?: string): string | undefined {
    if (elementId) return `[data-fid="${elementId}"]`;
    if (selector) return sanitizeSelector(selector);
    return undefined;
}

async function resolvePoint(page: Page, selector?: string, x?: number, y?: number) {
    if (selector) {
        const cleanSel = sanitizeSelector(selector);
        const box = await page.locator(cleanSel).first().boundingBox().catch(() => null);
        if (!box) return { error: `Element not found: ${cleanSel}` };
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    if (x != null && y != null) return { x, y };
    return { error: "Either selector or x+y required" };
}

async function settle(page: Page): Promise<void> {
    // 2s settle for any post-interaction JS rendering
    await page.waitForTimeout(2000);
}

async function pageState(page: Page): Promise<{ url: string; title: string }> {
    return {
        url: page.url(),
        title: await page.title().catch(() => ""),
    };
}

// ─── Vision Overlay ─────────────────────────────────────────────────────

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select", "details", "summary"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "radio", "textbox", "combobox", "menuitem", "tab", "menu", "switch"]);

function getColor(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const role = el.getAttribute("role") ?? "";

    if (tag === "a" || role === "link") return "#22c55e"; // GREEN - link
    if (tag === "button" || role === "button" || type === "submit" || type === "button") return "#ef4444"; // RED - button
    if (tag === "input" || tag === "textarea" || tag === "select" || role === "textbox" || role === "combobox") return "#3b82f6"; // BLUE - input
    if (tag === "input" && (type === "checkbox" || type === "radio") || role === "checkbox" || role === "radio") return "#a855f7"; // PURPLE - checkbox
    if (role === "tab" || role === "menu" || role === "menuitem") return "#f59e0b"; // AMBER - tab/menu

    return "#64748b"; // SLATE - default
}

async function injectHighlightOverlay(page: Page): Promise<number> {
    return await page.evaluate(() => {
        const w = window as any;
        if (w.__forkscoutFid === undefined) w.__forkscoutFid = 0;

        // Remove old overlay if exists
        document.getElementById("__forkscout_overlay__")?.remove();

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const seen = new Set<string>();
        let count = 0;

        const overlay = document.createElement("div");
        overlay.id = "__forkscout_overlay__";
        overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:999999;";

        for (const el of Array.from(document.querySelectorAll("*"))) {
            const tag = el.tagName.toLowerCase();
            if (tag === "script" || tag === "style" || tag === "meta" || tag === "head") continue;
            const role = el.getAttribute("role") ?? "";
            const type = (el.getAttribute("type") ?? "").toLowerCase();
            if (type === "hidden") continue;

            const isInteractive =
                INTERACTIVE_TAGS.has(tag) ||
                INTERACTIVE_ROLES.has(role) ||
                el.hasAttribute("onclick") ||
                (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1");
            if (!isInteractive) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) continue;
            if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

            const innerText = (el as any).innerText?.trim().slice(0, 20) ?? "";
            const placeholder = el.getAttribute("placeholder") ?? "";
            const key = `${tag}|${type}|${innerText}|${placeholder}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            let fid = el.getAttribute("data-fid");
            if (!fid) { fid = "e" + (++w.__forkscoutFid); el.setAttribute("data-fid", fid); }

            const color = getColor(el);

            // Colored border around element
            const border = document.createElement("div");
            border.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid ${color};box-sizing:border-box;pointer-events:none;border-radius:3px;`;
            overlay.appendChild(border);

            // ID badge floating above (or inside top-left if near top edge)
            const badgeTop = Math.max(2, rect.top - 18);
            const badge = document.createElement("div");
            badge.textContent = fid;
            badge.style.cssText = `position:fixed;left:${Math.max(0, rect.left)}px;top:${badgeTop}px;background:${color};color:#fff;font:bold 11px/16px monospace;padding:1px 4px;border-radius:3px;pointer-events:none;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.5);`;
            overlay.appendChild(badge);

            count++;
        }

        return count;
    });
}

async function removeHighlightOverlay(page: Page): Promise<void> {
    await page.evaluate(() => { document.getElementById("__forkscout_overlay__")?.remove(); }).catch(() => { });
}

/**
 * Full vision pipeline:
 *   refresh highlights → screenshot → vision model analysis.
 * The overlay stays visible on the page until the browser session is closed,
 * so the agent always sees labeled elements during the current task.
 * Returns structured text the main agent can act on directly (element IDs + recommended action).
 */
async function visionAnalyzeScreen(page: Page): Promise<{ visionText: string; elementCount: number }> {
    const cfg = getConfig();
    const elementCount = await injectHighlightOverlay(page);
    const quality = cfg.browser?.screenshotQuality ?? 50;
    const buf = await page.screenshot({ type: "jpeg", quality, fullPage: false });
    // Overlay intentionally left in place — persists across interactions for the lifetime of the task.

    const visionModel = getModelForRole("vision", cfg.llm);
    const visionPrompt =
        cfg.browserAgent?.screenshotPrompt ??
        "You are the vision module for a browser automation agent.\n" +
        "The screenshot has colored overlays with element ID badges drawn over every interactive element:\n" +
        "  RED=[button/submit]  BLUE=[input/textarea/select]  GREEN=[link/anchor]  AMBER=[tab/menu]  PURPLE=[checkbox/radio]\n\n" +
        "Respond in this exact format:\n\n" +
        "PAGE: <one sentence describing what page/screen this is and its current state>\n\n" +
        "ELEMENTS:\n" +
        "- [eN] type: \"<visible label or placeholder>\" — <what it does or where it leads>\n" +
        "(list every labeled element visible on screen)\n\n" +
        "RECOMMENDED ACTION: <which element ID to interact with next, what value to type if it's an input, and why>\n\n" +
        "Be precise with IDs — the agent will act on exactly what you specify.";

    const { text: visionText } = await generateText({
        model: visionModel,
        messages: [
            {
                role: "user",
                content: [
                    { type: "image", image: buf.buffer as ArrayBuffer, mediaType: "image/jpeg" },
                    { type: "text", text: visionPrompt },
                ],
            },
        ],
        maxOutputTokens: cfg.browserAgent?.maxTokens ?? 2048,
    });

    logger.info(`vision analysis: ${elementCount} elements highlighted`);
    return { visionText, elementCount };
}

// ─── Tab helpers ──────────────────────────────────────────────────────────

async function tabList(context: BrowserContext, activePage: Page): Promise<TabInfo[]> {
    const pages = context.pages();
    return Promise.all(
        pages.map(async (p, i) => ({
            index: i,
            url: p.url(),
            title: await p.title().catch(() => ""),
            active: p === activePage,
        }))
    );
}

// ─── Tool ──────────────────────────────────────────────────────────────────

export const web_browser_tools = tool<BrowseInput, BrowseOutput>({
    description: `Full Playwright browser automation.
Actions: navigate, click, type, fill, scroll, screenshot, get_text, hover,
select_option, press, wait_for, evaluate, go_back, go_forward, get_url,
get_title, find_elements, search_text, drag, click_xy, close.
Tab management: new_tab (optionally with url), close_tab (tabIndex), switch_tab (tabIndex), list_tabs.
Profile management: list_profiles, create_profile, switch_profile, close.

VISION PIPELINE (navigate + screenshot):
- navigate and screenshot both auto-highlight all interactive elements with colored border boxes
  and floating ID badges (e1, e2, e3...) BEFORE taking the screenshot.
- The screenshot is passed to a vision model which returns:
    PAGE: <current state>  ELEMENTS: [eN] type: label — purpose  RECOMMENDED ACTION: which ID to use next
- Always act on the element IDs returned by the vision model — never guess selectors.
- Color legend in screenshots: RED=button  BLUE=input/textarea  GREEN=link  AMBER=tab/menu  PURPLE=checkbox

find_elements: returns visible elements sorted by interactivity score, each with a stable id (e.g. 'e3').
search_text: finds elements anywhere on the full page by text/aria-label — check inViewport + y to know if scroll needed.
Always use elementId (from vision output / find_elements / search_text) instead of selector or x/y.

Profile support: Use 'profile' param to isolate browser state (cookies, localStorage, extensions).
- list_profiles: show all available profiles
- create_profile: create a new named profile
- switch_profile: switch to a different profile (closes current browser, opens new)
- Default profile: "default" (created automatically)`,

    inputSchema: browseSchema,

    execute: async (input) => {
        const { action } = input;
        logger.info(`action=${action}${input.url ? ` url=${input.url}` : ""}${input.selector ? ` sel=${input.selector}` : ""}${input.profile ? ` profile=${input.profile}` : ""}`);

        try {
            // ── close — special case (no page needed) ──────────────────────
            if (action === "close") {
                if (_context) {
                    // Clean up overlay before closing
                    if (_page && !_page.isClosed()) await removeHighlightOverlay(_page).catch(() => { });
                    await _context.close();
                    _context = null;
                    _page = null;
                    logger.info("browser closed");
                }
                return { success: true, action, text: "Browser session closed." };
            }

            // ── Profile management actions (no browser needed) ─────────────
            if (action === "list_profiles") {
                const profiles = listAllProfiles();
                return { success: true, action, profiles, text: `Available profiles: ${profiles.join(", ")}` };
            }

            if (action === "create_profile") {
                const name = input.profile ?? "default";
                const dir = getProfileDir(name);
                mkdirSync(dir, { recursive: true });
                logger.info(`profile created: ${name}`);
                return { success: true, action, text: `Profile "${name}" created at ${dir}` };
            }

            if (action === "switch_profile") {
                const name = input.profile ?? "default";
                // Close current context
                if (_context) {
                    if (_page && !_page.isClosed()) await removeHighlightOverlay(_page).catch(() => { });
                    await _context.close();
                    _context = null;
                    _page = null;
                }
                // Get page with new profile (creates context)
                await getPage(name);
                return { success: true, action, text: `Switched to profile: ${name}`, profile: name };
            }

            const page = await getPage(input.profile);

            switch (action) {

                // ── navigate ─────────────────────────────────────────────────────
                case "navigate": {
                    if (!input.url) return { success: false, action, error: "url is required for navigate" };
                    // "domcontentloaded" fires as soon as DOM is parsed — fastest reliable event
                    // SPAs like Twitter keep loading resources indefinitely so "load"/"networkidle" hang
                    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
                    // Best-effort settle for any post-load JS rendering (max 2s)
                    await settle(page);
                    const state = await pageState(page);
                    // Highlight interactive elements and analyze via vision model
                    const { visionText: navVision, elementCount: navCount } = await visionAnalyzeScreen(page);
                    return { success: true, action, ...state, text: navVision, result: { elementsHighlighted: navCount } };
                }

                // ── click ──────────────────────────────────────────────────
                case "click": {
                    await page.bringToFront();
                    const clickSel = resolveSelector(input.selector, input.elementId);
                    if (clickSel) {
                        await page.click(clickSel, { timeout: 10_000 });
                    } else if (input.text) {
                        await page.getByText(input.text, { exact: false }).first().click({ timeout: 10_000 });
                    } else {
                        return { success: false, action, error: "selector or text required for click" };
                    }
                    await settle(page);
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── type ───────────────────────────────────────────────────
                case "type": {
                    if (!input.text) return { success: false, action, error: "text required for type" };
                    await page.bringToFront();
                    const typeSel = resolveSelector(input.selector, input.elementId);
                    if (typeSel) {
                        await page.type(typeSel, input.text, { timeout: 10_000, delay: 40 });
                    } else {
                        // No selector — type into whatever element is currently focused (e.g. after click_xy)
                        await page.keyboard.type(input.text, { delay: 40 });
                    }
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── fill ───────────────────────────────────────────────────
                case "fill": {
                    const fillSel = resolveSelector(input.selector, input.elementId);
                    if (!fillSel) return { success: false, action, error: "selector or elementId required for fill" };
                    await page.fill(fillSel, input.value ?? "", { timeout: 10_000 });
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── scroll ─────────────────────────────────────────────────
                case "scroll": {
                    const scrollSel = resolveSelector(input.selector, input.elementId);
                    if (scrollSel) {
                        await page.locator(scrollSel).scrollIntoViewIfNeeded({ timeout: 10_000 });
                        return { success: true, action, text: `Scrolled ${scrollSel} into view`, ...(await pageState(page)) };
                    }
                    const dir = input.direction ?? "down";
                    const px = input.amount ?? 600;
                    const deltaX = dir === "left" ? -px : 0;
                    const deltaY = dir === "up" ? -px : 0;
                    await page.mouse.wheel(deltaX, deltaY);
                    return { success: true, action, text: `Scrolled ${dir} ${px}px`, ...(await pageState(page)) };
                }

                // ── screenshot ────────────────────────────────────────────
                case "screenshot": {
                    // Highlight elements → capture → remove overlay → vision analysis
                    const { visionText, elementCount } = await visionAnalyzeScreen(page);
                    return { success: true, action, ...(await pageState(page)), text: visionText, result: { elementsHighlighted: elementCount } };
                }

                // ── get_text ───────────────────────────────────────────────
                case "get_text": {
                    let text: string;
                    const getTextSel = resolveSelector(input.selector, input.elementId);
                    if (getTextSel) {
                        // Specific selector — return as-is, no noise removal
                        text = (await page.innerText(getTextSel, { timeout: 10_000 })).trim().slice(0, 8000);
                    } else {
                        // Full page — remove noise elements first, runs inside real browser DOM
                        text = await page.evaluate(`(() => {
                            const clone = document.body.cloneNode(true);
                            clone.querySelectorAll(
                                "nav,footer,header,aside,script,style,noscript,iframe," +
                                "[role='banner'],[role='navigation'],[role='complementary']," +
                                "[aria-hidden='true'],[hidden],.ad,.ads,.advertisement," +
                                ".sidebar,.cookie-banner,.popup,.modal-backdrop"
                            ).forEach(el => el.remove());
                            return (clone.innerText || "").replace(/\\s{2,}/g, " ").trim();
                        })()`) as string;
                        text = text.slice(0, 8000);
                    }
                    return { success: true, action, ...(await pageState(page)), text };
                }

                // ── hover ──────────────────────────────────────────────────
                case "hover": {
                    const hoverSel = resolveSelector(input.selector, input.elementId);
                    if (!hoverSel) return { success: false, action, error: "selector or elementId required for hover" };
                    await page.hover(hoverSel, { timeout: 10_000 });
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── select_option ──────────────────────────────────────────
                case "select_option": {
                    const selectSel = resolveSelector(input.selector, input.elementId);
                    if (!selectSel) return { success: false, action, error: "selector or elementId required for select_option" };
                    await page.selectOption(selectSel, input.value ?? "", { timeout: 10_000 });
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── press ──────────────────────────────────────────────────
                case "press": {
                    if (!input.key) return { success: false, action, error: "key required for press" };
                    await page.bringToFront();
                    const pressSel = resolveSelector(input.selector, input.elementId);
                    if (pressSel) {
                        await page.press(pressSel, input.key, { timeout: 10_000 });
                    } else {
                        await page.keyboard.press(input.key);
                    }
                    await settle(page);
                    return { success: true, action, text: `Pressed ${input.key}`, ...(await pageState(page)) };
                }

                // ── wait_for ───────────────────────────────────────────────
                case "wait_for": {
                    const waitSel = resolveSelector(input.selector, input.elementId);
                    if (!waitSel) return { success: false, action, error: "selector or elementId required for wait_for" };
                    // Floor at 15s — models tend to pass small values; dynamic SPAs (Twitter, etc.) need time
                    const waitTimeout = Math.max(input.timeout ?? 15_000, 15_000);
                    await page.waitForSelector(waitSel, { timeout: waitTimeout });
                    return { success: true, action, text: `Element "${waitSel}" is visible`, ...(await pageState(page)) };
                }

                // ── evaluate ───────────────────────────────────────────────
                case "evaluate": {
                    if (!input.script) return { success: false, action, error: "script required for evaluate" };
                    const result = await page.evaluate(input.script);
                    return { success: true, action, result, ...(await pageState(page)) };
                }

                // ── go_back / go_forward ───────────────────────────────────
                case "go_back":
                case "go_forward": {
                    await (action === "go_back"
                        ? page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 })
                        : page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 })
                    );
                    return { success: true, action, ...(await pageState(page)) };
                }

                // ── get_url / get_title ────────────────────────────────────
                case "get_url": return { success: true, action, url: page.url() };
                case "get_title": return { success: true, action, title: await page.title() };

                // ── click_xy ──────────────────────────────────────────────
                case "click_xy": {
                    if (input.x == null || input.y == null) return { success: false, action, error: "x and y required for click_xy" };
                    await page.bringToFront();
                    // Move mouse naturally to position first, then click
                    await page.mouse.move(input.x, input.y, { steps: 5 });
                    await page.mouse.click(input.x, input.y);
                    await settle(page);
                    return { success: true, action, text: `Clicked at (${input.x}, ${input.y})`, ...(await pageState(page)) };
                }

                // ── drag ──────────────────────────────────────────────────
                case "drag": {
                    const dragSrcSel = resolveSelector(input.selector, input.elementId);
                    const dragDstSel = resolveSelector(input.targetSelector, input.targetElementId);
                    const srcPt = await resolvePoint(page, dragSrcSel, input.x, input.y);
                    if ("error" in srcPt) return { success: false, action, error: srcPt.error };
                    const dstPt = await resolvePoint(page, dragDstSel, input.targetX, input.targetY);
                    if ("error" in dstPt) return { success: false, action, error: dstPt.error };

                    if (dragSrcSel && dragDstSel) {
                        // Cleanest path — Playwright handles center resolution internally
                        await page.dragAndDrop(dragSrcSel, dragDstSel, { timeout: 10_000 });
                    } else {
                        await page.mouse.move(srcPt.x, srcPt.y, { steps: 5 });
                        await page.mouse.down();
                        // 20-step interpolation avoids snap-back on kanban/sortable drop targets
                        await page.mouse.move(dstPt.x, dstPt.y, { steps: 20 });
                        await page.mouse.up();
                    }

                    await settle(page);
                    const srcLabel = dragSrcSel ?? `(${srcPt.x},${srcPt.y})`;
                    const dstLabel = dragDstSel ?? `(${dstPt.x},${dstPt.y})`;
                    return { success: true, action, text: `Dragged "${srcLabel}" → "${dstLabel}"`, ...(await pageState(page)) };
                }

                // ── find_elements ──────────────────────────────────────────
                case "find_elements": {
                    const sel = input.selector ?? "*";
                    const { elements, pageInfo } = await page.evaluate((sel: string) => {
                        const USEFUL_ATTRS = ["id", "name", "href", "src", "type", "placeholder",
                            "role", "aria-label", "aria-placeholder", "value", "for", "action",
                            "data-testid", "data-id", "inputmode", "autocomplete"];

                        function interactivityScore(el: Element): number {
                            const tag = el.tagName.toLowerCase();
                            const role = el.getAttribute("role") ?? "";
                            const type = (el.getAttribute("type") ?? "").toLowerCase();
                            const innerText = (el as any).innerText?.trim() ?? "";
                            const ariaLabel = el.getAttribute("aria-label") ?? "";
                            const placeholder = el.getAttribute("placeholder") ?? "";

                            let score = 0;
                            if (tag === "a" || role === "link") score += 10;
                            if (tag === "button" || role === "button" || type === "submit" || type === "button") score += 20;
                            if (tag === "input" || tag === "textarea" || tag === "select" || role === "textbox") score += 15;
                            if (innerText.length > 0 || placeholder || ariaLabel) score += 5;
                            if (el.hasAttribute("onclick") || el.hasAttribute("href")) score += 5;
                            return score;
                        }

                        const vw = window.innerWidth, vh = window.innerHeight;
                        const seen = new Set<string>();
                        const result: any[] = [];

                        for (const el of Array.from(document.querySelectorAll(sel))) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width < 4 || rect.height < 4) continue;
                            if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

                            const tag = el.tagName.toLowerCase();
                            const innerText = (el as any).innerText?.trim().slice(0, 80) ?? "";
                            const ariaLabel = el.getAttribute("aria-label") ?? "";
                            const text = innerText || ariaLabel;
                            if (!text) continue;

                            const attrs: Record<string, string> = {};
                            for (const a of Array.from(el.attributes)) {
                                if (USEFUL_ATTRS.includes(a.name)) attrs[a.name] = a.value.slice(0, 100);
                            }

                            const key = `${tag}|${text}|${attrs.href ?? ""}`;
                            if (seen.has(key)) continue;
                            seen.add(key);

                            let fid = el.getAttribute("data-fid");
                            if (!fid) { fid = "e" + (++(window as any).__forkscoutFid); el.setAttribute("data-fid", fid); }

                            result.push({
                                id: fid,
                                tag,
                                text,
                                attrs,
                                score: interactivityScore(el),
                                inViewport: true, // find_elements only returns in-viewport elements
                                x: Math.round(rect.left), y: Math.round(rect.top),
                                width: Math.round(rect.width), height: Math.round(rect.height),
                                centerX: Math.round(rect.left + rect.width / 2),
                                centerY: Math.round(rect.top + rect.height / 2),
                            });
                            if (result.length >= 200) break;
                        }

                        result.sort((a, b) => b.score - a.score);
                        return {
                            elements: result,
                            pageInfo: {
                                viewportWidth: vw, viewportHeight: vh,
                                pageWidth: document.documentElement.scrollWidth,
                                pageHeight: document.documentElement.scrollHeight,
                                scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY),
                            },
                        };
                    }, sel);
                    return { success: true, action, elements, pageInfo, text: `Found ${elements.length} elements in viewport (page: ${pageInfo.pageWidth}×${pageInfo.pageHeight}, scroll: ${pageInfo.scrollX},${pageInfo.scrollY})`, ...(await pageState(page)) };
                }

                // ── search_text ────────────────────────────────────────────
                case "search_text": {
                    if (!input.text) return { success: false, action, error: "text required for search_text" };
                    const { elements, pageInfo } = await page.evaluate((query: string) => {
                        const USEFUL_ATTRS = ["id", "name", "href", "src", "type", "placeholder",
                            "role", "aria-label", "aria-placeholder", "value", "for", "action",
                            "data-testid", "data-id", "inputmode", "autocomplete"];

                        function interactivityScore(el: Element): number {
                            const tag = el.tagName.toLowerCase();
                            const role = el.getAttribute("role") ?? "";
                            const type = (el.getAttribute("type") ?? "").toLowerCase();
                            const placeholder = el.getAttribute("placeholder") ?? "";
                            const title = el.getAttribute("title") ?? "";

                            const innerText = (el as any).innerText?.trim() ?? "";
                            const ariaLabel = el.getAttribute("aria-label") ?? "";

                            const haystack = `${innerText} ${ariaLabel} ${placeholder} ${title}`.toLowerCase();
                            if (!haystack.includes(query)) return 0;

                            let score = 0;
                            if (tag === "a" || role === "link") score += 10;
                            if (tag === "button" || role === "button" || type === "submit") score += 20;
                            if (tag === "input" || tag === "textarea" || role === "textbox") score += 15;
                            if (innerText || ariaLabel || placeholder) score += 5;
                            return score;
                        }

                        const vw = window.innerWidth, vh = window.innerHeight;
                        const seen = new Set<string>();
                        const result: any[] = [];
                        const q = query.toLowerCase();

                        for (const el of Array.from(document.querySelectorAll("*"))) {
                            const tag = el.tagName.toLowerCase();
                            if (tag === "script" || tag === "style" || tag === "meta" || tag === "head") continue;

                            const innerText = (el as any).innerText?.trim() ?? "";
                            const ariaLabel = el.getAttribute("aria-label") ?? "";
                            const placeholder = el.getAttribute("placeholder") ?? "";
                            const title = el.getAttribute("title") ?? "";

                            const haystack = `${innerText} ${ariaLabel} ${placeholder} ${title}`.toLowerCase();
                            if (!haystack.includes(q)) continue;

                            const rect = el.getBoundingClientRect();
                            if (rect.width < 4 || rect.height < 4) continue;

                            const text = innerText.slice(0, 80);
                            const attrs: Record<string, string> = {};
                            for (const a of Array.from(el.attributes)) {
                                if (USEFUL_ATTRS.includes(a.name)) attrs[a.name] = a.value.slice(0, 100);
                            }

                            const key = `${el.tagName}|${text}|${attrs.href ?? ""}`;
                            if (seen.has(key)) continue;
                            seen.add(key);

                            // Stamp a stable data-fid on the DOM element so the agent can reference it
                            let fid = el.getAttribute("data-fid");
                            if (!fid) { fid = "e" + (++(window as any).__forkscoutFid); el.setAttribute("data-fid", fid); }

                            result.push({
                                id: fid,
                                tag: el.tagName.toLowerCase(), text, attrs,
                                score: interactivityScore(el),
                                inViewport: rect.top >= 0 && rect.bottom <= vh && rect.left >= 0 && rect.right <= vw,
                                x: Math.round(rect.left), y: Math.round(rect.top),
                                width: Math.round(rect.width), height: Math.round(rect.height),
                                centerX: Math.round(rect.left + rect.width / 2),
                                centerY: Math.round(rect.top + rect.height / 2),
                            });
                            if (result.length >= 50) break;
                        }

                        result.sort((a, b) => b.score - a.score);
                        return {
                            elements: result,
                            pageInfo: {
                                viewportWidth: vw, viewportHeight: vh,
                                pageWidth: document.documentElement.scrollWidth,
                                pageHeight: document.documentElement.scrollHeight,
                                scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY),
                            },
                        };
                    }, input.text);
                    return { success: true, action, elements, pageInfo, text: `Found ${elements.length} elements containing "${input.text}" (page: ${pageInfo.pageWidth}×${pageInfo.pageHeight}, scroll: ${pageInfo.scrollX},${pageInfo.scrollY})`, ...(await pageState(page)) };
                }

                // ── new_tab ────────────────────────────────────────────────
                case "new_tab": {
                    const ctx_nt = requireContext(action); if (!("pages" in ctx_nt)) return ctx_nt;
                    const newPage = await ctx_nt.newPage();
                    _page = newPage;
                    if (input.url) {
                        await newPage.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
                    }
                    const tabs = await tabList(ctx_nt, _page);
                    const activeTab = tabs.findIndex(t => t.active);
                    return { success: true, action, ...(await pageState(_page)), tabs, activeTab, text: `Opened new tab ${activeTab}${input.url ? ` → ${input.url}` : ""}` };
                }

                // ── close_tab ──────────────────────────────────────────────
                case "close_tab": {
                    const ctx_ct = requireContext(action); if (!("pages" in ctx_ct)) return ctx_ct;
                    const allPages = ctx_ct.pages();
                    const targetIdx = input.tabIndex ?? allPages.indexOf(_page!);
                    if (targetIdx < 0 || targetIdx >= allPages.length) {
                        return { success: false, action, error: `tabIndex ${targetIdx} out of range (0–${allPages.length - 1})` };
                    }
                    const closing = allPages[targetIdx];
                    const wasActive = closing === _page;
                    await closing.close();
                    if (wasActive) {
                        const remaining = ctx_ct.pages();
                        _page = remaining.length > 0 ? remaining[Math.min(targetIdx, remaining.length - 1)] : null;
                    }
                    const tabs_ct = _page ? await pageState(_page) : {};
                    return { success: true, action, ...tabs_ct, text: `Closed tab ${targetIdx}` };
                }

                // ── switch_tab ─────────────────────────────────────────────
                case "switch_tab": {
                    const ctx_st = requireContext(action); if (!("pages" in ctx_st)) return ctx_st;
                    const allPages = ctx_st.pages();
                    const idx = input.tabIndex ?? 0;
                    if (idx < 0 || idx >= allPages.length) {
                        return { success: false, action, error: `tabIndex ${idx} out of range (0–${allPages.length - 1})` };
                    }
                    _page = allPages[idx];
                    await _page.bringToFront().catch(() => { });
                    const tabs_st = await tabList(ctx_st, _page);
                    return { success: true, action, ...(await pageState(_page)), tabs: tabs_st, activeTab: idx, text: `Switched to tab ${idx}: ${_page.url()}` };
                }

                // ── list_tabs ──────────────────────────────────────────────
                case "list_tabs": {
                    const ctx_lt = requireContext(action); if (!("pages" in ctx_lt)) return ctx_lt;
                    const tabs = await tabList(ctx_lt, page);
                    const activeTab = tabs.findIndex(t => t.active);
                    return { success: true, action, tabs, activeTab, text: `${tabs.length} tab(s) open` };
                }

                default:
                    return { success: false, action, error: `Unknown action: ${action}` };
            }
        } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            logger.error(`action=${action} error=${msg}`);
            return { success: false, action, error: msg };
        }
    },
});
