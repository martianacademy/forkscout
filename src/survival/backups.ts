/**
 * Memory backup and restore — periodic snapshots of knowledge files.
 *
 * @module survival/backups
 */

import { resolve } from 'path';
import * as fs from 'fs';
import type { ThreatLevel } from './types';

/**
 * Back up knowledge-graph, vectors, and skills JSON files to a /backups subfolder.
 * Keeps only the latest backup per file (overwrites previous).
 *
 * @returns timestamp of backup if any files were backed up, undefined otherwise;
 *          plus any threat descriptors for failures.
 */
export function backupMemory(dataDir: string): {
    timestamp?: number;
    threat?: { level: ThreatLevel; source: string; message: string };
} {
    const backupDir = resolve(dataDir, 'backups');
    try {
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];
        let backedUp = 0;

        for (const file of files) {
            const src = resolve(dataDir, file);
            if (!fs.existsSync(src)) continue;
            const dest = resolve(backupDir, `${file}.bak`);
            fs.copyFileSync(src, dest);
            backedUp++;
        }

        if (backedUp > 0) {
            return { timestamp: Date.now() };
        }
        return {};
    } catch (err) {
        return {
            threat: { level: 'warning', source: 'backup', message: `Backup failed: ${err}` },
        };
    }
}

/**
 * Restore corrupt files from their .bak backups.
 *
 * @returns Array of threat descriptors (info for success, critical for failure).
 */
export function restoreFromBackup(
    dataDir: string,
    corruptFiles: string[],
): Array<{ level: ThreatLevel; source: string; message: string }> {
    const backupDir = resolve(dataDir, 'backups');
    const threats: Array<{ level: ThreatLevel; source: string; message: string }> = [];

    for (const file of corruptFiles) {
        const bakPath = resolve(backupDir, `${file}.bak`);
        const destPath = resolve(dataDir, file);
        if (fs.existsSync(bakPath)) {
            try {
                const content = fs.readFileSync(bakPath, 'utf-8');
                JSON.parse(content); // validate backup isn't corrupt too
                fs.copyFileSync(bakPath, destPath);
                threats.push({ level: 'info', source: 'integrity', message: `Restored ${file} from backup` });
            } catch {
                threats.push({
                    level: 'critical',
                    source: 'integrity',
                    message: `Backup of ${file} is also corrupt — data may be lost`,
                });
            }
        } else {
            threats.push({ level: 'critical', source: 'integrity', message: `No backup found for ${file}` });
        }
    }

    return threats;
}
