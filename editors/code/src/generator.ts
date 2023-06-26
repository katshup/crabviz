import * as vscode from 'vscode';
import * as path from 'path';

// require('../crabviz/crabviz_bg.wasm');
// import * as crabviz from '../crabviz';

import { graphviz } from '@hpcc-js/wasm';
import { retryCommand } from './utils/command';
import { convertSymbol } from './utils/lspTypesConversion';

import { showCallGraph } from './webview';
import { groupFileExtensions } from './utils/languages';
import { ignoredExtensions, readIgnoreRules } from './utils/ignores';

// crabviz.set_panic_hook();

export function activateGenerator(context: vscode.ExtensionContext) {
  let generateCallGraphCommand = vscode.commands.registerCommand('crabviz.generateCallGraph', async (contextSelection: vscode.Uri, allSelections: vscode.Uri[]) => {
		let cancelled = false;

		// selecting no file is actually selecting the entire workspace
		if (allSelections.length === 0) {
			allSelections.push(contextSelection);
		}

		const ignores = await readIgnoreRules();
		const selectedFiles: vscode.Uri[] = [];

		const folder = vscode.workspace.workspaceFolders!
			.find(folder => contextSelection.path.startsWith(folder.uri.path))!;

		const generator = new Generator(folder.uri);

		let extensions = new Set<string>();

		const scanDirectories = allSelections.map(selection => {
			const ext = path.extname(selection.path).substring(1);
			if (ext.length > 0) {
				selectedFiles.push(selection);
				extensions.add(ext);
				return undefined;
			} else {
				if (!selection.path.startsWith(folder.uri.path)) {
					vscode.window.showErrorMessage("Call graph across multiple workspace folders is not supported");
					return;
				}

				return path.relative(folder.uri.path, selection.path);
			}
		})
		.filter((scanPath): scanPath is string => scanPath !== undefined);

		if (scanDirectories.length > 0) {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Detecting project languages",
				cancellable: true
			}, (_, token) => {
				token.onCancellationRequested(() => {
					cancelled = true;
				});
				return collectFileExtensions(folder, scanDirectories, extensions, ignores, token);
			});;

			if (cancelled) {
				return;
			}
		}

		const extensionsByLanguage = groupFileExtensions(extensions);

		const selections = Object.keys(extensionsByLanguage).map(lang => ({ label: lang }));
		let lang: string;
		if (selections.length > 1) {
			const selectedItem = await vscode.window.showQuickPick(selections, {
				title: "Pick a language to generate call graph",
			});

			if (!selectedItem) {
				return;
			}
			lang = selectedItem.label;
		} else if (selections.length === 1) {
			lang = selections[0].label;
		} else {
			// TODO: user input
			return;
		}

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Window,
			title: "Crabviz: Generating call graph",
		}, _ => {
			let paths = scanDirectories.map(dir => extensionsByLanguage[lang].map(ext => dir.length > 0 ? `${dir}/**/*.${ext}` : `**/*.${ext}`).join(','));
			const include = new vscode.RelativePattern(folder, `{${paths.join(',')}}`);
			const exclude = `{${ignores.join(',')}}`;

			let search = scanDirectories.length > 0;

			return generator.generateCallGraph(selectedFiles, include, exclude, search);
		})
		.then(svg => showCallGraph(context, svg));
	});

  context.subscriptions.push(generateCallGraphCommand);
}

class Generator {
  private root: vscode.Uri;
  // private inner: crabviz.GraphGenerator;

  public constructor(root: vscode.Uri) {
    this.root = root;
    // inner = new crabviz.GraphGenerator(root.path);
  }

