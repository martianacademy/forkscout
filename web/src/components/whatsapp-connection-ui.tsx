"use client";

import { Phone, Play, QrCode, RefreshCw, WifiOff } from "lucide-react";

interface WhatsAppStatus {
    connected: boolean;
    started?: boolean;
    qr?: string;
    jid?: string;
    pairingCode?: string;
}

/** Displays the 8-digit pairing code with instructions. */
export function PairingCodeDisplay({ code }: { code: string }) {
    // Format code as XXXX-XXXX for readability
    const formatted = code.length === 8
        ? `${code.slice(0, 4)}-${code.slice(4)}`
        : code;

    return (
        <div className="text-center">
            <p className="mb-3 text-sm text-muted-foreground">
                Enter this code on your phone to pair:
            </p>
            <div className="mx-auto inline-block rounded-xl border border-accent/20 bg-accent/5 p-6">
                <p className="font-mono text-4xl font-bold tracking-[0.3em] text-foreground">
                    {formatted}
                </p>
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground/80">How to pair:</p>
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Go to <span className="font-medium">Settings → Linked Devices</span></p>
                <p>3. Tap <span className="font-medium">Link a Device</span></p>
                <p>4. Tap <span className="font-medium">&quot;Link with phone number instead&quot;</span></p>
                <p>5. Enter the code shown above</p>
            </div>
        </div>
    );
}

/** Displays the QR code image for scanning. */
export function QrCodeDisplay({ qr }: { qr: string }) {
    return (
        <div className="text-center">
            <p className="mb-3 text-sm text-muted-foreground">
                Scan this QR code with WhatsApp to connect:
            </p>
            <div className="mx-auto inline-block rounded-xl border border-border bg-white p-4">
                {qr.startsWith("data:") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="WhatsApp QR" className="h-64 w-64" />
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 w-64">
                        <QrCode className="h-16 w-16 text-muted-foreground" />
                        <p className="mt-2 text-xs text-muted-foreground break-all">
                            QR available in terminal
                        </p>
                    </div>
                )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
                QR refreshes automatically every few seconds.
            </p>
        </div>
    );
}

/** Connection options: QR scan or pairing code with phone number. */
export function ConnectOptions({
    status,
    connecting,
    phoneNumber,
    onPhoneChange,
    onConnect,
}: {
    status: WhatsAppStatus | null;
    connecting: boolean;
    phoneNumber: string;
    onPhoneChange: (v: string) => void;
    onConnect: (usePairingCode: boolean) => void;
}) {
    if (status?.started) {
        return (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <WifiOff className="h-5 w-5 text-muted-foreground" />
                <div>
                    <p className="text-sm font-medium">Connecting…</p>
                    <p className="text-xs text-muted-foreground">
                        WhatsApp channel is starting — waiting for server response.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <WifiOff className="h-5 w-5 text-muted-foreground" />
                <div>
                    <p className="text-sm font-medium">Not connected</p>
                    <p className="text-xs text-muted-foreground">
                        Choose a pairing method to link your WhatsApp device.
                    </p>
                </div>
            </div>

            {/* Pairing Code method — primary (more reliable) */}
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">Pair with Phone Number</p>
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
                        Recommended
                    </span>
                </div>
                <p className="text-xs text-muted-foreground">
                    Enter your phone number (with country code, no + sign) to get an 8-digit pairing code.
                </p>
                <div className="flex gap-2">
                    <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => onPhoneChange(e.target.value)}
                        placeholder="e.g. 919876543210"
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                        onClick={() => onConnect(true)}
                        disabled={connecting || !phoneNumber.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
                    >
                        {connecting ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Phone className="h-3.5 w-3.5" />
                        )}
                        {connecting ? "Starting…" : "Get Code"}
                    </button>
                </div>
            </div>

            {/* QR method — fallback */}
            <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <QrCode className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Pair with QR Code</p>
                    </div>
                    <button
                        onClick={() => onConnect(false)}
                        disabled={connecting}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                    >
                        {connecting ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Play className="h-3.5 w-3.5" />
                        )}
                        Scan QR
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Opens WhatsApp Web QR flow. May fail if rate-limited.
                </p>
            </div>
        </div>
    );
}
