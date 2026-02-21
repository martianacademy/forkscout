"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const server_1 = require("./server");
let server;
function activate(context) {
    const config = vscode.workspace.getConfiguration('copilotBridge');
    const port = config.get('port', 4000);
    const autoStart = config.get('autoStart', true);
    const output = vscode.window.createOutputChannel('Copilot Bridge');
    context.subscriptions.push(output);
    server = new server_1.BridgeServer(port, output);
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand('copilotBridge.start', () => {
        server?.start();
        vscode.window.showInformationMessage(`Copilot Bridge started on port ${port}`);
    }), vscode.commands.registerCommand('copilotBridge.stop', () => {
        server?.stop();
        vscode.window.showInformationMessage('Copilot Bridge stopped');
    }), vscode.commands.registerCommand('copilotBridge.restart', () => {
        server?.stop();
        server?.start();
        vscode.window.showInformationMessage(`Copilot Bridge restarted on port ${port}`);
    }));
    // Status bar indicator
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = `$(radio-tower) Bridge :${port}`;
    statusBar.tooltip = 'Copilot Bridge — click to restart';
    statusBar.command = 'copilotBridge.restart';
    statusBar.show();
    context.subscriptions.push(statusBar);
    if (autoStart) {
        server.start();
    }
}
function deactivate() {
    server?.stop();
}
//# sourceMappingURL=extension.js.map