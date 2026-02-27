// src/tools/android_tv_control_tools.ts — Control any Android TV via ADB
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

// Common Android TV key codes
const KEY_CODES = {
  power: "KEYCODE_POWER",
  home: "KEYCODE_HOME",
  back: "KEYCODE_BACK",
  up: "KEYCODE_DPAD_UP",
  down: "KEYCODE_DPAD_DOWN",
  left: "KEYCODE_DPAD_LEFT",
  right: "KEYCODE_DPAD_RIGHT",
  enter: "KEYCODE_ENTER",
  volume_up: "KEYCODE_VOLUME_UP",
  volume_down: "KEYCODE_VOLUME_DOWN",
  mute: "KEYCODE_MUTE",
  channel_up: "KEYCODE_CHANNEL_UP",
  channel_down: "KEYCODE_CHANNEL_DOWN",
  play: "KEYCODE_MEDIA_PLAY",
  pause: "KEYCODE_MEDIA_PAUSE",
  stop: "KEYCODE_MEDIA_STOP",
  rewind: "KEYCODE_MEDIA_REWIND",
  fast_forward: "KEYCODE_MEDIA_FAST_FORWARD",
  menu: "KEYCODE_MENU",
  search: "KEYCODE_SEARCH",
  info: "KEYCODE_INFO",
  star: "KEYCODE_STAR",
  pound: "KEYCODE_POUND",
  guide: "KEYCODE_GUIDE",
  tv_input: "KEYCODE_TV_INPUT",
  tv_data_service: "KEYCODE_TV_DATA_SERVICE",
};

type KeyCode = keyof typeof KEY_CODES;

