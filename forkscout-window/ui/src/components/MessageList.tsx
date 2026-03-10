// components/MessageList.tsx
import { useEffect, useRef } from "react";
import type { Message } from "../types";
import styles from "./MessageList.module.css";

interface Props {
    messages: Message[];
    isStreaming: boolean;
}

/** Very lightweight markdown renderer — handles code blocks + inline code. */
function renderMarkdown(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    // Split into code blocks and normal text
    const parts = text.split(/(```[\s\S]*?```)/g);
    parts.forEach((part, i) => {
        if (part.startsWith("```")) {
            const firstLine = part.slice(3).split("\n")[0].trim();
            const lang = firstLine || "";
            const code = part.slice(3 + lang.length).replace(/^\n/, "").replace(/```$/, "");
            nodes.push(
                <div key={i} className={styles.codeBlock}>
                    {lang && <span className={styles.codeLang}>{lang}</span>}
                    <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(code)}>Copy</button>
                    <pre><code>{code}</code></pre>
                </div>
            );
        } else {
            // Inline code
            const inlineParts = part.split(/(`[^`]+`)/g);
            const rendered = inlineParts.map((ip, j) =>
                ip.startsWith("`") && ip.endsWith("`")
                    ? <code key={j} className={styles.inlineCode}>{ip.slice(1, -1)}</code>
                    : ip
            );
            // Wrap in paragraphs split by double newline
            const paragraphs = part.split(/\n\n+/);
            if (paragraphs.length > 1) {
                paragraphs.forEach((p, j) => {
                    if (!p.trim()) return;
                    const inlines = p.split(/(`[^`]+`)/g).map((x, k) =>
                        x.startsWith("`") && x.endsWith("`")
                            ? <code key={k} className={styles.inlineCode}>{x.slice(1, -1)}</code>
                            : x
                    );
                    nodes.push(<p key={`${i}-${j}`}>{inlines}</p>);
                });
            } else {
                nodes.push(<span key={i}>{rendered}</span>);
            }
        }
    });
    return nodes;
}

export function MessageList({ messages, isStreaming }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isStreaming]);

    if (messages.length === 0) {
        return (
            <div className={styles.empty}>
                <div className={styles.emptyIcon}>⚡</div>
                <p className={styles.emptyText}>Send a message to start chatting.<br />Your provider and model are set in settings.</p>
            </div>
        );
    }

    return (
        <div className={styles.list}>
            {messages.filter(m => m.role !== "system").map((msg) => (
                <div key={msg.id} className={`${styles.message} ${styles[msg.role]} ${msg.error ? styles.error : ""}`}>
                    {msg.role === "assistant" && <div className={styles.avatar}>⚡</div>}
                    <div className={styles.bubble}>
                        {msg.content
                            ? <div className={styles.content}>{renderMarkdown(msg.content)}</div>
                            : isStreaming && <span className={styles.typing}><span /><span /><span /></span>
                        }
                    </div>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
