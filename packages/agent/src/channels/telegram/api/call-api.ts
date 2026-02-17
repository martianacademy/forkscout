/**
 * Generic Telegram Bot API caller.
 *
 * Sends a POST request to `https://api.telegram.org/bot<token>/<method>`
 * with an optional JSON body. Returns the parsed `result` field on success
 * or throws a descriptive error on failure.
 *
 * @param token   - Telegram Bot API token (from BotFather)
 * @param method  - API method name, e.g. `"getUpdates"`, `"sendMessage"`
 * @param params  - Optional key-value params serialised as JSON body
 * @returns The `result` field from the Telegram API response
 *
 * @throws {Error} When the API responds with `ok: false`.
 *         The error message includes the method name, description, and error code.
 *
 * @example
 * ```ts
 * const updates = await callApi<TelegramUpdate[]>(token, 'getUpdates', {
 *     offset: 12345,
 *     timeout: 30,
 * });
 * ```
 */
export async function callApi<T = any>(
    token: string,
    method: string,
    params?: Record<string, any>,
): Promise<T> {
    const url = `https://api.telegram.org/bot${token}/${method}`;

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
        });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Network error calling ${method}: ${reason}`);
        throw new Error(`Telegram API ${method}: network error — ${reason}`);
    }

    let data: any;
    try {
        data = await res.json();
    } catch {
        console.error(`[Telegram API] Invalid JSON response from ${method} (HTTP ${res.status})`);
        throw new Error(`Telegram API ${method}: invalid JSON response (HTTP ${res.status})`);
    }

    if (!data.ok) {
        const desc = data.description || 'Unknown error';
        const code = data.error_code || res.status;
        console.error(`[Telegram API] ${method} failed: ${desc} (${code})`);
        throw new Error(`Telegram API ${method}: ${desc} (${code})`);
    }

    return data.result as T;
}
