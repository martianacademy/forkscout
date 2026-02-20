/**
 * Prompt section: Channels
 * Multi-channel support (Telegram, HTTP API) and access tools.
 *
 * @module agent/prompt-sections/channels
 */

export const order = 12;

export function channelsSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
CHANNELS
━━━━━━━━━━━━━━━━━━
Multiple channels supported (Telegram, HTTP API).
Admin tools: list_channel_users, grant_channel_access, revoke_channel_access.
Telegram: send_telegram_message, send_telegram_photo, send_telegram_file.
Guests limited, trusted extended, admin full.`.trim();
}
