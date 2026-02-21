import * as vscode from 'vscode';
import { BridgeServer } from './server';

let server: BridgeServer | undefined;

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('copilotBridge');
    const port = config.get<number>('port', 4000);
    const autoStart = config.get<boolean>('autoStart', true);

    const output = vscode.window.createOutputChannel('Copilot Bridge');
    context.subscriptions.push(output);

    server = new BridgeServer(port, output);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotBridge.start', () => {
            server?.start();
            vscode.window.showInformationMessage(`Copilot Bridge started on port ${port}`);
        }),
        vscode.commands.registerCommand('copilotBridge.stop', () => {
            server?.stop();
            vscode.window.showInformationMessage('Copilot Bridge stopped');
        }),
        vscode.commands.registerCommand('copilotBridge.restart', () => {
            server?.stop();
            server?.start();
            vscode.window.showInformationMessage(`Copilot Bridge restarted on port ${port}`);
        }),
    );

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

export function deactivate() {
    server?.stop();
}
