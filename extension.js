const vscode = require('vscode');

const SCHEME = 'jsonpretty';
const INDENT = '  ';

function prettify(text) {
  JSON.parse(text);
  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => '\n' + INDENT.repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    switch (c) {
      case '"':
        inString = true;
        out += c;
        break;
      case '{':
      case '[': {
        const close = c === '{' ? '}' : ']';
        let j = i + 1;
        while (' \t\n\r'.includes(text[j])) j++;
        if (text[j] === close) {
          out += c + close;
          i = j;
        } else {
          depth++;
          out += c + newline();
        }
        break;
      }
      case '}':
      case ']':
        depth--;
        out += newline() + c;
        break;
      case ',':
        out += ',' + newline();
        break;
      case ':':
        out += ': ';
        break;
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        break;
      default:
        out += c;
    }
  }
  return out + '\n';
}

function activate(context) {
  const changed = new vscode.EventEmitter();
  const provider = {
    onDidChange: changed.event,
    async provideTextDocumentContent(uri) {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri.query, true));
      return prettify(new TextDecoder().decode(bytes));
    },
  };

  async function replaceActiveTab(target) {
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    const editor = await vscode.window.showTextDocument(target, { viewColumn: group.viewColumn, preview: false });
    if (tab && !tab.isDirty) await vscode.window.tabGroups.close(tab);
    return editor;
  }

  async function toggle() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    if (uri.scheme === SCHEME) {
      await replaceActiveTab(vscode.Uri.parse(uri.query, true));
      return;
    }
    const target = vscode.Uri.from({ scheme: SCHEME, path: uri.path, query: uri.toString() });
    changed.fire(target);
    const shown = await replaceActiveTab(target);
    if (shown.document.languageId !== 'json') await vscode.languages.setTextDocumentLanguage(shown.document, 'json');
  }

  function refresh() {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === SCHEME) changed.fire(editor.document.uri);
  }

  context.subscriptions.push(
    changed,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('jsonPretty.toggle', toggle),
    vscode.commands.registerCommand('jsonPretty.refresh', refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
  );
}

module.exports = { activate, prettify };
