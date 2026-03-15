import type { AppConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("cli");

// ── CLI LLM overrides — applied before initProviders ─────────────────────────
// Usage: forkscout start --provider openrouter --model "qwen/qwen3-14b" \
//          --tier balanced --url https://... --max-tokens 4096 --max-steps 30
export function applyCliOverrides(config: AppConfig) {
    const arg = (flag: string): string | undefined => {
        const i = process.argv.indexOf(flag);
        return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
    };
    const flag = (name: string) => process.argv.includes(name);
    const ov = {
        provider: arg("--provider"),
        tier: arg("--tier"),
        model: arg("--model"),
        url: arg("--url"),
        apiKey: arg("--api-key"),
        maxTokens: arg("--max-tokens"),
        maxSteps: arg("--max-steps"),
        loopGuard: arg("--loop-guard"),
        reasoningTag: arg("--reasoning-tag"),
        compressWords: arg("--compress-words"),
        visionModel: arg("--vision-model"),
        summarizerModel: arg("--summarizer-model"),
        planFirst: flag("--plan-first"),
    };
    if (ov.provider) {
        logger.info(`[cli] provider override: ${config.llm.provider} → ${ov.provider}`);
        config.llm.provider = ov.provider;
    }
    if (ov.tier && ["fast", "balanced", "powerful"].includes(ov.tier)) {
        logger.info(`[cli] tier override: ${config.llm.tier} → ${ov.tier}`);
        (config.llm as any).tier = ov.tier;
    }
    if (ov.maxTokens) config.llm.maxTokens = parseInt(ov.maxTokens, 10);
    if (ov.maxSteps) config.llm.maxSteps = parseInt(ov.maxSteps, 10);
    if (ov.loopGuard) config.llm.loopGuardMaxConsecutive = parseInt(ov.loopGuard, 10);
    if (ov.reasoningTag) config.llm.reasoningTag = ov.reasoningTag;
    if (ov.compressWords) config.llm.toolResultAutoCompressWords = parseInt(ov.compressWords, 10);
    if (ov.planFirst) { config.llm.planFirst = true; logger.info("[cli] planFirst enabled"); }
    if (ov.model || ov.url || ov.apiKey || ov.visionModel || ov.summarizerModel) {
        const p = config.llm.provider;
        if (!config.llm.providers[p]) config.llm.providers[p] = { fast: "", balanced: "", powerful: "" };
        if (ov.model) {
            const t = config.llm.tier;
            logger.info(`[cli] model override (${p}/${t}): ${config.llm.providers[p][t]} → ${ov.model}`);
            (config.llm.providers[p] as any)[t] = ov.model;
        }
        if (ov.visionModel) {
            logger.info(`[cli] vision model override (${p}): ${ov.visionModel}`);
            (config.llm.providers[p] as any).vision = ov.visionModel;
        }
        if (ov.summarizerModel) {
            logger.info(`[cli] summarizer model override (${p}): ${ov.summarizerModel}`);
            (config.llm.providers[p] as any).summarizer = ov.summarizerModel;
        }
        if (ov.url) {
            logger.info(`[cli] baseURL override (${p}): ${ov.url}`);
            config.llm.providers[p]._baseURL = ov.url;
        }
        if (ov.apiKey) {
            logger.info(`[cli] apiKey override set for provider: ${p}`);
            config.llm.providers[p]._apiKey = ov.apiKey;
        }
    }
}
