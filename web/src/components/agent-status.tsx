"use client";

import { useState, memo, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Wrench, Brain } from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */

export interface StatusBlock {
    type: "tool" | "thinking";
    /** Tool name (for tool) or "Thinking" */
    label: string;
    /** Tool input or thinking content */
    detail: string;
    /** True when thinking is still in progress (streaming animation) */
    active?: boolean;
}

interface ParsedContent {
    /** Segments: strings are markdown text, StatusBlock objects are collapsible items */
    segments: (string | StatusBlock)[];
}

/* ── Parser ───────────────────────────────────────────────────────────── */

/**
 * Split text on status markers, keeping markers in the result.
 * Markers: {{THINKING_START}}, {{THINKING_END}}, {{TOOL:name|input}}
 */
const SPLIT_RE = /({{THINKING_START}}|{{THINKING_END}}|{{TOOL:[^}]*}})/;

/** Parse a message string into alternating text and status blocks */
export function parseAgentContent(text: string): ParsedContent {
    const segments: (string | StatusBlock)[] = [];
    const parts = text.split(SPLIT_RE);

    let inThinking = false;
    let thinkingText = "";

    for (const part of parts) {
        if (part === "{{THINKING_START}}") {
            inThinking = true;
            thinkingText = "";
        } else if (part === "{{THINKING_END}}") {
            if (inThinking) {
                // Completed thinking block — collapsible pill
                segments.push({ type: "thinking", label: "Thinking", detail: thinkingText.trim(), active: false });
                inThinking = false;
                thinkingText = "";
            }
        } else if (part.startsWith("{{TOOL:") && part.endsWith("}}")) {
            // Close any open thinking first (shouldn't happen normally, but defensive)
            if (inThinking) {
                segments.push({ type: "thinking", label: "Thinking", detail: thinkingText.trim(), active: false });
                inThinking = false;
                thinkingText = "";
            }
            const payload = part.slice(7, -2); // strip {{TOOL: and }}
            const pipe = payload.indexOf("|");
            const toolName = pipe >= 0 ? payload.slice(0, pipe) : payload;
            const input = pipe >= 0 ? payload.slice(pipe + 1) : "";
            segments.push({ type: "tool", label: toolName, detail: input });
        } else {
            // Regular text
            if (inThinking) {
                thinkingText += part;
            } else if (part.trim()) {
                segments.push(part.trim());
            }
        }
    }

    // Still in thinking at end of text — active/streaming
    if (inThinking) {
        segments.push({ type: "thinking", label: "Thinking", detail: thinkingText.trim(), active: true });
    }

    return { segments };
}

/** Check if text contains any status markers */
export function hasStatusMarkers(text: string): boolean {
    return /{{(TOOL:|THINKING_START|THINKING_END)/.test(text);
}

/* ── Active thinking container (live streaming text) ──────────────────── */

function ActiveThinking({ detail }: { detail: string }) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom as text streams in
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [detail]);

    return (
        <div className="my-2 rounded-lg border border-violet-500/20 bg-violet-500/5 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-violet-400/90 font-medium border-b border-violet-500/10">
                <Brain className="h-3 w-3 animate-spin" />
                <span>Thinking…</span>
            </div>
            <div
                ref={scrollRef}
                className="px-3 py-2 text-[11px] text-violet-300/50 leading-relaxed whitespace-pre-wrap max-h-[100px] overflow-y-auto scrollbar-thin"
            >
                {detail || <span className="opacity-50">…</span>}
                <span className="inline-block w-1.5 h-3.5 bg-violet-400/60 animate-pulse ml-0.5 align-middle rounded-sm" />
            </div>
        </div>
    );
}

/* ── Collapsible status pill (completed thinking or tool) ─────────────── */

function StatusPill({ block }: { block: StatusBlock }) {
    const [expanded, setExpanded] = useState(false);
    const isTool = block.type === "tool";

    // Active thinking — render streaming container instead of pill
    if (block.active) {
        return <ActiveThinking detail={block.detail} />;
    }

    return (
        <div className="my-1.5">
            <button
                onClick={() => block.detail ? setExpanded(!expanded) : undefined}
                className={`
                    inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium
                    transition-all duration-150 select-none
                    ${isTool
                        ? "bg-amber-500/8 text-amber-400/90 hover:bg-amber-500/15 border border-amber-500/15"
                        : "bg-violet-500/8 text-violet-400/90 hover:bg-violet-500/15 border border-violet-500/15"
                    }
                `}
            >
                {isTool
                    ? <Wrench className="h-3 w-3 shrink-0" />
                    : <Brain className="h-3 w-3 shrink-0" />
                }
                <span className="truncate max-w-[200px]">
                    {isTool ? block.label : "Thought"}
                </span>
                {block.detail && (
                    expanded
                        ? <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                        : <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                )}
            </button>

            {expanded && block.detail && (
                <div className={`
                    mt-1 ml-1 rounded-md px-3 py-2 text-[11px] leading-relaxed
                    font-mono whitespace-pre-wrap break-all
                    ${isTool
                        ? "bg-amber-500/5 text-amber-300/70 border-l-2 border-amber-500/20"
                        : "bg-violet-500/5 text-violet-300/70 border-l-2 border-violet-500/20"
                    }
                `}>
                    {block.detail}
                </div>
            )}
        </div>
    );
}

/* ── Export ────────────────────────────────────────────────────────────── */

export const AgentStatusPill = memo(StatusPill);
