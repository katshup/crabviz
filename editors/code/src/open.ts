import * as vscode from 'vscode';
import { graphviz } from '@hpcc-js/wasm';
import { showCallGraph } from './webview';

export function activateOpenCallGraph(context: vscode.ExtensionContext) {
    let openCallGraphCommand = vscode.commands.registerCommand("crabviz.openCallGraph", async () => {
        vscode.window.showOpenDialog({filters: { 'callgraph': ['crabviz'] }, canSelectMany: false}).then(uris => {
            if (uris === undefined) {
                return;
            }

            if (uris.length < 1) {
                return;
            }

            vscode.workspace.openTextDocument(uris[0]).then(doc => {
                let dotText = doc.getText();

                graphviz.dot(dotText).then(svg => {
                    showCallGraph(context, svg);
                });
            });
        });
    });

    context.subscriptions.push(openCallGraphCommand);
}