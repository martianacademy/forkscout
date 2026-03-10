// components/SettingsPanel.tsx — Full standalone settings: provider, model, API keys, behaviour
import { useState } from "react";
import type { Settings } from "../types";
import { PROVIDERS, getProviderDef } from "../ai/providers";
import styles from "./SettingsPanel.module.css";

interface Props {
    settings: Settings;
    onSave: (s: Settings) => void;
    onClose: () => void;
}

export function SettingsPanel({ settings, onSave, onClose }: Props) {
    const [draft, setDraft] = useState<Settings>({ ...settings });

    const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
        setDraft(prev => ({ ...prev, [k]: v }));

    const setKey = (provider: string, key: string) =>
        setDraft(prev => ({ ...prev, apiKeys: { ...prev.apiKeys, [provider]: key } }));

    const currentProvider = getProviderDef(draft.provider);

    const save = () => onSave(draft);

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.panel}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Settings</h2>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>

                {/* Provider */}
                <div className={styles.section}>
                    <p className={styles.sectionTitle}>AI Provider</p>
                    <div className={styles.providerGrid}>
                        {PROVIDERS.map(p => (
                            <button
                                key={p.id}
                                className={`${styles.providerCard} ${draft.provider === p.id ? styles.active : ""}`}
                                onClick={() => {
                                    set("provider", p.id);
                                    set("model", p.defaultModel);
                                }}
                            >{p.name}</button>
                        ))}
                    </div>
                </div>

                <hr className={styles.divider} />

                {/* Model selection */}
                <div className={styles.section}>
                    <p className={styles.sectionTitle}>Model</p>
                    <div className={styles.modelGrid}>
                        {currentProvider.models.map(m => (
                            <button
                                key={m.id}
                                className={`${styles.modelCard} ${draft.model === m.id ? styles.active : ""}`}
                                onClick={() => set("model", m.id)}
                            >
                                <div className={styles.modelName}>{m.name}{m.vision ? " 👁" : ""}</div>
                                <div className={styles.modelMeta}>{(m.contextLength / 1000).toFixed(0)}k ctx</div>
                            </button>
                        ))}
                    </div>
                    {/* Custom model ID override */}
                    <div className={styles.field} style={{ marginTop: 8 }}>
                        <label className={styles.label}>
                            Custom model ID (overrides selection)
                            <input className={styles.input} value={draft.model}
                                onChange={e => set("model", e.target.value)}
                                placeholder="e.g. gpt-4o or llama3.2" />
                        </label>
                    </div>
                </div>

                <hr className={styles.divider} />

                {/* API key for current provider */}
                <div className={styles.section}>
                    <p className={styles.sectionTitle}>API Keys</p>
                    {PROVIDERS.filter(p => p.requiresKey).slice(0, 6).map(p => (
                        <div key={p.id} className={styles.field}>
                            <label className={styles.label}>
                                {p.apiKeyLabel}
                                <input
                                    className={styles.input}
                                    type="password"
                                    placeholder={p.apiKeyPlaceholder}
                                    value={draft.apiKeys[p.id] ?? ""}
                                    onChange={e => setKey(p.id, e.target.value)}
                                />
                            </label>
                        </div>
                    ))}
                    {PROVIDERS.filter(p => p.requiresKey).length > 6 && (
                        <details>
                            <summary style={{ fontSize: "0.8rem", color: "var(--muted)", cursor: "pointer", marginBottom: 8 }}>
                                More providers…
                            </summary>
                            {PROVIDERS.filter(p => p.requiresKey).slice(6).map(p => (
                                <div key={p.id} className={styles.field}>
                                    <label className={styles.label}>
                                        {p.apiKeyLabel}
                                        <input
                                            className={styles.input}
                                            type="password"
                                            placeholder={p.apiKeyPlaceholder}
                                            value={draft.apiKeys[p.id] ?? ""}
                                            onChange={e => setKey(p.id, e.target.value)}
                                        />
                                    </label>
                                </div>
                            ))}
                        </details>
                    )}
                    {(draft.provider === "custom" || draft.provider === "ollama" || draft.provider === "lmstudio") && (
                        <div className={styles.field}>
                            <label className={styles.label}>
                                Base URL
                                <input className={styles.input}
                                    value={draft.provider === "custom" ? draft.customBaseURL : getProviderDef(draft.provider).baseURL}
                                    onChange={e => set("customBaseURL", e.target.value)}
                                    placeholder="http://localhost:11434/v1" />
                            </label>
                        </div>
                    )}
                </div>

                <hr className={styles.divider} />

                {/* Behaviour */}
                <div className={styles.section}>
                    <p className={styles.sectionTitle}>Behaviour</p>

                    <div className={styles.field}>
                        <label className={styles.label}>
                            System prompt
                            <textarea className={styles.textarea}
                                value={draft.systemPrompt}
                                onChange={e => set("systemPrompt", e.target.value)}
                                rows={3} />
                        </label>
                    </div>

                    <div className={styles.field}>
                        <span className={styles.label}>Temperature — {draft.temperature.toFixed(1)}</span>
                        <div className={styles.sliderRow}>
                            <input className={styles.slider} type="range" min="0" max="2" step="0.1"
                                value={draft.temperature}
                                onChange={e => set("temperature", parseFloat(e.target.value))} />
                            <span className={styles.sliderVal}>{draft.temperature.toFixed(1)}</span>
                        </div>
                    </div>

                    <div className={styles.field}>
                        <label className={styles.label}>
                            Max tokens
                            <input className={styles.input} type="number" min="256" max="32000" step="256"
                                value={draft.maxTokens}
                                onChange={e => set("maxTokens", parseInt(e.target.value) || 2048)} />
                        </label>
                    </div>

                    <div className={styles.toggleRow}>
                        <span className={styles.toggleLabel}>Streaming</span>
                        <label className={styles.toggle}>
                            <input type="checkbox" checked={draft.streamingEnabled}
                                onChange={e => set("streamingEnabled", e.target.checked)} />
                            <span className={styles.toggleTrack} />
                        </label>
                    </div>
                    <div className={styles.toggleRow}>
                        <span className={styles.toggleLabel}>Inject page context</span>
                        <label className={styles.toggle}>
                            <input type="checkbox" checked={draft.injectPageContext}
                                onChange={e => set("injectPageContext", e.target.checked)} />
                            <span className={styles.toggleTrack} />
                        </label>
                    </div>
                    <div className={styles.toggleRow}>
                        <span className={styles.toggleLabel}>Inject memories</span>
                        <label className={styles.toggle}>
                            <input type="checkbox" checked={draft.injectMemories}
                                onChange={e => set("injectMemories", e.target.checked)} />
                            <span className={styles.toggleTrack} />
                        </label>
                    </div>
                </div>

                <hr className={styles.divider} />

                {/* Forkscout MCP Bridge (optional) */}
                <div className={styles.section}>
                    <p className={styles.sectionTitle}>Forkscout Agent Bridge <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></p>
                    <div className={styles.toggleRow}>
                        <span className={styles.toggleLabel}>Connect to local forkscout agent</span>
                        <label className={styles.toggle}>
                            <input type="checkbox" checked={draft.mcpBridgeEnabled}
                                onChange={e => set("mcpBridgeEnabled", e.target.checked)} />
                            <span className={styles.toggleTrack} />
                        </label>
                    </div>
                    {draft.mcpBridgeEnabled && (
                        <>
                            <div className={styles.field}>
                                <label className={styles.label}>
                                    Agent URL
                                    <input className={styles.input} value={draft.agentUrl}
                                        onChange={e => set("agentUrl", e.target.value)}
                                        placeholder="http://localhost:3200" />
                                </label>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>
                                    Agent token
                                    <input className={styles.input} type="password" value={draft.agentToken}
                                        onChange={e => set("agentToken", e.target.value)}
                                        placeholder="from .agents/.ext-token" />
                                    <span className={styles.hint}>cat .agents/.ext-token in your forkscout project</span>
                                </label>
                            </div>
                        </>
                    )}
                </div>

                <div style={{ padding: "16px 16px 0", display: "flex", gap: 8 }}>
                    <button
                        style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", cursor: "pointer", fontSize: "0.875rem" }}
                        onClick={onClose}
                    >Cancel</button>
                    <button
                        style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}
                        onClick={save}
                    >Save settings</button>
                </div>
            </div>
        </div>
    );
}
