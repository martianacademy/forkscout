"use client";

import Navbar from "@web/components/navbar";
import Link from "next/link";
import { useAuth } from "@web/lib/auth-context";
import {
  Bot,
  MessageSquare,
  Terminal,
  Globe,
  Wrench,
  Brain,
  Shield,
  Zap,
  Database,
  Search,
  Github,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Multi-Channel",
    description: "Telegram, Terminal, Web — one brain, many frontends. Same agent everywhere.",
  },
  {
    icon: Wrench,
    title: "Tool-Native",
    description: "Shell commands, web browsing, file operations, HTTP requests — real tools, not text.",
  },
  {
    icon: Brain,
    title: "Persistent Memory",
    description: "Remembers across sessions via vector embeddings and MCP memory server.",
  },
  {
    icon: Zap,
    title: "MCP-First",
    description: "Add capabilities via MCP servers with zero code changes — JSON config only.",
  },
  {
    icon: Shield,
    title: "Provider-Agnostic",
    description: "9 LLM providers, swap models by editing one config field. No vendor lock-in.",
  },
  {
    icon: Database,
    title: "Config-Driven",
    description: "Identity, behavior, model selection — all from forkscout.config.json. Hot-reloads.",
  },
  {
    icon: Globe,
    title: "Web Browsing",
    description: "Full browser automation with screenshots, navigation, form filling, and data extraction.",
  },
  {
    icon: Search,
    title: "Semantic Search",
    description: "Vector-embedded chat history. Agent searches past conversations when it needs context.",
  },
];

const CHANNELS = [
  { icon: MessageSquare, name: "Telegram", desc: "Primary channel • live streaming • rich media" },
  { icon: Terminal, name: "Terminal", desc: "Local CLI • live token streaming • readline" },
  { icon: Globe, name: "Web", desc: "Browser chat • SSE streaming • dashboard" },
];

const PROVIDERS = [
  "OpenRouter", "Anthropic", "Google", "xAI", "Vercel",
  "Replicate", "HuggingFace", "DeepSeek", "Perplexity",
];

export default function Home() {
  const { tokenParam } = useAuth();

  return (
    <>
      <Navbar />
      <main className="min-h-screen">
        {/* Hero */}
        <section className="relative overflow-hidden pt-32 pb-20">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#10b98115_0%,transparent_60%)]" />
          <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
              <Bot className="h-4 w-4 text-accent" />
              <span>Autonomous AI Agent</span>
            </div>
            <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-7xl">
              <span className="gradient-text">ForkScout</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Multi-channel AI agent with real tools, persistent memory, and autonomous task execution.
              One brain — Telegram, Terminal, and Web.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href={`/chat${tokenParam}`}
                className="glow inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-all hover:brightness-110"
              >
                <MessageSquare className="h-4 w-4" />
                Try Chat
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/marsnext/forkscout"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:bg-muted"
              >
                <Github className="h-4 w-4" />
                View Source
              </a>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
              Built for <span className="gradient-text">autonomy</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-muted-foreground">
              Not just a chatbot — an agent that thinks, uses tools, browses the web, and remembers.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5"
                >
                  <Icon className="mb-3 h-8 w-8 text-accent transition-transform group-hover:scale-110" />
                  <h3 className="mb-2 text-base font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Channels */}
        <section className="border-t border-border/50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <h2 className="mb-4 text-center text-3xl font-bold sm:text-4xl">
              One agent, <span className="gradient-text">every channel</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-center text-muted-foreground">
              Same brain, same tools, same memory — different interfaces for different contexts.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {CHANNELS.map(({ icon: Icon, name, desc }) => (
                <div
                  key={name}
                  className="flex flex-col items-center rounded-xl border border-border bg-card p-8 text-center transition-all hover:border-accent/30"
                >
                  <Icon className="mb-4 h-10 w-10 text-accent" />
                  <h3 className="mb-1 text-lg font-semibold">{name}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Providers */}
        <section className="border-t border-border/50 py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              <span className="gradient-text">9 providers</span>, zero lock-in
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
              Switch models by changing one line in config. All providers work with the same tools and memory.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {PROVIDERS.map((p) => (
                <span
                  key={p}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-accent/30 hover:text-foreground"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Quick start */}
        <section className="border-t border-border/50 py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="mb-8 text-center text-3xl font-bold sm:text-4xl">
              Get started in <span className="gradient-text">30 seconds</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
                <Terminal className="h-4 w-4" />
                Terminal
              </div>
              <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed">
                <code className="text-green-400">
                  {`# Clone & install
git clone https://github.com/marsnext/forkscout.git
cd forkscout && bun install

# Configure (add API keys)
cp .env.example .env && nano .env

# Run
bun start        # Telegram (default)
bun run cli      # Terminal
bun run dev      # Hot reload`}
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/50 py-8">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-sm text-muted-foreground sm:px-6">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-accent" />
              <span>ForkScout v3.0.0</span>
            </div>
            <a
              href="https://github.com/marsnext/forkscout"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}
