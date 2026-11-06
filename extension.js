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

function bracketRanges(lines) {
  const ranges = [];
  const open = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('}') || t.startsWith(']')) {
      const start = open.pop();
      if (i - 1 > start) ranges.push([start, i - 1]);
    }
    if (t.endsWith('{') || t.endsWith('[')) open.push(i);
  });
  return ranges;
}

function prettyLines(line) {
  if (!line.startsWith('{') && !line.startsWith('[')) return null;
  try {
    return prettify(line).trimEnd().split('\n');
  } catch {
    return null;
  }
}

function renderLines(text) {
  const out = [];
  const ranges = [];
  const records = [];
  for (const line of text.replace(/\r?\n$/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const body = prettyLines(trimmed);
    if (!body) {
      out.push(line);
      continue;
    }
    const start = out.length;
    if (body.length > 1) {
      ranges.push([start, start + body.length - 1]);
      for (const [a, b] of bracketRanges(body)) if (a > 0) ranges.push([start + a, start + b]);
      records.push({ start, rest: trimmed.slice(1) });
    }
    out.push(...body);
  }
  if (records.length === 0) throw new Error('No JSON found: neither the whole file nor any line is a JSON object or array');
  return { text: out.join('\n') + '\n', ranges, records, lines: true };
}

function render(text) {
  try {
    return { text: prettify(text), ranges: [], records: [], lines: false };
  } catch {
    return renderLines(text);
  }
}

function firstRecordFrom(records, line) {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].start < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function linesLanguage() {
  return (await vscode.languages.getLanguages()).includes('jsonl') ? 'jsonl' : 'plaintext';
}

function activate(context) {
  const changed = new vscode.EventEmitter();
  const views = new Map();
  const provider = {
    onDidChange: changed.event,
    async provideTextDocumentContent(uri) {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri.query, true));
      const view = render(new TextDecoder().decode(bytes));
      views.set(uri.toString(), view);
      return view.text;
    },
  };
  const folding = {
    provideFoldingRanges(document) {
      const view = views.get(document.uri.toString());
      return view ? view.ranges.map(([start, end]) => new vscode.FoldingRange(start, end)) : [];
    },
  };
  const collapsedLine = vscode.window.createTextEditorDecorationType({});
  const folded = new Map();

  function decorate(editor) {
    const key = editor.document.uri.toString();
    const view = views.get(key);
    if (!view || !view.lines) return;
    if (!folded.has(key)) folded.set(key, new Map());
    const state = folded.get(key);
    const visible = editor.visibleRanges;
    const decorations = [];
    visible.forEach((range, i) => {
      for (let k = firstRecordFrom(view.records, range.start.line); k < view.records.length; k++) {
        const { start, rest } = view.records[k];
        if (start > range.end.line) break;
        if (start < range.end.line) state.set(start, false);
        else if (i + 1 < visible.length) state.set(start, visible[i + 1].start.line > start + 1);
        if (state.get(start) ?? true) {
          decorations.push({ range: editor.document.lineAt(start).range, renderOptions: { after: { contentText: rest } } });
        }
      }
    });
    editor.setDecorations(collapsedLine, decorations);
  }

  async function replaceActiveTab(document) {
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    await vscode.window.showTextDocument(document, { viewColumn: group.viewColumn, preview: false });
    if (tab && !tab.isDirty) await vscode.window.tabGroups.close(tab);
  }

  async function toggle() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    if (uri.scheme === SCHEME) {
      await replaceActiveTab(await vscode.workspace.openTextDocument(vscode.Uri.parse(uri.query, true)));
      return;
    }
    const target = vscode.Uri.from({ scheme: SCHEME, path: uri.path, query: uri.toString() });
    changed.fire(target);
    let document = await vscode.workspace.openTextDocument(target);
    const view = views.get(target.toString());
    document = await vscode.languages.setTextDocumentLanguage(document, view.lines ? await linesLanguage() : 'json');
    await replaceActiveTab(document);
    if (view.lines) await vscode.commands.executeCommand('editor.foldLevel1');
  }

  function refresh() {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === SCHEME) changed.fire(editor.document.uri);
  }

  context.subscriptions.push(
    changed,
    collapsedLine,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.languages.registerFoldingRangeProvider({ scheme: SCHEME }, folding),
    vscode.commands.registerCommand('jsonPretty.toggle', toggle),
    vscode.commands.registerCommand('jsonPretty.refresh', refresh),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refresh();
      if (editor) decorate(editor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => decorate(e.textEditor)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      for (const editor of vscode.window.visibleTextEditors) if (editor.document === e.document) decorate(editor);
    }),
  );
}

module.exports = { activate, prettify, render };
