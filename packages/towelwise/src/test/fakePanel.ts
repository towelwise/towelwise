import * as vscode from 'vscode';

// A page that records what is sent to it and lets the test send what the page would send.
export function fakePanel(events: string[]) {
  const posted: Array<Record<string, unknown>> = [];
  const listeners: Array<() => void> = [];
  let handler: ((message: unknown) => unknown) | undefined;
  const page = {
    posted,
    revealed: 0,
    disposed: false,
    send: (message: unknown) => handler?.(message),
    panel: {
      webview: {
        html: '',
        cspSource: 'test',
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: async (message: Record<string, unknown>) => void posted.push(message),
        onDidReceiveMessage: (h: (message: unknown) => unknown) => {
          handler = h;
          return { dispose() {} };
        },
      },
      reveal: () => {
        page.revealed++;
        events.push('reveal');
      },
      dispose: () => {
        if (page.disposed) return;
        page.disposed = true;
        listeners.splice(0).forEach((l) => l());
      },
      onDidDispose: (l: () => void) => {
        listeners.push(l);
        return { dispose() {} };
      },
      onDidChangeViewState: () => ({ dispose() {} }),
    },
  };
  return page;
}
