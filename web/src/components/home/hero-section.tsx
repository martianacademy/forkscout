"use client";

import { useState } from "react";
import { motion, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Github, Terminal, Copy, Check, Sparkles } from "lucide-react";
import { ForkScoutLogo } from "@/components/forkscout-logo";
import { RotatingText } from "./rotating-text";

const container: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1 },
    },
};

const child: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: {
        opacity: 1, y: 0,
        transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
    },
};

export function HeroSection() {
    return (
        <section id="hero" className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-4 text-center sm:px-6">
            {/* Colorful gradient orbs */}
            <motion.div
                className="pointer-events-none absolute -top-40 left-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-linear-to-br from-purple-500/20 via-cyan-500/10 to-transparent blur-3xl sm:h-125 sm:w-125"
                animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="pointer-events-none absolute -bottom-40 right-1/4 h-56 w-56 rounded-full bg-linear-to-tl from-pink-500/15 via-violet-500/10 to-transparent blur-3xl sm:h-100 sm:w-100"
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            />

            <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-5"
            >
                <motion.div variants={child}>
                    <ForkScoutLogo size={80} className="drop-shadow-[0_0_16px_rgba(168,85,247,0.4)]" />
                </motion.div>

                <motion.div variants={child}>
                    <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 bg-purple-500/5 px-4 py-1.5 text-xs font-medium tracking-wider text-purple-600 uppercase dark:border-purple-400/20 dark:text-purple-400">
                        <Sparkles className="h-3 w-3" />
                        Open Source &middot; Self-Hosted &middot; Autonomous
                    </span>
                </motion.div>

                <motion.h1
                    variants={child}
                    className="text-5xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
                >
                    Meet{" "}
                    <span className="bg-linear-to-r from-purple-500 via-cyan-400 to-pink-500 bg-clip-text text-transparent dark:from-purple-400 dark:via-cyan-300 dark:to-pink-400">
                        ForkScout
                    </span>
                </motion.h1>

                <motion.div variants={child}>
                    <RotatingText />
                </motion.div>

                <motion.p
                    variants={child}
                    className="max-w-xl leading-relaxed text-muted-foreground sm:text-xl"
                >
                    An autonomous AI agent that runs shell commands, browses the web,
                    reads and writes files, remembers everything, and modifies its own
                    code. Not a chatbot wrapper — a real agent.
                </motion.p>

                <motion.div
                    variants={child}
                    className="flex flex-row gap-3"
                >
                    <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                        <Button size="lg" className="gap-2 bg-linear-to-r from-purple-600 to-cyan-500 px-6 text-white shadow-lg shadow-purple-500/20 hover:from-purple-500 hover:to-cyan-400 dark:shadow-purple-500/10" asChild>
                            <a
                                href="https://github.com/Forkscout/forkscout"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Get Started <ArrowRight className="h-4 w-4" />
                            </a>
                        </Button>
                    </motion.div>

                    <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                        <Button size="lg" variant="outline" className="gap-2 border-purple-500/20 px-6 hover:border-purple-500/40 hover:bg-purple-500/5" asChild>
                            <a
                                href="https://github.com/Forkscout/forkscout"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Github className="h-4 w-4" /> GitHub
                            </a>
                        </Button>
                    </motion.div>
                </motion.div>

                <InstallBlock />
            </motion.div>
        </section>
    );
}

const installMethods = [
    {
        label: "Install Anywhere",
        command: "curl -fsSL https://raw.githubusercontent.com/Forkscout/forkscout/main/install.sh | bash",
    },
    {
        label: "Docker",
        command: "docker run -d --name forkscout ghcr.io/forkscout/forkscout:latest",
    },
];

function InstallBlock() {
    const [tab, setTab] = useState(0);
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        await navigator.clipboard.writeText(installMethods[tab].command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <motion.div variants={child} className="mt-4 w-full max-w-xl px-0">
            {/* Tabs */}
            <div className="flex gap-1 rounded-t-lg border border-purple-500/15 border-b-0 bg-card/60 px-2 pt-2 backdrop-blur-sm">
                {installMethods.map((m, i) => (
                    <button
                        key={m.label}
                        onClick={() => { setTab(i); setCopied(false); }}
                        className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === i
                            ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* Command box */}
            <div className="flex items-center gap-2 rounded-b-lg border border-purple-500/15 bg-card/60 px-3 py-3 backdrop-blur-sm sm:px-4">
                <Terminal className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-left font-mono text-[11px] text-muted-foreground scrollbar-none sm:text-sm">
                    {installMethods[tab].command}
                </code>
                <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={copy}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    aria-label="Copy command"
                >
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </motion.button>
            </div>
        </motion.div>
    );
}
