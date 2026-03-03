// src/config.ts — Config loader + re-exports for types
import { readFileSync, existsSync, watch } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Re-export all types so existing imports (`from "@/config.ts"`) keep working
export type {
    ModelTiers, ModelTier, LLMConfig, BrowserAgentConfig, AgentConfig,
    SelfJobConfig, ToolDefaults, N8nConfig, AppConfig,
    ChannelDefaults, ChannelsConfig,
    TelegramChannelConfig, TerminalChannelConfig, SelfChannelConfig,
    WhatsAppChannelConfig, DiscordChannelConfig, SlackChannelConfig,
    EmailChannelConfig, MatrixChannelConfig, WebchatChannelConfig,
    TeamsChannelConfig, GoogleChatChannelConfig, LineChannelConfig,
    ViberChannelConfig, MessengerChannelConfig, InstagramChannelConfig,
    TwitterChannelConfig, RedditChannelConfig, YoutubeChannelConfig,
    SmsChannelConfig, VoiceChannelConfig,
} from "@/config-types.ts";
import type { AppConfig } from "@/config-types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Deep-merge source into target (objects only, arrays replaced not merged) */
function deepMerge<T>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const s = source[key];
        const t = target[key];
        if (s !== undefined) {
            (result as any)[key] =
                s !== null && typeof s === "object" && !Array.isArray(s) && typeof t === "object" && t !== null
                    ? deepMerge(t, s as any)
                    : s;
        }
    }
    return result;
}

let _config: AppConfig | null = null;

/** Path to the gitignored auth override file */
const AUTH_FILE = resolve(__dirname, "..", ".agents", "auth.json");

const CONFIG_PATH = resolve(__dirname, "forkscout.config.json");
function startConfigWatcher(): void {
    const invalidate = (filename: string | null) => {
        if (!_config) return;
        _config = null;
        console.log(`[config] hot-reload: ${filename ?? "config"} changed — cache cleared`);
    };
    try { watch(CONFIG_PATH, { persistent: false }, (_, f) => invalidate(f)); } catch { /* ignore */ }
    try { watch(AUTH_FILE, { persistent: false }, (_, f) => invalidate(f)); } catch { /* ignore */ }
}
startConfigWatcher();

export function loadConfig(): AppConfig {
    if (_config) return _config;

    const configPath = resolve(__dirname, "forkscout.config.json");
    const raw = readFileSync(configPath, "utf-8");
    let config = JSON.parse(raw) as AppConfig;

    if (!config.channels.telegram.ownerUserIds) config.channels.telegram.ownerUserIds = [];

    if (existsSync(AUTH_FILE)) {
        const authRaw = readFileSync(AUTH_FILE, "utf-8");
        config = deepMerge(config, JSON.parse(authRaw) as Partial<AppConfig>);
    }

    if (process.env.BROWSER_HEADLESS === "true") {
        config.browser.headless = true;
        config.browser.chromePath = undefined;
    }

    _config = config;
    return _config;
}

export function getConfig(): AppConfig {
    if (!_config) return loadConfig();
    return _config;
}