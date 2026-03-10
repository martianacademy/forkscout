// components/InputBar.tsx
import { useState, useRef, useCallback } from "react";
import styles from "./InputBar.module.css";

interface Props {
    onSend: (text: string) => void;
    onStop: () => void;
    isStreaming: boolean;
    disabled?: boolean;
    placeholder?: string;
}

export function InputBar({ onSend, onStop, isStreaming, disabled, placeholder }: Props) {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const submit = useCallback(() => {
        const text = value.trim();
        if (!text || isStreaming) return;
        onSend(text);
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    }, [value, isStreaming, onSend]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    };

    const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    };

    return (
        <div className={styles.bar}>
            <textarea
                ref={textareaRef}
                className={styles.input}
                placeholder={placeholder ?? "Message Forkscout\u2026 (Enter to send, Shift+Enter for newline)"}
                value={value}
                onChange={onInput}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={disabled || isStreaming}
            />
            <button
                className={`${styles.btn} ${isStreaming ? styles.stop : styles.send}`}
                onClick={isStreaming ? onStop : submit}
                disabled={!isStreaming && !value.trim()}
                aria-label={isStreaming ? "Stop" : "Send"}
            >
                {isStreaming ? "\u25a0" : "\u2191"}
            </button>
        </div>
    );
}
