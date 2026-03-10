// components/MemoryPanel.tsx — Persistent memory management
import { useState, useEffect, useCallback } from "react";
import type { Memory } from "../types";
import { loadMemories, addMemory, deleteMemory, updateMemory } from "../store/storage";
import styles from "./MemoryPanel.module.css";

export function MemoryPanel() {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [input, setInput] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");

    const refresh = useCallback(async () => {
        setMemories(await loadMemories());
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const handleAdd = async () => {
        const text = input.trim();
        if (!text) return;
        await addMemory(text, "user");
        setInput("");
        refresh();
    };

    const handleDelete = async (id: string) => {
        await deleteMemory(id);
        refresh();
    };

    const startEdit = (m: Memory) => {
        setEditingId(m.id);
        setEditValue(m.content);
    };

    const saveEdit = async () => {
        if (!editingId) return;
        await updateMemory(editingId, editValue);
        setEditingId(null);
        refresh();
    };

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <h2 className={styles.title}>Memories</h2>
                <span className={styles.count}>{memories.length} saved</span>
            </div>
            <p className={styles.desc}>
                Memories are injected into every conversation when enabled in settings.
            </p>

            <div className={styles.addRow}>
                <textarea
                    className={styles.addInput}
                    placeholder="Add a memory (e.g. 'I prefer TypeScript over JavaScript')"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    rows={2}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
                />
                <button className={styles.addBtn} onClick={handleAdd} disabled={!input.trim()}>
                    Add
                </button>
            </div>

            {memories.length === 0 ? (
                <p className={styles.empty}>No memories yet. Add things you want the AI to always know.</p>
            ) : (
                <ul className={styles.list}>
                    {memories.map(m => (
                        <li key={m.id} className={styles.item}>
                            {editingId === m.id ? (
                                <div className={styles.editRow}>
                                    <textarea
                                        className={styles.editInput}
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                        rows={2}
                                        autoFocus
                                    />
                                    <div className={styles.editActions}>
                                        <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
                                        <button className={styles.cancelBtn} onClick={() => setEditingId(null)}>Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <p className={styles.content}>{m.content}</p>
                                    <div className={styles.itemActions}>
                                        <span className={styles.badge}>{m.source ?? "user"}</span>
                                        <button className={styles.editBtn} onClick={() => startEdit(m)}>Edit</button>
                                        <button className={styles.deleteBtn} onClick={() => handleDelete(m.id)}>✕</button>
                                    </div>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
