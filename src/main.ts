import vscode = require('vscode');
import { LanguageClient } from 'vscode-languageclient/node';
import {
    CancellationToken,
    CloseAction,
    CompletionItemKind,
    ConfigurationParams,
    ConfigurationRequest,
    ErrorAction,
    ExecuteCommandSignature,
    HandleDiagnosticsSignature,
    InitializeError,
    Message,
    ProvideCodeLensesSignature,
    ProvideCompletionItemsSignature,
    ProvideDocumentFormattingEditsSignature,
    ResponseError,
    RevealOutputChannelOn
} from 'vscode-languageclient';

export async function activate(ctx: vscode.ExtensionContext) {
    try {
        const lc = await buildLanguageClient()
        lc.start()
        await lc.onReady();
    } catch (err) {
        vscode.window.showErrorMessage("error initializing templ LSP", err)
    }
}

export async function buildLanguageClient(): Promise<LanguageClient> {
    const documentSelector = [
        { language: 'templ', scheme: 'file' },
    ];

    const c = new LanguageClient(
        'templ', // id
        "templ", // name e.g. gopls
        {
            command: "templ",
            args: ['lsp'],
        },
        {
            documentSelector,
            uriConverters: {
                // Apply file:/// scheme to all file paths.
                code2Protocol: (uri: vscode.Uri): string =>
                    (uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
                protocol2Code: (uri: string) => vscode.Uri.parse(uri)
            },
            errorHandler: {
                error: (error: Error, message: Message, count: number): ErrorAction => {
                    // Allow 5 crashes before shutdown.
                    if (count < 5) {
                        return ErrorAction.Continue;
                    }
                    vscode.window.showErrorMessage(
                        `Error communicating with the language server: ${error}: ${message}.`
                    );
                    return ErrorAction.Shutdown;
                },
                closed: (): CloseAction => {
                    return CloseAction.DoNotRestart;
                }
            },
            middleware: {
                provideDocumentFormattingEdits: async (
                    document: vscode.TextDocument,
                    options: vscode.FormattingOptions,
                    token: vscode.CancellationToken,
                    next: ProvideDocumentFormattingEditsSignature
                ) => {
                    return next(document, options, token);
                },
                provideCompletionItem: async (
                    document: vscode.TextDocument,
                    position: vscode.Position,
                    context: vscode.CompletionContext,
                    token: vscode.CancellationToken,
                    next: ProvideCompletionItemsSignature
                ) => {
                    const list = await next(document, position, context, token);
                    if (!list) {
                        return list;
                    }
                    const items = Array.isArray(list) ? list : list.items;

                    // Give all the candidates the same filterText to trick VSCode
                    // into not reordering our candidates. All the candidates will
                    // appear to be equally good matches, so VSCode's fuzzy
                    // matching/ranking just maintains the natural "sortText"
                    // ordering. We can only do this in tandem with
                    // "incompleteResults" since otherwise client side filtering is
                    // important.
                    if (!Array.isArray(list) && list.isIncomplete && list.items.length > 1) {
                        let hardcodedFilterText = items[0].filterText;
                        if (!hardcodedFilterText) {
                            // tslint:disable:max-line-length
                            // According to LSP spec,
                            // https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_completion
                            // if filterText is falsy, the `label` should be used.
                            // But we observed that's not the case.
                            // Even if vscode picked the label value, that would
                            // cause to reorder candiates, which is not ideal.
                            // Force to use non-empty `label`.
                            // https://github.com/golang/vscode-go/issues/441
                            hardcodedFilterText = items[0].label;
                        }
                        for (const item of items) {
                            item.filterText = hardcodedFilterText;
                        }
                    }
                    // TODO(hyangah): when v1.42+ api is available, we can simplify
                    // language-specific configuration lookup using the new
                    // ConfigurationScope.
                    //    const paramHintsEnabled = vscode.workspace.getConfiguration(
                    //          'editor.parameterHints',
                    //          { languageId: 'go', uri: document.uri });
                    const editorParamHintsEnabled = vscode.workspace.getConfiguration(
                        'editor.parameterHints',
                        document.uri
                    )['enabled'];
                    const goParamHintsEnabled = vscode.workspace.getConfiguration('[go]', document.uri)[
                        'editor.parameterHints.enabled'
                    ];
                    let paramHintsEnabled = false;
                    if (typeof goParamHintsEnabled === 'undefined') {
                        paramHintsEnabled = editorParamHintsEnabled;
                    } else {
                        paramHintsEnabled = goParamHintsEnabled;
                    }
                    // If the user has parameterHints (signature help) enabled,
                    // trigger it for function or method completion items.
                    if (paramHintsEnabled) {
                        for (const item of items) {
                            if (item.kind === CompletionItemKind.Method || item.kind === CompletionItemKind.Function) {
                                item.command = {
                                    title: 'triggerParameterHints',
                                    command: 'editor.action.triggerParameterHints'
                                };
                            }
                        }
                    }
                    return list;
                },
                // Keep track of the last file change in order to not prompt
                // user if they are actively working.
                didOpen: (e, next) => {
                    next(e);
                },
                didChange: (e, next) => {
                    next(e);
                },
                didClose: (e, next) => {
                    next(e);
                },
                didSave: (e, next) => {
                    next(e);
                },
                workspace: {
                    configuration: async (
                        params: ConfigurationParams,
                        token: CancellationToken,
                        next: ConfigurationRequest.HandlerSignature
                    ): Promise<any[] | ResponseError<void>> => {
                        const configs = await next(params, token);
                        if (!configs || !Array.isArray(configs)) {
                            return configs;
                        }
                        const ret = [] as any[];
                        for (let i = 0; i < configs.length; i++) {
                            let workspaceConfig = configs[i];
                            if (!!workspaceConfig && typeof workspaceConfig === 'object') {
                                const scopeUri = params.items[i].scopeUri;
                                const resource = scopeUri ? vscode.Uri.parse(scopeUri) : undefined;
                                const section = params.items[i].section;
                            }
                            console.log(workspaceConfig)
                            ret.push(workspaceConfig);
                        }
                        return ret;
                    }
                }
            }
        }
    );
    return c;
}