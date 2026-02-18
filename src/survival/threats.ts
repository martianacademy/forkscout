/**
 * Threat log — deduplication, filtering, and formatting of threat events.
 *
 * @module survival/threats
 */

import type { ThreatEvent, ThreatLevel } from './types';

/**
 * Add a threat to the log with deduplication (same source+message within 60s).
 * Trims log to last 50 entries when it exceeds 100.
 * Returns the event if it was added (not a duplicate), undefined otherwise.
 */
export function addThreat(
    threats: ThreatEvent[],
    level: ThreatLevel,
    source: string,
    message: string,
    action?: string,
): ThreatEvent | undefined {
    // Deduplicate: don't log the same source+message within 60s
    const recent = threats.filter(
        (t) => t.source === source && t.message === message && Date.now() - t.timestamp < 60_000,
    );
    if (recent.length > 0) return undefined;

    const threat: ThreatEvent = {
        level,
        source,
        message,
        timestamp: Date.now(),
        action,
    };

    threats.push(threat);
    if (threats.length > 100) threats.splice(0, threats.length - 50);

    // Console output for critical+
    if (level === 'critical' || level === 'emergency') {
        console.log(`🚨 [SURVIVAL/${source}] ${message}${action ? ` → ${action}` : ''}`);
    } else if (level === 'warning') {
        console.log(`⚠️  [SURVIVAL/${source}] ${message}`);
    }

    return threat;
}

/**
 * Get pending threats that should be injected into the next chat response.
 * Returns critical/emergency threats from the last 5 minutes.
 */
export function getPendingAlerts(threats: ThreatEvent[]): ThreatEvent[] {
    return threats.filter(
        (t) =>
            (t.level === 'critical' || t.level === 'emergency') &&
            Date.now() - t.timestamp < 300_000,
    );
}

/**
 * Format pending alerts into a string for system prompt injection.
 * Returns empty string if no alerts.
 */
export function formatAlerts(threats: ThreatEvent[]): string {
    const alerts = getPendingAlerts(threats);
    if (alerts.length === 0) return '';
    return (
        '\n\n[SURVIVAL ALERTS — address immediately]\n' +
        alerts
            .map((a) => `🚨 [${a.source}] ${a.message}${a.action ? ` (auto-action: ${a.action})` : ''}`)
            .join('\n')
    );
}
