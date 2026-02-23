/**
 * Self-rebuild tool — validates source, builds, then triggers a graceful
 * process reload via the watchdog (exit code 10).
 *
 * The agent should use this AFTER making source edits with safe_self_edit.
 * Flow: tsc --noEmit (validate) → memory flush → exit(10) → watchdog rebuilds + restarts.
 *
 * @module tools/self-rebuild-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { getShell } from '../utils/shell';
import { AGENT_ROOT } from '../paths';
import type { ToolDeps } from './deps';

/** Auto-discovered by auto-loader — called with ToolDeps at startup. */
export function register(deps: ToolDeps) {
    return { self_rebuild: createSelfRebuildTool(() => deps.memory.flush()) };
}

/** Exit code the watchdog recognizes as "rebuild & restart me" */
const RELOAD_EXIT_CODE = 10;

export function createSelfRebuildTool(flushMemory: () => Promise<void>) {
    return tool({
        description:
            'Rebuild the agent from source and reload. ' +
            'Use this in two cases: (1) after making edits with safe_self_edit to apply them, or ' +
            '(2) when the user explicitly asks to rebuild/restart (e.g. says "self_rebuild") — ' +
            'the developer may have made external edits that need to be picked up. ' +
            'Validates TypeScript compilation, flushes memory to disk, then triggers a graceful restart via watchdog.',
        inputSchema: z.object({
            reason: z.string().describe('Brief explanation of what changed and why a rebuild is needed'),
        }),
        execute: async ({ reason }) => {
            console.log(`\n🔄 SELF-REBUILD requested: ${reason}`);

            // Step 1: Validate TypeScript compiles
            console.log('   Step 1/3: Validating TypeScript...');
            const tscResult = await new Promise<{ success: boolean; errors: string }>((resolve) => {
                exec(
                    `node_modules/.bin/tsc --noEmit 2>&1 | head -30`,
                    {
                        timeout: 60_000,
                        shell: getShell(),
                        maxBuffer: 1024 * 1024,
                        cwd: AGENT_ROOT,
                    },
                    (_error: Error | null, stdout: string) => {
                        const output = (stdout || '').trim();
                        resolve({ success: !output.includes('error TS'), errors: output });
                    },
                );
            });

            if (!tscResult.success) {
                console.log('   ❌ TypeScript validation failed — rebuild aborted');
                return `REBUILD ABORTED: TypeScript compilation has errors.\n\nErrors:\n${tscResult.errors}\n\nFix the errors with safe_self_edit first, then try self_rebuild again.`;
            }
            console.log('   ✅ TypeScript validation passed');

            // Step 2: Flush memory to disk
            console.log('   Step 2/3: Flushing memory to disk...');
            try {
                await flushMemory();
                console.log('   ✅ Memory flushed');
            } catch (err) {
                console.log(`   ⚠️ Memory flush failed: ${err} (continuing with rebuild)`);
            }

            // Step 3: Signal watchdog to rebuild + restart
            console.log('   Step 3/3: Signaling watchdog for rebuild + restart...');
            console.log(`\n🔄 RELOADING — reason: ${reason}\n`);

            // Give a moment for the response to reach the client
            setTimeout(() => {
                process.exit(RELOAD_EXIT_CODE);
            }, 500);

            return `REBUILD INITIATED: TypeScript validated, memory flushed. The agent will restart momentarily with the updated code. Reason: ${reason}`;
        },
    });
}
