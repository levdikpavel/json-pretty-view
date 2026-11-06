const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? {} : load.call(this, request, ...rest);
};
const { prettify, render, stringAt, stringHover } = require('../extension.js');

test('formats nested structures and keeps empty containers inline', () => {
  assert.strictEqual(
    prettify('{"a":{"b":[1,2]},"c":{},"d":[ ]}'),
    '{\n  "a": {\n    "b": [\n      1,\n      2\n    ]\n  },\n  "c": {},\n  "d": []\n}\n',
  );
});

test('keeps number literals, key order and duplicate keys as written', () => {
  assert.strictEqual(
    prettify('{"n":18446744073709551615,"f":1.50e+3,"k":1,"k":2}'),
    '{\n  "n": 18446744073709551615,\n  "f": 1.50e+3,\n  "k": 1,\n  "k": 2\n}\n',
  );
});

test('does not touch structural characters inside strings', () => {
  assert.strictEqual(
    prettify('{"s":"a,{b}:[c] \\"d\\\\"}'),
    '{\n  "s": "a,{b}:[c] \\"d\\\\"\n}\n',
  );
});

test('is idempotent', () => {
  const once = prettify('[[1,[2,{}]],{"k":[{"x":null}]}]');
  assert.strictEqual(prettify(once), once);
});

test('rejects invalid JSON', () => {
  assert.throws(() => prettify('{"a":'), SyntaxError);
});

test('renders a whole JSON document without own folding ranges', () => {
  assert.deepStrictEqual(render('{"a":1}'), { text: '{\n  "a": 1\n}\n', ranges: [], records: [], lines: false });
});

test('renders JSON lines as foldable pretty records with the rest of the original line', () => {
  const view = render('{"a":1,"b":{"c":2}}\nplain text\r\n[1]\n{}\n{"broken":\n');
  assert.strictEqual(
    view.text,
    ['{', '  "a": 1,', '  "b": {', '    "c": 2', '  }', '}', 'plain text', '[', '  1', ']', '{}', '{"broken":', ''].join('\n'),
  );
  assert.strictEqual(view.lines, true);
  assert.deepStrictEqual(view.ranges, [
    [0, 5],
    [2, 3],
    [7, 9],
  ]);
  assert.deepStrictEqual(view.records, [
    { start: 0, rest: '"a":1,"b":{"c":2}}' },
    { start: 7, rest: '1]' },
  ]);
});

test('finds the string token under the cursor, honouring escaped quotes', () => {
  const line = '  "msg": "say \\"hi\\"", "n": 1';
  assert.deepStrictEqual(stringAt(line, 12), { start: 9, end: 21, raw: '"say \\"hi\\""' });
  assert.deepStrictEqual(stringAt(line, 3), { start: 2, end: 7, raw: '"msg"' });
  assert.strictEqual(stringAt(line, 28), null);
});

test('hover shows escaped text decoded and nested JSON formatted', () => {
  assert.strictEqual(stringHover('"a\\n\\tb"'), '```text\na\n\tb\n```');
  assert.strictEqual(
    stringHover('"{\\"id\\":9007199254740993}"'),
    '```json\n{\n  "id": 9007199254740993\n}\n```',
  );
  assert.strictEqual(stringHover('"x ```\\ny"'), '````text\nx ```\ny\n````');
});

test('hover is skipped when decoding changes nothing', () => {
  assert.strictEqual(stringHover('"plain"'), null);
  assert.strictEqual(stringHover('"unterminated'), null);
});

test('rejects text without any JSON', () => {
  assert.throws(() => render('just\na log\n'), /No JSON found/);
});
