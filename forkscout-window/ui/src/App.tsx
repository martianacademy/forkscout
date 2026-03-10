// App.tsx — Forkscout Window: fully standalone Chrome extension side panel
import { useState, useCallback, useEffect } from "react";
import { MessageList } from "./components/MessageList";
import { InputBar } from "./components/InputBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { HistorySidebar } from "./components/HistorySidebar";
import { MemoryPanel } from "./components/MemoryPanel";
import { useSettings } from "./hooks/useSettings";
import { useChat } from "./hooks/useChat";
import { usePageContext } from "./hooks/usePageContext";
import styles from "./App.module.css";

type View = "chat" | "history" | "memory";

export function App() {
    const { settings, ready, update } = useSettings();
    const pageCtx = usePageContext();
    const {
        sessions, activeSession, messages, isStreaming, error,
        newSession, selectSession, deleteSession, send, stopStream, clearSession, setError,
    } = useChat(settings, pageCtx);

    const [view, setView] = useState<View>("chat");
    const [showSettings, setShowSettings] = useState(false);

    // Listen for INJECT_PROMPT from context menu
    useEffect(() => {
        const handler = (msg: { type: string; prompt?: string }) => {
            if (msg.type === "INJECT_PROMPT" && msg.prompt && settings) {
                setView("chat");
                send(msg.prompt);
            }
        };
        chrome.runtime.onMessage.addListener(handler);
        return () => chrome.runtime.onMessage.removeListener(handler);
    }, [send, settings]);

    const handleSend = useCallback((text: string) => {
        setError(null);
        send(text);
    }, [send, setError]);

    // No settings yet: show setup prompt
    const missingKey = settings && settings.apiKeys[settings.provider] === undefined || settings?.apiKeys[settings?.provider] === "";
    const needsSetup = ready && (!settings?.provider || (missingKey && settings?.provider !== "ollama" && settings?.provider !== "lmstudio"));

    if (!ready) {
        return <div className={styles.loading}>Loading…</div>;
    }

    return (
        <div className={styles.root}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.logo}>
                    <span className={styles.logoIcon}>⚡</span>
                    <span className={styles.logoText}>Forkscout</span>
                    {settings && (
                        <span className={styles.modelChip}>{settings.provider} / {settings.model.split("/").pop()}</span>
                    )}
                </div>
                <div className={styles.actions}>
                    {view === "chat" && (
                        <button className={styles.iconBtn} onClick={clearSession} title="Clear chat" aria-label="Clear chat">✦</button>
                    )}
                    <button
                        className={`${styles.iconBtn} ${showSettings ? styles.active : ""}`}
                        onClick={() => setShowSettings(s => !s)}
                        title="Settings" aria-label="Settings"
                    >⚙</button>
                </div>
            </header>

            {/* Error banner */}
            {error && (
                <div className={styles.errorBanner}>
                    ⚠ {error}
                    <button onClick={() => setError(null)} aria-label="Dismiss">✕</button>
                </div>
            )}

            {/* Setup hint */}
            {needsSetup && !showSettings && (
                <div className={styles.setupHint}>
                    Set your API key in <button onClick={() => setShowSettings(true)}>⚙ Settings</button>
                </div>
            )}

            {/* Page context chip */}
            {pageCtx?.url && view === "chat" && (
                <div className={styles.pageBar} title={pageCtx.url}>
                    <span className={styles.pageIcon}>🌐</span>
                    <span className={styles.pageTitle}>{pageCtx.title.slice(0, 40)}{pageCtx.title.length > 40 ? "…" : ""}</span>
                    {pageCtx.selectedText && <span className={styles.selChip}>selection</span>}
                </div>
            )}

            {/* Main content */}
            <main className={styles.main}>
                {view === "chat" && (
                    <MessageList messages={messages} isStreaming={isStreaming} />
                )}
                {view === "history" && (
                    <HistorySidebar
                        sessions={sessions}
                        activeId={activeSession?.id ?? null}
                        onSelect={id => { selectSession(id); setView("chat"); }}
                        onDelete={deleteSession}
                        onNew={() => { newSession(); setView("chat"); }}
                        onClose={() => setView("chat")}
                    />
                )}
                {view === "memory" && <MemoryPanel />}
            </main>

            {/* Input bar — only in chat view */}
            {view === "chat" && (
                <InputBar
                    onSend={handleSend}
                    onStop={stopStream}
                    isStreaming={isStreaming}
                    disabled={needsSetup}
                />
            )}

            {/* Bottom nav */}
            <nav className={styles.nav}>
                <button
                    className={`${styles.navBtn} ${view === "chat" ? styles.navActive : ""}`}
                    onClick={() => setView("chat")}
                >
                    <span>💬</span>
                    <span>Chat</span>
                </button>
                <button
                    className={`${styles.navBtn} ${view === "history" ? styles.navActive : ""}`}
                    onClick={() => setView("history")}
                >
                    <span>📋</span>
                    <span>History</span>
                </button>
                <button
                    className={`${styles.navBtn} ${view === "memory" ? styles.navActive : ""}`}
                    onClick={() => setView("memory")}
                >
                    <span>🧠</span>
                    <span>Memory</span>
                </button>
            </nav>

            {/* Settings sheet */}
            {showSettings && settings && (
                <SettingsPanel
                    settings={settings}
                    onSave={s => { update(s); setShowSettings(false); }}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </div>
    );
}