async function runADB(args: string[]): Promise<{ success: boolean; output?: string; error?: string }> {
  const command = ["adb", ...args].join(" ");
  try {
    const proc = Bun.spawn(["adb", ...args], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    
    if (error && !output) {
      return { success: false, error: error.trim() };
    }
    return { success: true, output: output.trim() };
  } catch (err: any) {
    return { success: false, error: err.message || "ADB command failed" };
  }
}

async function connectToTV(ip: string, port: number = 5555): Promise<{ success: boolean; error?: string }> {
  // First disconnect if already connected
  await runADB(["disconnect", `${ip}:${port}`]);
  
  const result = await runADB(["connect", `${ip}:${port}`]);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  // Verify connection
  const devices = await runADB(["devices", "-l"]);
  if (!devices.output?.includes(ip)) {
    return { success: false, error: "Failed to connect to TV" };
  }
  
  return { success: true };
}

export const android_tv_control_tools = tool({
  description: "Control any Android TV via ADB. Send key presses, launch apps, take screenshots, install apps, and more. Supports any Android TV/box (Nvidia Shield, Chromecast, Fire TV, Roku, etc.)",
  inputSchema: z.object({
    action: z.enum([
      "connect",
      "disconnect",
      "devices",
      "key",
      "text",
      "launch_app",
      "list_apps",
      "screenshot",
      "device_info",
      "install_app",
      "uninstall_app",
      "push_file",
      "pull_file",
      "shell",
      "input_tap",
      "input_swipe",
      "get_current_app",
      "get_screen_resolution",
      "dumpsys_activity",
    ]).describe("The action to perform"),
    ip: z.string().optional().describe("Android TV IP address (e.g., 192.168.1.100)"),
    port: z.number().optional().describe("ADB port (default: 5555)"),
    key: z.string().optional().describe("Key name (power, home, back, up, down, left, right, enter, volume_up, volume_down, mute, channel_up, channel_down, play, pause, stop, rewind, fast_forward, menu, search, info, star, guide, tv_input)"),
    text: z.string().optional().describe("Text to input (for text action)"),
    package: z.string().optional().describe("Android package name (e.g., com.netflix.ninja)"),
    apk_path: z.string().optional().describe("Local APK file path (for install)"),
    local_path: z.string().optional().describe("Local file path (for push/pull)"),
    remote_path: z.string().optional().describe("Remote file path (for push/pull)"),
    shell_cmd: z.string().optional().describe("Shell command to execute"),
    x: z.number().optional().describe("X coordinate for tap"),
    y: z.number().optional().describe("Y coordinate for tap"),
    x2: z.number().optional().describe("X2 coordinate for swipe end"),
    y2: z.number().optional().describe("Y2 coordinate for swipe end"),
    duration: z.number().optional().describe("Swipe duration in ms"),
    screenshot_path: z.string().optional().describe("Local path to save screenshot (default: ./screenshot.png)"),
  }),
  execute: async (input) => {
    const { action, ip, port = 5555 } = input;

    // Connect action
    if (action === "connect") {
      if (!ip) return { success: false, error: "IP address required" };
      const result = await connectToTV(ip, port);
      return result;
    }

    // Disconnect action
    if (action === "disconnect") {
      if (!ip) return { success: false, error: "IP address required" };
      const result = await runADB(["disconnect", `${ip}:${port}`]);
      return { success: result.success, output: result.output || result.error };
    }

    // List devices
    if (action === "devices") {
      const result = await runADB(["devices", "-l"]);
      const devices = result.output?.split("\n").filter((l: string) => l.trim()) || [];
      return { success: true, devices };
    }

    // For all other actions, IP is required
    if (!ip) {
      return { success: false, error: "IP address required for this action. First connect using action: 'connect'" };
    }

    // Execute shell command on device
    if (action === "shell") {
      if (!input.shell_cmd) return { success: false, error: "shell_cmd required" };
      const result = await runADB(["-s", `${ip}:${port}`, "shell", input.shell_cmd]);
      return { success: result.success, output: result.output || result.error };
    }

    // Send key event
    if (action === "key") {
      if (!input.key) return { success: false, error: "key name required" };
      const keyUpper = input.key.toLowerCase();
      const keyCode = KEY_CODES[keyUpper as KeyCode];
      if (!keyCode) {
        return { success: false, error: `Unknown key: ${input.key}. Valid keys: ${Object.keys(KEY_CODES).join(", ")}` };
      }
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "input", "keyevent", keyCode]);
      return { success: result.success, output: result.output || "Key sent" };
    }

    // Input text
    if (action === "text") {
      if (!input.text) return { success: false, error: "text required" };
      // Escape special characters for shell
      const escapedText = input.text.replace(/[\\s"$\\`]/g, "\\$&");
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "input", "text", escapedText]);
      return { success: result.success, output: "Text input sent" };
    }

    // Tap screen
    if (action === "input_tap") {
      if (input.x === undefined || input.y === undefined) {
        return { success: false, error: "x and y coordinates required" };
      }
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "input", "tap", `${input.x}`, `${input.y}`]);
      return { success: result.success, output: "Tap sent" };
    }

    // Swipe gesture
    if (action === "input_swipe") {
      const { x, y, x2, y2, duration = 300 } = input as any;
      if (x === undefined || y === undefined || x2 === undefined || y2 === undefined) {
        return { success: false, error: "x, y, x2, y2 coordinates required" };
      }
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "input", "swipe", `${x}`, `${y}`, `${x2}`, `${y2}`, `${duration}`]);
      return { success: result.success, output: "Swipe sent" };
    }

    // Launch app
    if (action === "launch_app") {
      if (!input.package) return { success: false, error: "package name required" };
      // Try to launch using monkey -c
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "monkey", "-p", input.package, "-c", "android.intent.category.LAUNCHER", "1"]);
      // Also try activity manager
      if (!result.success) {
        const result2 = await runADB(["-s", `${ip}:${port}`, "shell", "am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", `${input.package}/.MainActivity`]);
        return { success: result2.success, output: result2.success ? "App launched" : result2.error };
      }
      return { success: result.success, output: "App launched" };
    }

    // List installed apps
    if (action === "list_apps") {
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "pm", "list", "packages", "-3"]);
      if (!result.success) return { success: false, error: result.error };
      const packages = result.output?.split("\n").map((l: string) => l.replace("package:", "").trim()).filter(Boolean) || [];
      return { success: true, packages };
    }

    // Get current app
    if (action === "get_current_app") {
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "dumpsys", "window", "|", "grep", "-E", "mCurrentFocus|mFocusedApp"]);
      return { success: result.success, output: result.output };
    }

    // Get screen resolution
    if (action === "get_screen_resolution") {
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "wm", "size"]);
      if (!result.success) return { success: false, error: result.error };
      const match = result.output?.match(/(\d+)x(\d+)/);
      if (match) {
        return { success: true, width: parseInt(match[1]), height: parseInt(match[2]) };
      }
      return { success: false, error: "Could not parse resolution" };
    }

    // Device info
    if (action === "device_info") {
      const model = await runADB(["-s", `${ip}:${port}`, "shell", "getprop", "ro.product.model"]);
      const manufacturer = await runADB(["-s", `${ip}:${port}`, "shell", "getprop", "ro.product.manufacturer"]);
      const androidVersion = await runADB(["-s", `${ip}:${port}`, "shell", "getprop", "ro.build.version.release"]);
      const sdkVersion = await runADB(["-s", `${ip}:${port}`, "shell", "getprop", "ro.build.version.sdk"]);
      const serial = await runADB(["-s", `${ip}:${port}`, "shell", "getprop", "ro.serialno"]);
      
      return {
        success: true,
        device: {
          model: model.output,
          manufacturer: manufacturer.output,
          androidVersion: androidVersion.output,
          sdkVersion: sdkVersion.output,
          serial: serial.output,
        },
      };
    }

    // Take screenshot
    if (action === "screenshot") {
      const screenshotPath = input.screenshot_path || "/sdcard/screenshot.png";
      await runADB(["-s", `${ip}:${port}`, "shell", "screencap", "-p", screenshotPath]);
      const localPath = input.screenshot_path || "./screenshot.png";
      const result = await runADB(["-s", `${ip}:${port}`, "pull", screenshotPath, localPath]);
      return { success: result.success, output: result.output || `Screenshot saved to ${localPath}`, localPath };
    }

    // Install APK
    if (action === "install_app") {
      if (!input.apk_path) return { success: false, error: "apk_path required" };
      const result = await runADB(["-s", `${ip}:${port}`, "install", "-r", input.apk_path]);
      return { success: result.success, output: result.output || result.error };
    }

    // Uninstall app
    if (action === "uninstall_app") {
      if (!input.package) return { success: false, error: "package name required" };
      const result = await runADB(["-s", `${ip}:${port}`, "uninstall", input.package]);
      return { success: result.success, output: result.output || result.error };
    }

    // Push file to device
    if (action === "push_file") {
      if (!input.local_path || !input.remote_path) {
        return { success: false, error: "local_path and remote_path required" };
      }
      const result = await runADB(["-s", `${ip}:${port}`, "push", input.local_path, input.remote_path]);
      return { success: result.success, output: result.output || result.error };
    }

    // Pull file from device
    if (action === "pull_file") {
      if (!input.remote_path || !input.local_path) {
        return { success: false, error: "remote_path and local_path required" };
      }
      const result = await runADB(["-s", `${ip}:${port}`, "pull", input.remote_path, input.local_path]);
      return { success: result.success, output: result.output || result.error };
    }

    // Dumpsys activity
    if (action === "dumpsys_activity") {
      const result = await runADB(["-s", `${ip}:${port}`, "shell", "dumpsys", "activity", "activities"]);
      return { success: result.success, output: result.output };
    }

    return { success: false, error: "Unknown action" };
  },
});
