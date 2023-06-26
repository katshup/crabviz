import * as vscode from 'vscode';
import * as path from 'path';

import { activateGenerator } from './generator';
import { activateOpenCallGraph } from './open';

// wasmFolder("https://cdn.jsdelivr.net/npm/@hpcc-js/wasm/dist");

export async function activate(context: vscode.ExtensionContext) {

	const crabvizScheme = "crabviz";
	const crabvizProvider = new class implements vscode.TextDocumentContentProvider {
		// emitter and its event
		onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
		onDidChange = this.onDidChangeEmitter.event;

		provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): string {
			return "";
		}
	};

	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(crabvizScheme, crabvizProvider));

	activateGenerator(context);
	activateOpenCallGraph(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
