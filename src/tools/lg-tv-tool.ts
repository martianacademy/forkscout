import { tool } from 'ai';
import { z } from 'zod';
import lgtv from 'lgtv2';
import fs from 'fs';
import path from 'path';

const TV_IP = '192.168.1.4';
const CONFIG_PATH = path.join(process.cwd(), 'lg_tv_store.json');

// Ensure config exists
if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, '{}');
}

export const lgTvControl = tool({
  description: 'Control the LG webOS TV (192.168.1.4). Actions: set_volume, mute, list_apps, launch_app, toast, pairing, get_info.',
  inputSchema: z.object({
    action: z.enum(['set_volume', 'mute', 'list_apps', 'launch_app', 'toast', 'pairing', 'get_info']),
    value: z.string().optional(),
  }),
  execute: async ({ action, value }) => {
    // Disable SSL verification for self-signed LG certificates
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    return new Promise((resolve) => {
      // Try Secure Port 3001 FIRST
      const tv = lgtv({
        url: `wss://${TV_IP}:3001`,
        timeout: 5000,
        reconnect: false,
        keyFile: CONFIG_PATH,
      });

      let resolved = false;

      const finish = (result: any) => {
        if (!resolved) {
          resolved = true;
          tv.disconnect();
          resolve(result);
        }
      };

      tv.on('error', (err: any) => {
        // If 3001 fails, try 3000
        if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') {
          console.warn(`[lg_tv_control]: Port 3001 (secure) failed (${err.code}), trying port 3000 (non-secure)...`);
          const tv2 = lgtv({
            url: `ws://${TV_IP}:3000`,
            timeout: 5000,
            reconnect: false,
            keyFile: CONFIG_PATH,
          });

          tv2.on('error', (err2: any) => finish({ success: false, error: err2.message }));
          tv2.on('connect', () => {
            handleAction(tv2, action, value, finish);
          });
        } else {
          finish({ success: false, error: err.message });
        }
      });

      tv.on('connect', () => {
        handleAction(tv, action, value, finish);
      });
    });
  },
});

function handleAction(tv: any, action: string, value: string | undefined, finish: (res: any) => void) {
  switch (action) {
    case 'pairing':
      finish({ success: true, message: 'Pairing prompt sent to TV. Please allow the connection.' });
      break;

    case 'toast':
      tv.request('ssap://system.notifications/createToast', { message: value || 'Hello from Forkscout!' }, (err: any, res: any) => {
        finish(err ? { success: false, error: err.message } : { success: true, response: res });
      });
      break;

    case 'set_volume':
      tv.request('ssap://audio/setVolume', { volume: parseInt(value || '10', 10) }, (err: any, res: any) => {
        finish(err ? { success: false, error: err.message } : { success: true, response: res });
      });
      break;

    case 'mute':
      tv.request('ssap://audio/setMute', { mute: value === 'true' }, (err: any, res: any) => {
        finish(err ? { success: false, error: err.message } : { success: true, response: res });
      });
      break;

    case 'list_apps':
      tv.request('ssap://com.webos.applicationManager/listApps', (err: any, res: any) => {
        finish(err ? { success: false, error: err.message } : { success: true, apps: res.apps });
      });
      break;

    case 'launch_app':
      tv.request('ssap://system.launcher/launch', { id: value }, (err: any, res: any) => {
        finish(err ? { success: false, error: err.message } : { success: true, response: res });
      });
      break;

    case 'get_info':
      tv.request('ssap://com.webos.applicationManager/getForegroundAppInfo', (err: any, app: any) => {
        if (err) return finish({ success: false, error: err.message });
        finish({ success: true, foregroundApp: app });
      });
      break;

    default:
      finish({ success: false, error: 'Unknown action' });
  }
}
