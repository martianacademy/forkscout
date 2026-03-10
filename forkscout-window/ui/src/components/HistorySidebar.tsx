// components/HistorySidebar.tsx — Chat session history panel
import type { ChatSession } from "../types";
import styles from "./HistorySidebar.module.css";

interface Props {
    sessions: ChatSession[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onNew: () => void;
    onClose: () => void;
}

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function HistorySidebar({ sessions, activeId, onSelect, onDelete, onNew, onClose }: Props) {
    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <h2 className={styles.title}>Chat history</h2>
                <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
            </div>

            <button className={styles.newBtn} onClick={() => { onNew(); onClose(); }}>
                + New chat
            </button>

            {sessions.length === 0 ? (
                <p className={styles.empty}>No chats yet. Start one!</p>
            ) : (
                <ul className={styles.list}>
                    {sessions.map(s => (
                        <li
                            key={s.id}
                            className={`${styles.item} ${s.id === activeId ? styles.active : ""}`}
                            onClick={() => { onSelect(s.id); onClose(); }}
                        >
                            <div className={styles.itemContent}>
                                <span className={styles.itemTitle}>{s.title}</span>
                                <div className={styles.itemMeta}>
                                    <span className={styles.itemProvider}>{s.provider}/{s.model.split("/").pop()}</span>
                                    <span className={styles.itemTime}>{relativeTime(s.updatedAt)}</span>
                                </div>
                            </div>
                            <button
                                className={styles.deleteBtn}
                                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                                aria-label="Delete"
                            >✕</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
