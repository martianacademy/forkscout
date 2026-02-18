/**
 * Survival system types — interfaces for vitals, threats, and configuration.
 *
 * @module survival/types
 */

// ── Threat severity ────────────────────────────────────

export type ThreatLevel = 'info' | 'warning' | 'critical' | 'emergency';

// ── Vital signs ────────────────────────────────────────

export interface VitalSign {
    name: string;
    status: 'ok' | 'degraded' | 'critical';
    value: string;
    detail?: string;
}

// ── Threat events ──────────────────────────────────────

export interface ThreatEvent {
    level: ThreatLevel;
    source: string;
    message: string;
    timestamp: number;
    action?: string; // what the monitor auto-did about it
}

// ── Overall status ─────────────────────────────────────

export interface SurvivalStatus {
    uptime: number;       // ms since start
    heartbeats: number;   // total check cycles
    threats: ThreatEvent[];  // recent threat log (last 50)
    vitals: VitalSign[];     // latest snapshot
    hasRoot: boolean;
    protections: string[];   // active protections
    lastBackup?: number;     // timestamp of last memory backup
    isOnBattery: boolean;
    batteryPercent: number;
}

// ── Configuration ──────────────────────────────────────

export interface SurvivalConfig {
    /** Path to .forkscout/ data directory */
    dataDir: string;
    /** Heartbeat interval in ms (default: 30000 = 30s) */
    heartbeatInterval?: number;
    /** Battery % threshold for warning (default: 20) */
    batteryWarn?: number;
    /** Battery % threshold for emergency flush (default: 8) */
    batteryCritical?: number;
    /** Disk space threshold in MB for warning (default: 500) */
    diskWarnMB?: number;
    /** Backup interval in ms (default: 3600000 = 1 hour) */
    backupInterval?: number;
    /** Callback to flush memory urgently */
    emergencyFlush: () => Promise<void>;
}

// ── Resolved config (all fields required) ──────────────

export type ResolvedSurvivalConfig = Required<SurvivalConfig>;

// ── Battery parse result (returned by parseBatteryOutput) ──

export interface BatteryParseResult {
    vital: VitalSign;
    percent: number;
    isOnBattery: boolean;
    /** Threat to log, if any */
    threat?: { level: ThreatLevel; source: string; message: string; action?: string };
    /** Whether emergency flush should fire */
    shouldEmergencyFlush: boolean;
}

// ── SurvivalMonitor public API (returned by createSurvivalMonitor) ──

export interface SurvivalMonitor {
    /** Start monitoring. Call once after agent.init(). */
    start(): Promise<void>;
    /** Stop monitoring gracefully. */
    stop(): Promise<void>;
    /** Whether we have effective root access (UID 0 or passwordless sudo). */
    hasRootAccess(): boolean;
    /** Trigger a manual memory backup (public API for tools). */
    backupMemory(): Promise<void>;
    /** Get full survival status snapshot. */
    getStatus(): SurvivalStatus;
    /** Get pending critical/emergency alerts for system prompt injection. */
    getPendingAlerts(): ThreatEvent[];
    /** Format alerts for system prompt injection. */
    formatAlerts(): string;
    /** Temporarily lift immutable flags for a write operation, then re-set. */
    withWriteAccess<T>(fn: () => Promise<T>): Promise<T>;
    /** Register a callback for graceful shutdown (replaces EventEmitter 'shutdown'). */
    onShutdown(cb: () => Promise<void> | void): void;
}
