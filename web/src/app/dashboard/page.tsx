"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@web/components/navbar";
import { useAuth } from "@web/lib/auth-context";
import { SignInButton } from "@clerk/nextjs";
import { AGENT_URL, getHealth, type HealthResponse } from "@web/lib/api";
import {
    Activity,
    Clock,
    Cpu,
    HardDrive,
    RefreshCw,
    Wifi,
    WifiOff,
    Users,
    MessageSquare,
    Wrench,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Bot,
    ShieldAlert,
} from "lucide-react";

function StatCard({
    icon: Icon,
    label,
    value,
    subtext,
    color = "text-accent",
}: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    subtext?: string;
    color?: string;
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-5 transition-all hover:border-accent/20">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className="text-2xl font-bold">{value}</div>
            {subtext && <div className="mt-1 text-xs text-muted-foreground">{subtext}</div>}
        </div>
    );
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export default function DashboardPage() {
    const { isAuthenticated, isLoaded } = useAuth();
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [isOnline, setIsOnline] = useState(false);
    const [lastCheck, setLastCheck] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);

    const checkHealth = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const data = await getHealth(AbortSignal.timeout(5000));
            setHealth(data);
            setIsOnline(true);
        } catch {
            setIsOnline(false);
            setHealth(null);
        } finally {
            setLastCheck(new Date());
            setIsRefreshing(false);
        }
    }, []);

    // Poll health every 10s
    useEffect(() => {
        checkHealth();
        const interval = setInterval(checkHealth, 10_000);
        return () => clearInterval(interval);
    }, [checkHealth]);

    // Fetch recent logs
    useEffect(() => {
        if (!isAuthenticated) return;
        async function fetchLogs() {
            try {
                const res = await fetch(`${AGENT_URL}/logs?limit=50`, {
                    cache: "no-store",
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) {
                    const data = await res.json();
                    setLogs(Array.isArray(data) ? data.map(String) : []);
                }
            } catch {
                // Logs endpoint may not exist yet
            }
        }
        fetchLogs();
        const interval = setInterval(fetchLogs, 15_000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    // Loading state
    if (!isLoaded) {
        return (
            <>
                <Navbar />
                <div className="flex h-screen items-center justify-center pt-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
            </>
        );
    }

    // Gate: not signed in
    if (!isAuthenticated) {
        return (
            <>
                <Navbar />
                <div className="flex h-screen items-center justify-center pt-16">
                    <div className="text-center">
                        <ShieldAlert className="mx-auto mb-4 h-16 w-16 text-destructive/50" />
                        <h2 className="mb-2 text-xl font-semibold">Sign in required</h2>
                        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                            Sign in to access the dashboard.
                        </p>
                        <SignInButton mode="modal">
                            <button className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-all hover:brightness-110">
                                Sign In
                            </button>
                        </SignInButton>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Navbar />
            <main className="min-h-screen pt-16">
                <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                    {/* Header */}
                    <div className="mb-8 flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold sm:text-3xl">Dashboard</h1>
                            <p className="text-sm text-muted-foreground">
                                Monitor and manage your ForkScout agent
                            </p>
                        </div>
                        <button
                            onClick={checkHealth}
                            disabled={isRefreshing}
                            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                            />
                            Refresh
                        </button>
                    </div>

                    {/* Status banner */}
                    <div
                        className={`mb-6 flex items-center gap-3 rounded-xl border p-4 ${isOnline
                            ? "border-accent/30 bg-accent/5"
                            : "border-destructive/30 bg-destructive/5"
                            }`}
                    >
                        {isOnline ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 text-accent" />
                                <div>
                                    <div className="text-sm font-semibold text-accent">Agent Online</div>
                                    <div className="text-xs text-muted-foreground">
                                        Connected to {AGENT_URL}
                                        {lastCheck && ` • Last checked ${lastCheck.toLocaleTimeString()}`}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <XCircle className="h-5 w-5 text-destructive" />
                                <div>
                                    <div className="text-sm font-semibold text-destructive">Agent Offline</div>
                                    <div className="text-xs text-muted-foreground">
                                        Cannot reach {AGENT_URL}
                                        {lastCheck && ` • Last checked ${lastCheck.toLocaleTimeString()}`}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Stats grid */}
                    <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard
                            icon={isOnline ? Wifi : WifiOff}
                            label="Status"
                            value={isOnline ? "Online" : "Offline"}
                            subtext={health?.status ?? "Unknown"}
                            color={isOnline ? "text-accent" : "text-destructive"}
                        />
                        <StatCard
                            icon={Clock}
                            label="Uptime"
                            value={health?.uptime ? formatUptime(health.uptime as number) : "—"}
                            subtext="Since last restart"
                        />
                        <StatCard
                            icon={Bot}
                            label="Version"
                            value={typeof health?.version === "string" ? health.version : "—"}
                            subtext="ForkScout Agent"
                        />
                        <StatCard
                            icon={Activity}
                            label="Health"
                            value={isOnline ? "Healthy" : "Unreachable"}
                            subtext={`Port ${new URL(AGENT_URL).port || "3200"}`}
                        />
                    </div>

                    {/* Two columns: config + logs */}
                    <div className="grid gap-6 lg:grid-cols-2">
                        {/* Quick info */}
                        <div className="rounded-xl border border-border bg-card">
                            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                                <Cpu className="h-4 w-4 text-accent" />
                                <h2 className="text-sm font-semibold">Agent Info</h2>
                            </div>
                            <div className="divide-y divide-border">
                                {[
                                    { label: "API Endpoint", value: AGENT_URL },
                                    { label: "Health Endpoint", value: `${AGENT_URL}/health` },
                                    { label: "Trigger Endpoint", value: `${AGENT_URL}/trigger` },
                                    {
                                        label: "Connection",
                                        value: isOnline ? "✅ Connected" : "❌ Disconnected",
                                    },
                                ].map(({ label, value }) => (
                                    <div key={label} className="flex items-center justify-between px-5 py-3">
                                        <span className="text-sm text-muted-foreground">{label}</span>
                                        <span className="text-sm font-mono">{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Activity log */}
                        <div className="rounded-xl border border-border bg-card">
                            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                                <HardDrive className="h-4 w-4 text-accent" />
                                <h2 className="text-sm font-semibold">Recent Activity</h2>
                            </div>
                            <div className="max-h-80 overflow-y-auto p-4">
                                {logs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                                        <AlertTriangle className="mb-2 h-8 w-8 text-muted-foreground/30" />
                                        <p className="text-sm">No activity logs available</p>
                                        <p className="text-xs text-muted-foreground/50">
                                            Logs will appear here when the agent is active
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-1 font-mono text-xs">
                                        {logs.map((line, i) => (
                                            <div
                                                key={i}
                                                className="rounded px-2 py-1 text-muted-foreground hover:bg-muted/50"
                                            >
                                                {line}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Setup instructions */}
                    {!isOnline && (
                        <div className="mt-8 rounded-xl border border-border bg-card p-6">
                            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                Agent Not Running
                            </h3>
                            <p className="mb-4 text-sm text-muted-foreground">
                                The dashboard needs the agent&apos;s HTTP server to be running. Start it with:
                            </p>
                            <pre className="overflow-x-auto rounded-lg bg-background p-4 font-mono text-sm text-green-400">
                                {`cd forkscout-agent
bun start          # Starts agent with HTTP server on port 3200`}
                            </pre>
                            <p className="mt-3 text-xs text-muted-foreground">
                                The agent&apos;s HTTP server runs on port 3200 by default.
                                Set <code className="rounded bg-muted px-1.5 py-0.5">NEXT_PUBLIC_AGENT_URL</code> in{" "}
                                <code className="rounded bg-muted px-1.5 py-0.5">web/.env.local</code> if using a different address.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </>
    );
}
