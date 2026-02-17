/**
 * Telegram Bot API — individual function re-exports.
 *
 * Import any function directly:
 *   import { sendMessage } from './api';
 *   import { callApi }     from './api/call-api';   // also works
 */

export { callApi } from './call-api';
export { getMe } from './get-me';
export { downloadFile } from './download-file';
export { sendMessage } from './send-message';
export { sendPhoto } from './send-photo';
export { sendDocument } from './send-document';
export { sendTyping } from './send-typing';
export { splitMessage } from './split-message';