  public async generateCallGraph(
    selectedFiles: vscode.Uri[],
    includePattern: vscode.RelativePattern,
    exclude: string,
    search: boolean
  ): Promise<string> {
    // Help needed: import the module every time the method is called has some performance implications.
    // Any best practices for loading wasm modules in VS Code extension?
    const crabviz = await import('../crabviz');
    const inner = new crabviz.GraphGenerator(this.root.path);

    let allFiles = new Set(selectedFiles);

    /* 
     * only search for files if directories have been selected
     * this bypasses the ENAMETOOLONG for massive projects when selecting individual files
     */
    if (search) {
      const files = await vscode.workspace.findFiles(includePattern, exclude);
      allFiles = new Set(files.concat(selectedFiles));
    }
    

    for await (const file of allFiles) {
      // retry several times if the LSP server is not ready
      let symbols = await retryCommand<vscode.DocumentSymbol[]>(5, 600, 'vscode.executeDocumentSymbolProvider', file);
      if (symbols === undefined) {
        vscode.window.showErrorMessage(`Document symbol information not available for '${file.fsPath}'`);
        continue;
      }

      let lspSymbols = symbols.map(convertSymbol);

      let correctedPath = file.path;

      // fixup Windows path, for some reason the selector returns paths with lower case drive letters, everywhere else uses uppercase
      if (file.path.charAt(2) === ":") {
        correctedPath = file.path.charAt(0) + file.path.charAt(1).toUpperCase() + file.path.slice(2);
      }
      inner.add_file(correctedPath, lspSymbols);

      while (symbols.length > 0) {
        for await (const symbol of symbols) {
          if (![vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor, vscode.SymbolKind.Interface].includes(symbol.kind)) {
            continue;
          }

          let items: vscode.CallHierarchyItem[];
          try {
            items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', file, symbol.selectionRange.start);
          } catch (e) {
            vscode.window.showErrorMessage(`${e}\n${file}\n${symbol.name}`);
            continue;
          }

          for await (const item of items) {
            await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item)
              .then(outgoings => {
                inner.add_outgoing_calls(correctedPath, item.selectionRange.start, outgoings);
              })
              .then(undefined, err => {
                console.error(err);
              });
          }

          if (symbol.kind === vscode.SymbolKind.Interface) {
            await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>('vscode.executeImplementationProvider', file, symbol.selectionRange.start)
              .then(result => {
                if (result.length <= 0) {
                  return;
                }

                let locations: vscode.Location[];
                if (!(result[0] instanceof vscode.Location)) {
                  locations = result.map(l => {
                    let link = l as vscode.LocationLink;
                    return new vscode.Location(link.targetUri, link.targetSelectionRange ?? link.targetRange);
                  });
                } else {
                  locations = result as vscode.Location[];
                }
                inner.add_interface_implementations(correctedPath, symbol.selectionRange.start, locations);
              })
              .then(undefined, err => {
                console.log(err);
              });
          }
        }

        symbols = symbols.flatMap(symbol => symbol.children);
      }
    }

    const dot = inner.generate_dot_source();

    const uri = vscode.Uri.parse('crabviz:' + "graph.crabviz");
    vscode.workspace.openTextDocument(uri).then(document => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), dot);
      return vscode.workspace.applyEdit(edit).then(success => {
        if (success) {
          vscode.window.showTextDocument(document);
        } else {
          vscode.window.showInformationMessage("Error generating dot file!");
        }
      });
    });

    return graphviz.dot(dot);
  }
}

async function collectFileExtensions(
	folder: vscode.WorkspaceFolder,
	scanDirectories: string[],
	extensions: Set<string>,
	ignores: string[],
	token: vscode.CancellationToken
) {
	let files: vscode.Uri[];

	let paths = scanDirectories.map(dir => dir.length > 0 ? `${dir}/**/*.*` : `**/*.*`);
	const include = new vscode.RelativePattern(folder, `{${paths.join(',')}}`);
	let hiddenFiles: string[] = [];

	while (true) {
		let exclude = `{${Array.from(extensions).concat(ignoredExtensions).map(ext => `**/*.${ext}`).concat(ignores).concat(hiddenFiles).join(',')}}`;

		files = await vscode.workspace.findFiles(include, exclude, 1, token);
		if (files.length <= 0 || token.isCancellationRequested) {
			break;
		}

		const ext = path.extname(files[0].path).substring(1);
		if (ext.length > 0) {
			extensions.add(ext);
		} else {
			let relativePath = path.relative(folder.uri.path, files[0].path);
			hiddenFiles.push(relativePath);
		}
	}
}