"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Section,
    Field,
    NumberField,
    ChipList,
    AddItemForm,
} from "@web/components/settings-fields";
import { useAuth } from "@web/lib/auth-context";
import { AGENT_URL } from "@web/lib/api";
import {
    MessageCircle,
    RefreshCw,
    Shield,
    Trash2,
    Users,
    Wifi,
    WifiOff,
} from "lucide-react";
import { PairingCodeDisplay, QrCodeDisplay, ConnectOptions } from "@web/components/whatsapp-connection-ui";

type Config = Record<string, any>;

interface Props {
    config: Config;
    updateField: (path: string[], value: unknown) => void;
    get: (path: string[]) => unknown;
}

interface WhatsAppStatus {
    connected: boolean;
    started?: boolean;
    qr?: string;
    jid?: string;
    pairingCode?: string;
}

export default function WhatsAppSettings({ config, updateField, get }: Props) {
    const { token } = useAuth();
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState("");

    const ownerJids: string[] = (get(["whatsapp", "ownerJids"]) as string[]) ?? [];
    const allowedJids: string[] = (get(["whatsapp", "allowedJids"]) as string[]) ?? [];

    const fetchStatus = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await fetch(`${AGENT_URL}/api/whatsapp/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setStatus(await res.json());
        } catch {
            /* ignore — channel may not be running */
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        fetchStatus();
        const iv = setInterval(fetchStatus, 8000); // poll every 8s
        return () => clearInterval(iv);
    }, [fetchStatus]);

    const handleDeleteSession = async () => {
        if (!token) return;
        setDeleting(true);
        try {
            await fetch(`${AGENT_URL}/api/whatsapp/session`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setConfirmDelete(false);
            await fetchStatus();
        } catch { /* ignore */ } finally {
            setDeleting(false);
        }
    };

    const handleConnect = async (usePairingCode: boolean) => {
        if (!token) return;
        if (usePairingCode && !phoneNumber.trim()) return;
        setConnecting(true);
        try {
            const body = usePairingCode
                ? JSON.stringify({ phoneNumber: phoneNumber.trim() })
                : undefined;
            await fetch(`${AGENT_URL}/api/whatsapp/connect`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(body ? { "Content-Type": "application/json" } : {}),
                },
                body,
            });
            // Poll quickly to catch the QR or pairing code
            for (let i = 0; i < 8; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                await fetchStatus();
                if (status?.qr || status?.connected || status?.pairingCode) break;
            }
        } catch { /* ignore */ } finally {
            setConnecting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Connection Status */}
            <Section
                title="Connection"
                icon={status?.connected ? Wifi : WifiOff}
                actions={
                    <button
                        onClick={fetchStatus}
                        disabled={loading}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </button>
                }
            >
                {status?.connected ? (
                    /* ── Connected ────────────────────────────── */
                    <div className="flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 p-4">
                        <Wifi className="h-5 w-5 text-accent" />
                        <div>
                            <p className="text-sm font-medium">Connected</p>
                            {status.jid && (
                                <p className="font-mono text-xs text-muted-foreground">{status.jid}</p>
                            )}
                        </div>
                    </div>
                ) : status?.pairingCode ? (
                    /* ── Pairing Code Display ────────────────── */
                    <PairingCodeDisplay code={status.pairingCode} />
                ) : status?.qr ? (
                    /* ── QR Code Display ──────────────────────── */
                    <QrCodeDisplay qr={status.qr} />
                ) : (
                    /* ── Not Connected — show connect options ── */
                    <ConnectOptions
                        status={status}
                        connecting={connecting}
                        phoneNumber={phoneNumber}
                        onPhoneChange={setPhoneNumber}
                        onConnect={handleConnect}
                    />
                )}

                {/* Delete session */}
                <div className="mt-4 border-t border-border pt-4">
                    {confirmDelete ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive">Delete session data? You will need to re-pair.</span>
                            <button
                                onClick={handleDeleteSession}
                                disabled={deleting}
                                className="rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                            >
                                {deleting ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                                onClick={() => setConfirmDelete(false)}
                                className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" /> Delete session & re-pair
                        </button>
                    )}
                </div>
            </Section>

            {/* Owner JIDs */}
            <Section title="Owners (Admin Access)" icon={Shield}>
                <p className="mb-3 text-xs text-muted-foreground">
                    Owner JIDs have full access including restricted tools. Format: <code className="rounded bg-muted px-1 py-0.5">phone@s.whatsapp.net</code>
                </p>
                <div className="mb-3">
                    <ChipList
                        items={ownerJids}
                        onRemove={(jid) =>
                            updateField(
                                ["whatsapp", "ownerJids"],
                                ownerJids.filter((j) => j !== jid)
                            )
                        }
                    />
                </div>
                <AddItemForm
                    placeholder="1234567890@s.whatsapp.net"
                    onAdd={(v) => {
                        if (!ownerJids.includes(v)) {
                            updateField(["whatsapp", "ownerJids"], [...ownerJids, v]);
                        }
                    }}
                />
            </Section>

            {/* Allowed JIDs */}
            <Section title="Allowed Users" icon={Users}>
                <p className="mb-3 text-xs text-muted-foreground">
                    Users who can chat with the bot. Empty = everyone allowed (dev mode).
                </p>
                <div className="mb-3">
                    <ChipList
                        items={allowedJids}
                        onRemove={(jid) =>
                            updateField(
                                ["whatsapp", "allowedJids"],
                                allowedJids.filter((j) => j !== jid)
                            )
                        }
                    />
                </div>
                <AddItemForm
                    placeholder="1234567890@s.whatsapp.net"
                    onAdd={(v) => {
                        if (!allowedJids.includes(v)) {
                            updateField(["whatsapp", "allowedJids"], [...allowedJids, v]);
                        }
                    }}
                />
            </Section>

            {/* Channel Config */}
            <Section title="Channel Configuration" icon={MessageCircle}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                        label="Session Directory"
                        value={(get(["whatsapp", "sessionDir"]) as string) ?? ".agents/whatsapp-sessions"}
                        onChange={(v) => updateField(["whatsapp", "sessionDir"], v)}
                        mono
                    />
                    <NumberField
                        label="History Token Budget"
                        value={(get(["whatsapp", "historyTokenBudget"]) as number) ?? 12000}
                        onChange={(v) => updateField(["whatsapp", "historyTokenBudget"], v)}
                    />
                    <NumberField
                        label="Rate Limit / Min"
                        value={(get(["whatsapp", "rateLimitPerMinute"]) as number) ?? 15}
                        onChange={(v) => updateField(["whatsapp", "rateLimitPerMinute"], v)}
                    />
                    <NumberField
                        label="Max Input Length"
                        value={(get(["whatsapp", "maxInputLength"]) as number) ?? 2000}
                        onChange={(v) => updateField(["whatsapp", "maxInputLength"], v)}
                    />
                </div>
            </Section>
        </div>
    );
}
