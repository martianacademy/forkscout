/**
 * Fast network scanning and port discovery tools.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const scanLocalNetwork = tool({
  description: 'Scan the local network subnet to discover active IP and MAC addresses. (Fast parallel ping sweep)',
  inputSchema: z.object({
    subnetPrefix: z.string().default('192.168.1'),
    range: z.string().default('1..254'),
  }),
  execute: async ({ subnetPrefix, range }) => {
    try {
      // Optimized parallel ping sweep + arp -an
      const cmd = `for i in {${range}} ; do ping -c 1 -t 1 ${subnetPrefix}.$i > /dev/null 2>&1 & done ; wait ; arp -an | grep -v incomplete`;
      const { stdout, stderr } = await execAsync(cmd, { shell: '/bin/bash', timeout: 30000 });
      
      if (!stdout && stderr) return `TOOL ERROR [scan_local_network]: ${stderr}`;
      if (!stdout) return "No active devices found in the scan range.";
      
      return stdout.trim();
    } catch (err: any) {
      return `TOOL ERROR [scan_local_network]: ${err.message}`;
    }
  },
});

export const scanTargetPorts = tool({
  description: 'Fast parallel port scan for a specific IP address using bash /dev/tcp. Scans all 65535 ports by default.',
  inputSchema: z.object({
    targetIp: z.string(),
    portRange: z.string().default('1..65535'),
    concurrency: z.number().default(200), // Batched parallel execution to prevent system load
  }),
  execute: async ({ targetIp, portRange, concurrency }) => {
    try {
      // Since firing 65k commands at once is risky, we'll use a bash script that handles it more gracefully.
      // But the user liked the one-liner, so let's use a batch-based shell script for safety.
      const cmd = `for p in {${portRange}}; do (echo >/dev/tcp/${targetIp}/$p) >/dev/null 2>&1 && echo "Port $p is open" & [ $(($p % ${concurrency})) -eq 0 ] && wait; done ; wait`;
      const { stdout, stderr } = await execAsync(cmd, { shell: '/bin/bash', timeout: 120000 });

      if (!stdout && stderr) return `TOOL ERROR [scan_target_ports]: ${stderr}`;
      if (!stdout) return `No open ports found on ${targetIp} in the range ${portRange}.`;

      return stdout.trim();
    } catch (err: any) {
      return `TOOL ERROR [scan_target_ports]: ${err.message}`;
    }
  },
});
