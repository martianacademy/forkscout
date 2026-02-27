// src/tools/network_scan_tools.ts — Scan local network for open ports and devices
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

// Common ports to scan (can be customized)
const COMMON_PORTS = [
  22,   // SSH
  23,   // Telnet
  80,   // HTTP
  443,  // HTTPS
  3000, // Node.js
  3001, // Alt HTTP
  5000, // Flask/Dev
  5555, // ADB
  8000, // Django
  8080, // HTTP Proxy
  8443, // HTTPS Alt
  9000, // PHP-FPM
  30001, // LG TV SSAP
  30002, // LG TV SSAP
];

// Get local network interface info
async function getLocalNetwork(): Promise<{ ip: string; subnet: string } | null> {
  const { execSync } = await import("child_process");
  
  try {
    // Try to get the default interface IP
    const output = execSync("ip route | grep default | awk '{print $3}' | head -1", { encoding: "utf8" }).trim();
    
    if (output) {
      // Get the subnet (e.g., 192.168.1 from 192.168.1.1)
      const parts = output.split(".");
      if (parts.length === 4) {
        return { ip: output, subnet: `${parts[0]}.${parts[1]}.${parts[2]}` };
      }
    }
  } catch {
    // Fallback: try hostname
    try {
      const hostnameOutput = execSync("hostname -I | awk '{print $1}'", { encoding: "utf8" }).trim();
      if (hostnameOutput) {
        const parts = hostnameOutput.split(".");
        if (parts.length === 4) {
          return { ip: hostnameOutput, subnet: `${parts[0]}.${parts[1]}.${parts[2]}` };
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

// Scan a single IP for open ports
async function scanIP(ip: string, ports: number[]): Promise<{ ip: string; openPorts: number[] } | null> {
  const { execSync } = await import("child_process");
  const openPorts: number[] = [];
  
  for (const port of ports) {
    try {
      // Use timeout to make it fast
      execSync(
        `timeout 0.5 bash -c "echo > /dev/tcp/${ip}/${port}" 2>/dev/null`,
        { encoding: "utf8", stdio: "ignore" }
      );
      openPorts.push(port);
    } catch {
      // Port closed or filtered
    }
  }
  
  return openPorts.length > 0 ? { ip, openPorts } : null;
}

// Fast ping sweep to find live hosts
async function pingSweep(subnet: string): Promise<string[]> {
  const { execSync } = await import("child_process");
  const liveHosts: string[] = [];
  
  try {
    // Use fping for fast parallel ping (if available)
    const fpingOutput = execSync(
      `fping -g ${subnet}.1 ${subnet}.254 -a 2>/dev/null || echo "fping_not_available"`,
      { encoding: "utf8", timeout: 10000 }
    );
    
    if (!fpingOutput.includes("fping_not_available")) {
      return fpingOutput.trim().split("\n").filter(Boolean);
    }
  } catch {
    // fping not available
  }
  
  // Fallback: parallel ping with bash
  try {
    const result = execSync(
      `for i in {1..254}; do (ping -c 1 -W 1 ${subnet}.$i >/dev/null 2>&1 && echo $i) & done; wait`,
      { encoding: "utf8", timeout: 30000 }
    );
    
    const found = result.trim().split("\n").filter(Boolean);
    return found.map(i => `${subnet}.${i}`);
  } catch {
    return [];
  }
}

export const network_scan_tools = tool({
  description: "Scan local network for devices with open ports. Returns only found devices, not empty results.",
  inputSchema: z.object({
    ports: z.array(z.number()).optional().describe("Specific ports to scan (default: common ports like 22,80,443,3000,5555,8080,30001)"),
    scanPorts: z.boolean().optional().default(true).describe("Whether to scan for open ports on found devices"),
    timeout: z.number().optional().default(30000).describe("Max scan timeout in ms"),
  }),
  execute: async (input) => {
    try {
      const ports = input.ports || COMMON_PORTS;
      const timeout = input.timeout || 30000;
      
      // Get local network info
      const network = await getLocalNetwork();
      
      if (!network) {
        return { 
          success: false, 
          error: "Could not determine local network. Please check network connectivity." 
        };
      }
      
      const { ip, subnet } = network;
      
      // Quick ping sweep to find live hosts
      const liveHosts = await pingSweep(subnet);
      
      if (liveHosts.length === 0) {
        // No hosts found - return empty but with clear message
        // Don't return "no device found" - just return success with empty array
        return {
          success: true,
          network: subnet,
          localIP: ip,
          devices: []
        };
      }
      
      // Scan each live host for open ports
      const foundDevices: Array<{
        ip: string;
        openPorts: number[];
        likelyService?: string;
      }> = [];
      
      // Process hosts in parallel (limited concurrency)
      const batchSize = 20;
      for (let i = 0; i < liveHosts.length; i += batchSize) {
        const batch = liveHosts.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(host => scanIP(host, ports))
        );
        
        for (const result of results) {
          if (result) {
            // Guess service based on open ports
            let likelyService: string | undefined;
            if (result.openPorts.includes(5555)) likelyService = "Android TV (ADB)";
            else if (result.openPorts.includes(30001) || result.openPorts.includes(30002)) likelyService = "LG TV (SSAP)";
            else if (result.openPorts.includes(22)) likelyService = "SSH Server";
            else if (result.openPorts.includes(80)) likelyService = "Web Server";
            else if (result.openPorts.includes(443)) likelyService = "HTTPS Server";
            
            foundDevices.push({
              ip: result.ip,
              openPorts: result.openPorts,
              likelyService
            });
          }
        }
      }
      
      // Only return if we found devices with open ports
      if (foundDevices.length === 0) {
        return {
          success: true,
          network: subnet,
          localIP: ip,
          devices: [],
          message: "Live hosts found but no open ports detected"
        };
      }
      
      return {
        success: true,
        network: subnet,
        localIP: ip,
        devices: foundDevices
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during network scan"
      };
    }
  }
});
