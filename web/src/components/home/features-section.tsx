"use client";

import { motion } from "framer-motion";
import {
    Terminal, Brain, Plug, Shield, RefreshCw,
    MessageSquare, Search, FileCode, Globe,
} from "lucide-react";

const features = [
    { icon: Terminal, title: "Real Shell Access", desc: "Execute any command, install packages, manage servers — not a sandbox.", color: "purple", span: "lg:col-span-2 lg:row-span-1" },
    { icon: Brain, title: "Persistent Memory", desc: "Remembers facts, decisions, and conversations across restarts.", color: "cyan", span: "lg:row-span-2" },
    { icon: Plug, title: "MCP-First", desc: "Add capabilities via JSON config. Drop a file, tool is live.", color: "pink", span: "" },
    { icon: Shield, title: "Provider-Agnostic", desc: "Swap between 9 LLM providers by changing one JSON field.", color: "blue", span: "" },
    { icon: RefreshCw, title: "Self-Modifying", desc: "Edits its own source, typechecks, and restarts itself.", color: "violet", span: "" },
    { icon: MessageSquare, title: "Multi-Channel", desc: "Same agent brain on Telegram, terminal, WhatsApp, and web.", color: "emerald", span: "lg:col-span-2" },
    { icon: Search, title: "Web Search & Browse", desc: "Self-hosted SearXNG search and full webpage content extraction.", color: "amber", span: "" },
    { icon: FileCode, title: "File Read & Write", desc: "Reads files in chunks, writes with directory creation.", color: "rose", span: "" },
    { icon: Globe, title: "Task Orchestration", desc: "Parallel workers, sequential chains, live progress — all autonomous.", color: "teal", span: "" },
];

type ColorDef = { icon: string; bg: string; ring: string; glow: string; border: string };

const colors: Record<string, ColorDef> = {
    purple: { icon: "text-purple-500 dark:text-purple-400", bg: "bg-purple-500/10", ring: "group-hover:ring-purple-500/30", glow: "group-hover:shadow-purple-500/10", border: "group-hover:border-purple-500/30" },
    cyan: { icon: "text-cyan-500 dark:text-cyan-400", bg: "bg-cyan-500/10", ring: "group-hover:ring-cyan-500/30", glow: "group-hover:shadow-cyan-500/10", border: "group-hover:border-cyan-500/30" },
    pink: { icon: "text-pink-500 dark:text-pink-400", bg: "bg-pink-500/10", ring: "group-hover:ring-pink-500/30", glow: "group-hover:shadow-pink-500/10", border: "group-hover:border-pink-500/30" },
    blue: { icon: "text-blue-500 dark:text-blue-400", bg: "bg-blue-500/10", ring: "group-hover:ring-blue-500/30", glow: "group-hover:shadow-blue-500/10", border: "group-hover:border-blue-500/30" },
    violet: { icon: "text-violet-500 dark:text-violet-400", bg: "bg-violet-500/10", ring: "group-hover:ring-violet-500/30", glow: "group-hover:shadow-violet-500/10", border: "group-hover:border-violet-500/30" },
    emerald: { icon: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-500/10", ring: "group-hover:ring-emerald-500/30", glow: "group-hover:shadow-emerald-500/10", border: "group-hover:border-emerald-500/30" },
    amber: { icon: "text-amber-500 dark:text-amber-400", bg: "bg-amber-500/10", ring: "group-hover:ring-amber-500/30", glow: "group-hover:shadow-amber-500/10", border: "group-hover:border-amber-500/30" },
    rose: { icon: "text-rose-500 dark:text-rose-400", bg: "bg-rose-500/10", ring: "group-hover:ring-rose-500/30", glow: "group-hover:shadow-rose-500/10", border: "group-hover:border-rose-500/30" },
    teal: { icon: "text-teal-500 dark:text-teal-400", bg: "bg-teal-500/10", ring: "group-hover:ring-teal-500/30", glow: "group-hover:shadow-teal-500/10", border: "group-hover:border-teal-500/30" },
};



export function FeaturesSection() {
    return (
        <section id="features" className="relative mx-auto max-w-6xl px-4 py-28 sm:px-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="mb-16 text-center"
            >
                <span className="mb-4 inline-block rounded-full border border-purple-500/20 bg-purple-500/5 px-4 py-1.5 text-xs font-medium tracking-wider text-purple-600 uppercase dark:border-purple-400/20 dark:text-purple-400">
                    Capabilities
                </span>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                    Built for{" "}
                    <span className="bg-linear-to-r from-purple-600 via-cyan-500 to-pink-500 bg-clip-text text-transparent dark:from-purple-400 dark:via-cyan-400 dark:to-pink-400">real autonomy</span>
                </h2>
                <p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground sm:text-lg">Every capability is a callable tool — not generated text.</p>
            </motion.div>

            {/* Bento grid */}
            <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {features.map((f) => <BentoCard key={f.title} feature={f} />)}
            </div>
        </section>
    );
}

function BentoCard({ feature: f }: { feature: typeof features[0] }) {
    const c = colors[f.color];
    return (
        <motion.div whileHover={{ y: -4, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={`group ${f.span}`}>
            <motion.div whileHover={{ y: -4, scale: 1.01 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="relative h-full overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-6 ring-1 ring-transparent transition-colors duration-300 hover:shadow-2xl sm:bg-card/40 sm:backdrop-blur-md">
                {/* Animated gradient border on hover */}
                <div className={`pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${c.ring}`}
                    style={{ background: "linear-gradient(135deg, transparent, transparent)" }} />

                {/* Corner glow */}
                <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
                    <div className={`absolute -right-8 -top-8 h-40 w-40 rounded-full ${c.bg} blur-3xl`} />
                    <div className={`absolute -bottom-8 -left-8 h-24 w-24 rounded-full ${c.bg} blur-2xl`} />
                </div>

                <div className="relative z-10 flex h-full flex-col">
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} ring-1 ring-white/10 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg`}>
                        <f.icon className={`h-6 w-6 ${c.icon}`} />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold tracking-tight">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </div>

                {/* Bottom accent — animated width */}
                <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-linear-to-r from-transparent via-current to-transparent transition-all duration-700 group-hover:w-full">
                    <div className={`h-full w-full ${c.bg.replace("/10", "/60")}`} />
                </div>
            </motion.div>
        </motion.div>
    );
}
