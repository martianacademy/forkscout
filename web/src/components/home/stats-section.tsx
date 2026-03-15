"use client";

import { useEffect, useRef, useState } from "react";

import { Cpu, Radio, Wrench, Database, Zap, Globe } from "lucide-react";

const stats = [
    { icon: Radio, value: 20, suffix: "", label: "Channels", color: "text-cyan-400" },
    { icon: Wrench, value: 52, suffix: "+", label: "Tools", color: "text-purple-400" },
    { icon: Database, value: 9, suffix: "", label: "LLM Providers", color: "text-pink-400" },
    { icon: Cpu, value: 4, suffix: "", label: "MCP Servers", color: "text-amber-400" },
    { icon: Zap, value: 200, suffix: "ms", label: "Avg Response", color: "text-emerald-400" },
    { icon: Globe, value: 100, suffix: "%", label: "Self-Hosted", color: "text-violet-400" },
];

function useCountUp(end: number, started: boolean, duration = 1500) {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!started) return;
        let frame: number;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
            setCount(Math.round(ease * end));
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [end, started, duration]);
    return count;
}

function StatCard({ stat }: { stat: typeof stats[0] }) {
    const [started, setStarted] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const count = useCountUp(stat.value, started);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStarted(true); }, { threshold: 0.5 });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className="group relative flex flex-col items-center gap-2 rounded-2xl border border-border/30 bg-card/80 px-4 py-6 transition-colors duration-300 hover:border-border/50 hover:bg-card sm:bg-card/30 sm:backdrop-blur-sm"
        >
            <stat.icon className={`h-5 w-5 ${stat.color} opacity-60 transition-opacity group-hover:opacity-100`} />
            <span className={`text-3xl font-bold tabular-nums tracking-tight ${stat.color}`}>
                {count}{stat.suffix}
            </span>
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{stat.label}</span>
        </div>
    );
}

export function StatsSection() {
    return (
        <section className="relative mx-auto max-w-4xl px-4 py-16 sm:px-6">
            {/* Gradient divider */}
            <div className="mb-16 h-px bg-linear-to-r from-transparent via-purple-500/20 to-transparent" />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {stats.map((s) => <StatCard key={s.label} stat={s} />)}
            </div>

            <div className="mt-16 h-px bg-linear-to-r from-transparent via-cyan-500/20 to-transparent" />
        </section>
    );
}
