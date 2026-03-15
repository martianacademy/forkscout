"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Clock, Cpu, Server, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { fetchHealth, apiFetch } from "@/lib/api-client";

interface Health { ok: boolean; status: string; uptime: number; version: string; timestamp: string; }
interface ConfigData { identity?: { name?: string }; llm?: { provider?: string; tier?: string }; }

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
}

export default function DashboardPage() {
    const [health, setHealth] = useState<Health | null>(null);
    const [config, setConfig] = useState<ConfigData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const [h, c] = await Promise.all([
                fetchHealth(),
                apiFetch<ConfigData>("/api/config"),
            ]);
            setHealth(h);
            setConfig(c);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to connect");
        }
        setLoading(false);
    };

    useEffect(() => {
        const timer = setTimeout(() => load(), 0);
        const i = setInterval(load, 15000);
        return () => { clearTimeout(timer); clearInterval(i); };
    }, []);

    const cards = [
        {
            title: "Status", icon: health?.ok ? Wifi : WifiOff,
            value: health?.ok ? "Healthy" : "Offline",
            sub: health?.timestamp ? `Last check: ${new Date(health.timestamp).toLocaleTimeString()}` : "",
            color: health?.ok ? "text-emerald-500" : "text-red-500",
        },
        {
            title: "Uptime", icon: Clock,
            value: health ? formatUptime(health.uptime) : "—",
            sub: `Version ${health?.version ?? "—"}`,
            color: "text-cyan-500",
        },
        {
            title: "Provider", icon: Cpu,
            value: config?.llm?.provider ?? "—",
            sub: `Tier: ${config?.llm?.tier ?? "—"}`,
            color: "text-purple-500",
        },
        {
            title: "Agent", icon: Server,
            value: config?.identity?.name ?? "ForkScout",
            sub: "Autonomous AI Agent",
            color: "text-amber-500",
        },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-sm text-muted-foreground">Agent overview and health status</p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
                </Button>
            </div>

            {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                </motion.div>
            )}

            {/* Stats grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((c, i) => (
                    <motion.div key={c.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08, duration: 0.4 }}>
                        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                                <c.icon className={`h-4 w-4 ${c.color}`} />
                            </CardHeader>
                            <CardContent>
                                {loading ? <Skeleton className="h-7 w-24" /> : (
                                    <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                                )}
                                <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* Quick info */}
            <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="h-4 w-4 text-purple-500" /> Quick Info
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">20 Channels</Badge>
                        <Badge variant="secondary">52+ Tools</Badge>
                        <Badge variant="secondary">9 Providers</Badge>
                        <Badge variant="secondary">4 MCP Servers</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Use the <strong>Chat</strong> tab to talk to your agent, <strong>Settings</strong> to edit config,
                        and <strong>Env &amp; Secrets</strong> to manage API keys.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
