/**
 * Telegram Bot API wrapper — low-level HTTP calls to the Telegram API.
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import type { TelegramBotInfo } from './types';

export class TelegramApi {
    private baseUrl: string;
    private token: string;
    private maxMsgLen: number;

    constructor(token: string, maxMessageLength: number) {
        this.token = token;
        this.baseUrl = `https://api.telegram.org/bot${token}`;
        this.maxMsgLen = maxMessageLength;
    }

    /** Generic API call */
    async call<T = any>(method: string, params?: Record<string, any>): Promise<T> {
        const url = `${this.baseUrl}/${method}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
        });
        const data = (await res.json()) as any;
        if (!data.ok) {
            throw new Error(`Telegram API ${method}: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
        return data.result as T;
    }

    /** Verify the bot token and get bot info */
    async getMe(): Promise<TelegramBotInfo> {
        return this.call<TelegramBotInfo>('getMe');
    }

    /** Download a file by file_id → returns base64 string + media type */
    async downloadFile(fileId: string): Promise<{ base64: string; mediaType: string } | null> {
        try {
            const fileInfo = await this.call<{ file_id: string; file_path?: string; file_size?: number }>('getFile', {
                file_id: fileId,
            });
            if (!fileInfo.file_path) return null;

            const url = `https://api.telegram.org/file/bot${this.token}/${fileInfo.file_path}`;
            const res = await fetch(url);
            if (!res.ok) return null;

            const buffer = Buffer.from(await res.arrayBuffer());
            const base64 = buffer.toString('base64');

            const ext = fileInfo.file_path.split('.').pop()?.toLowerCase() || 'jpg';
            const mediaTypes: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                webp: 'image/webp',
                bmp: 'image/bmp',
            };
            return { base64, mediaType: mediaTypes[ext] || 'image/jpeg' };
        } catch (err) {
            console.error(`[Telegram]: Failed to download file ${fileId}:`, err);
            return null;
        }
    }

    /** Send a text message (auto-splits if too long) */
    async sendMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
        const chunks = this.splitMessage(text);
        for (const chunk of chunks) {
            await this.call('sendMessage', {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown',
                ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            }).catch(async () => {
                // Markdown parse failed — retry as plain text
                await this.call('sendMessage', {
                    chat_id: chatId,
                    text: chunk,
                    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
                });
            });
        }
    }

    /** Send a photo from a local file path */
    async sendPhoto(chatId: number, filePath: string, caption?: string): Promise<void> {
        const url = `${this.baseUrl}/sendPhoto`;
        const fileData = await readFile(filePath);
        const fileName = basename(filePath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('photo', new Blob([fileData]), fileName);
        if (caption) form.append('caption', caption);
        const res = await fetch(url, { method: 'POST', body: form });
        const data = (await res.json()) as any;
        if (!data.ok) {
            throw new Error(`Telegram API sendPhoto: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
    }

    /** Send a document/file from a local file path */
    async sendDocument(chatId: number, filePath: string, caption?: string): Promise<void> {
        const url = `${this.baseUrl}/sendDocument`;
        const fileData = await readFile(filePath);
        const fileName = basename(filePath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('document', new Blob([fileData]), fileName);
        if (caption) form.append('caption', caption);
        const res = await fetch(url, { method: 'POST', body: form });
        const data = (await res.json()) as any;
        if (!data.ok) {
            throw new Error(`Telegram API sendDocument: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
    }

    /** Show "typing..." indicator */
    async sendTyping(chatId: number): Promise<void> {
        await this.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { });
    }

    /** Split long messages at paragraph/newline boundaries */
    private splitMessage(text: string): string[] {
        if (text.length <= this.maxMsgLen) return [text];
        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= this.maxMsgLen) {
                chunks.push(remaining);
                break;
            }
            let splitAt = remaining.lastIndexOf('\n\n', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = remaining.lastIndexOf('\n', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = remaining.lastIndexOf('. ', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = this.maxMsgLen;
            chunks.push(remaining.slice(0, splitAt).trimEnd());
            remaining = remaining.slice(splitAt).trimStart();
        }
        return chunks;
    }
}
