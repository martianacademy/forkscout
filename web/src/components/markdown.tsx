"use client";

import { memo, useState, useCallback } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

/* ── Copy button for code blocks ────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const copy = useCallback(() => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [text]);

    return (
        <button
            onClick={copy}
            className="absolute right-2 top-2 rounded-md bg-zinc-700/60 p-1.5 text-zinc-400 opacity-0 backdrop-blur transition-all hover:bg-zinc-600/80 hover:text-zinc-200 group-hover:opacity-100"
            aria-label="Copy code"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

/* ── Component overrides ────────────────────────────────────────────────── */

const components: Components = {
    // Fenced code blocks: ```lang ... ```
    pre({ children, ...props }) {
        // Extract raw text for copy button
        const codeEl = children as React.ReactElement<{ children?: React.ReactNode }>;
        let raw = "";
        try {
            const extractText = (node: unknown): string => {
                if (typeof node === "string") return node;
                if (Array.isArray(node)) return node.map(extractText).join("");
                if (node && typeof node === "object" && "props" in (node as Record<string, unknown>)) {
                    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
                }
                return "";
            };
            raw = extractText(codeEl?.props?.children ?? "");
        } catch { /* ignore */ }

        return (
            <div className="group relative my-3">
                <CopyButton text={raw} />
                <pre
                    className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-[13px] leading-relaxed"
                    {...props}
                >
                    {children}
                </pre>
            </div>
        );
    },

    // Inline code: `code`
    code({ children, className, ...props }) {
        // If className has "hljs" it's inside a <pre> — let rehype-highlight handle it
        if (className?.includes("hljs") || className?.includes("language-")) {
            return <code className={className} {...props}>{children}</code>;
        }
        return (
            <code
                className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[13px] text-emerald-400 font-mono"
                {...props}
            >
                {children}
            </code>
        );
    },

    // Links
    a({ children, href, ...props }) {
        return (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline decoration-emerald-400/30 underline-offset-2 hover:decoration-emerald-400/60 transition-colors"
                {...props}
            >
                {children}
            </a>
        );
    },

    // Paragraphs
    p({ children }) {
        return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
    },

    // Lists
    ul({ children }) {
        return <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>;
    },
    ol({ children }) {
        return <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>;
    },
    li({ children }) {
        return <li className="leading-relaxed">{children}</li>;
    },

    // Headings
    h1({ children }) {
        return <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0">{children}</h1>;
    },
    h2({ children }) {
        return <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h2>;
    },
    h3({ children }) {
        return <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>;
    },

    // Blockquote
    blockquote({ children }) {
        return (
            <blockquote className="my-3 border-l-2 border-emerald-500/40 pl-4 italic text-zinc-400">
                {children}
            </blockquote>
        );
    },

    // Horizontal rule
    hr() {
        return <hr className="my-4 border-zinc-800" />;
    },

    // Tables
    table({ children }) {
        return (
            <div className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-sm">{children}</table>
            </div>
        );
    },
    thead({ children }) {
        return <thead className="bg-zinc-800/50">{children}</thead>;
    },
    th({ children }) {
        return <th className="px-3 py-2 text-left font-medium text-zinc-300">{children}</th>;
    },
    td({ children }) {
        return <td className="border-t border-zinc-800/50 px-3 py-2">{children}</td>;
    },

    // Strong / em
    strong({ children }) {
        return <strong className="font-semibold text-zinc-100">{children}</strong>;
    },
};

/* ── Main component ─────────────────────────────────────────────────────── */

function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="markdown-body text-sm text-zinc-300">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={components}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

export default memo(MarkdownContent);
