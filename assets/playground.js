(() => {
"use strict";

/* KH interpreter adapted from PlainStep 0.1. */
function runKh(source, host) {
  const output = [];
  const keywords = new Set(["say", "if", "else", "repeat", "end", "function", "return", "true", "false", "and", "or", "not"]);
  const precedence = new Map([
    ["or", 1], ["and", 2],
    ["==", 4], ["!=", 4],
    ["<", 5], ["<=", 5], [">", 5], [">=", 5],
    ["+", 6], ["-", 6],
    ["*", 7], ["/", 7], ["%", 7]
  ]);
  const identifierPattern = /[\p{ID_Start}_][\p{ID_Continue}_]*/uy;
  const numberPattern = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/y;
  const sourceLimit = 200000;
  const tokenLimit = 256;
  const blockLimit = 40;
  const expressionLimit = 40;
  const callLimit = 30;
  const runtimeDepthLimit = 180;
  const stepLimit = 50000;
  const repeatLimit = 10000;
  const stringLimit = 100000;
  const outputLengthLimit = 400000;
  const outputLineLimit = 5000;

  class PlainError extends Error {
    constructor(token, message) {
      super(message);
      this.line = token.line;
      this.column = token.column;
    }
  }

  function fail(token, message) {
    throw new PlainError(token, message);
  }

  function tokenize(lineText, line) {
    const tokens = [];
    let index = 0;

    while (index < lineText.length) {
      const character = lineText[index];
      if (/\s/u.test(character)) {
        index++;
        continue;
      }
      if (character === "#") break;

      const location = { line, column: index + 1 };
      if (tokens.length >= tokenLimit) {
        fail(location, "This line is too long. Split the expression across separate assignments.");
      }

      if (character === '"') {
        const start = index++;
        while (index < lineText.length && lineText[index] !== '"') {
          if (lineText[index] === "\\") index++;
          index++;
        }
        if (index >= lineText.length) fail(location, 'Close this text with a double quote (").');

        const text = lineText.slice(start, ++index);
        let value;
        try {
          value = JSON.parse(text);
        } catch {
          fail(location, "This text contains an invalid escape or control character.");
        }
        tokens.push({ ...location, kind: "literal", value });
        continue;
      }

      numberPattern.lastIndex = index;
      const number = numberPattern.exec(lineText);
      if (number) {
        const value = Number(number[0]);
        if (!Number.isFinite(value)) fail(location, "This number is too large.");
        tokens.push({ ...location, kind: "literal", value });
        index = numberPattern.lastIndex;
        continue;
      }

      identifierPattern.lastIndex = index;
      const identifier = identifierPattern.exec(lineText);
      if (identifier) {
        const value = identifier[0];
        const kind = keywords.has(value) ? "keyword" : "name";
        tokens.push({ ...location, kind, value });
        index = identifierPattern.lastIndex;
        continue;
      }

      const pair = lineText.slice(index, index + 2);
      if (pair === "==" || pair === "!=" || pair === "<=" || pair === ">=") {
        tokens.push({ ...location, kind: "symbol", value: pair });
        index += 2;
        continue;
      }
      if ("=+-*/%()<>,\"".includes(character)) {
        tokens.push({ ...location, kind: "symbol", value: character });
        index++;
        continue;
      }

      const invalid = String.fromCodePoint(lineText.codePointAt(index));
      fail(location, `Unexpected character ${JSON.stringify(invalid)}.`);
    }

    tokens.push({ kind: "line-end", line, column: index + 1 });
    return tokens;
  }

  class LineParser {
    constructor(tokens) {
      this.tokens = tokens;
      this.index = 0;
    }

    peek() {
      return this.tokens[this.index];
    }

    take() {
      const token = this.peek();
      if (token.kind !== "line-end") this.index++;
      return token;
    }

    match(value) {
      const token = this.peek();
      if (token.kind === "literal" || token.value !== value) return false;
      this.take();
      return true;
    }

    expect(value, message) {
      if (!this.match(value)) fail(this.peek(), message);
    }

    name(message) {
      const token = this.take();
      if (token.kind !== "name") fail(token, message);
      return token;
    }

    finish() {
      const token = this.peek();
      if (token.kind !== "line-end") {
        const message = token.kind === "symbol" && token.value === "="
          ? "Use == to compare values. Use = to assign a variable."
          : "There is extra text at the end of this line.";
        fail(token, message);
      }
    }

    expression(minimum = 1, depth = 0) {
      if (depth > expressionLimit) fail(this.peek(), "This expression is nested too deeply.");
      let left = this.primary(depth);

      while (this.peek().kind === "symbol" || this.peek().kind === "keyword") {
        const priority = precedence.get(this.peek().value);
        if (priority === undefined || priority < minimum) break;
        const token = this.take();
        const right = this.expression(priority + 1, depth + 1);
        left = { kind: "binary", token, left, right };
      }

      return left;
    }

    primary(depth) {
      const token = this.take();
      if (token.kind === "literal") return { kind: "literal", token, value: token.value };
      if (token.kind === "name") {
        return this.match("(")
          ? this.call(token, depth)
          : { kind: "variable", token };
      }
      if (token.kind === "keyword" && (token.value === "true" || token.value === "false")) {
        return { kind: "literal", token, value: token.value === "true" };
      }
      if (token.kind === "keyword" && token.value === "not") {
        return { kind: "unary", token, operand: this.expression(3, depth + 1) };
      }
      if (token.kind === "symbol" && (token.value === "-" || token.value === "+")) {
        return { kind: "unary", token, operand: this.expression(8, depth + 1) };
      }
      if (token.kind === "symbol" && token.value === "(") {
        const nested = this.expression(1, depth + 1);
        this.expect(")", "Close this expression with ).");
        return nested;
      }
      fail(token, "Expected a number, text in double quotes, a variable, or a function call.");
    }

    call(token, depth = 0) {
      const args = [];
      if (!this.match(")")) {
        do {
          args.push(this.expression(1, depth + 1));
        } while (this.match(","));
        this.expect(")", "Close the function call with ). Separate arguments with commas.");
      }
      return { kind: "call", token, args };
    }

    parameters() {
      this.expect("(", "Put the function's parameter names inside parentheses, even when empty.");
      const names = new Set();
      if (!this.match(")")) {
        do {
          const parameter = this.name("Expected a parameter name.");
          if (names.has(parameter.value)) {
            fail(parameter, `The parameter "${parameter.value}" appears more than once.`);
          }
          names.add(parameter.value);
        } while (this.match(","));
        this.expect(")", "Close the parameter list with ). Separate parameter names with commas.");
      }
      return [...names];
    }

    statement() {
      const token = this.take();
      let statement;

      if (token.kind === "keyword") {
        switch (token.value) {
          case "say":
            statement = { kind: "say", token, value: this.expression() };
            break;
          case "if":
            statement = { kind: "if", token, condition: this.expression(), body: [], alternate: [] };
            break;
          case "repeat":
            statement = { kind: "repeat", token, count: this.expression(), body: [] };
            break;
          case "function":
            statement = {
              kind: "function",
              token,
              name: this.name("Expected a function name after function."),
              parameters: this.parameters(),
              body: []
            };
            break;
          case "return":
            statement = {
              kind: "return",
              token,
              value: this.peek().kind === "line-end" ? null : this.expression()
            };
            break;
          case "else":
          case "end":
            statement = { kind: token.value, token };
            break;
        }
      } else if (token.kind === "name") {
        if (this.match("=")) {
          statement = { kind: "assign", token, value: this.expression() };
        } else if (this.match("(")) {
          statement = this.call(token);
        }
      }

      if (!statement) {
        fail(token, "Start the line with a command such as say, a variable assignment, or a function call.");
      }
      this.finish();
      return statement;
    }
  }

  function parse() {
    const statements = [];
    const functions = new Map();
    const frames = [{ body: statements, insideFunction: false }];
    const lines = source.split(/\r\n|\n|\r/);

    for (const [index, lineText] of lines.entries()) {
      const tokens = tokenize(lineText, index + 1);
      if (tokens.length === 1) continue;

      const statement = new LineParser(tokens).statement();
      const frame = frames[frames.length - 1];

      switch (statement.kind) {
        case "else":
          if (frame.statement?.kind !== "if" || frame.body === frame.statement.alternate) {
            fail(statement.token, "else must be inside an if block and can appear there only once.");
          }
          frame.body = frame.statement.alternate;
          break;

        case "end":
          if (frames.length === 1) fail(statement.token, "This end has no matching if, repeat, or function.");
          frames.pop();
          break;

        case "function":
          if (frames.length !== 1) fail(statement.token, "Define functions outside other blocks.");
          if (functions.has(statement.name.value)) {
            fail(statement.name, `The function "${statement.name.value}" is already defined.`);
          }
          functions.set(statement.name.value, statement);
          frames.push({ statement, body: statement.body, insideFunction: true });
          break;

        case "if":
        case "repeat":
          if (frames.length > blockLimit) fail(statement.token, "These blocks are nested too deeply.");
          frame.body.push(statement);
          frames.push({ statement, body: statement.body, insideFunction: frame.insideFunction });
          break;

        case "return":
          if (!frame.insideFunction) fail(statement.token, "return can only appear inside a function.");
          frame.body.push(statement);
          break;

        default:
          frame.body.push(statement);
      }
    }

    const unclosed = frames[frames.length - 1].statement;
    if (unclosed) fail(unclosed.token, `Add an end to close this ${unclosed.kind} block.`);
    return { statements, functions };
  }

  function execute(program) {
    const globals = new Map();
    let steps = 0;
    let outputLength = 0;

    function step(token, depth) {
      if (depth > runtimeDepthLimit) fail(token, "This expression or block is nested too deeply at runtime.");
      if (++steps > stepLimit) fail(token, "The program has reached its execution limit. Try fewer repeats or calls.");
    }

    function display(value) {
      return String(value);
    }

    function requireNumber(value, token) {
      if (typeof value !== "number") fail(token, `${token.value} needs numbers on both sides of the operator.`);
    }

    function numericResult(value, token) {
      if (!Number.isFinite(value)) fail(token, "The calculation is outside the supported number range.");
      return value;
    }

    function binary(token, left, right) {
      switch (token.value) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "+":
          if (typeof left === "string" || typeof right === "string") {
            const leftText = display(left);
            const rightText = display(right);
            if (leftText.length + rightText.length > stringLimit) fail(token, "The joined text is too long.");
            return leftText + rightText;
          }
          break;
      }

      requireNumber(left, token);
      requireNumber(right, token);
      switch (token.value) {
        case "+": return numericResult(left + right, token);
        case "-": return numericResult(left - right, token);
        case "*": return numericResult(left * right, token);
        case "/":
          if (right === 0) fail(token, "Cannot divide by zero.");
          return numericResult(left / right, token);
        case "%":
          if (right === 0) fail(token, "Cannot find a remainder with zero.");
          return left % right;
        case "<": return left < right;
        case "<=": return left <= right;
        case ">": return left > right;
        case ">=": return left >= right;
      }
    }

    function call(node, variables, depth, calls) {
      const name = node.token.value;
      const definition = program.functions.get(name);
      if (!definition) {
        if (!host?.has(name)) fail(node.token, `The function "${name}" is not defined.`);
        const args = node.args.map(argument => evaluate(argument, variables, depth + 1, calls));
        try {
          host.get(name)(args);
        } catch (error) {
          fail(node.token, error.message);
        }
        return null;
      }

      const expected = definition.parameters.length;
      if (node.args.length !== expected) {
        const label = expected === 1 ? "argument" : "arguments";
        fail(node.token, `"${name}" expects ${expected} ${label}, but received ${node.args.length}.`);
      }
      if (calls >= callLimit) fail(node.token, "The function call limit was reached. Check for repeated self-calls.");

      const locals = new Map();
      for (const [index, argument] of node.args.entries()) {
        locals.set(definition.parameters[index], evaluate(argument, variables, depth + 1, calls));
      }

      const returned = executeBlock(definition.body, locals, depth + 1, calls + 1);
      return returned ? returned.value : null;
    }

    function evaluate(node, variables, depth, calls) {
      step(node.token, depth);
      switch (node.kind) {
        case "literal":
          return node.value;
        case "variable":
          if (variables.has(node.token.value)) return variables.get(node.token.value);
          if (globals.has(node.token.value)) return globals.get(node.token.value);
          fail(node.token, `The variable "${node.token.value}" has no value yet. Set it with = first.`);
          break;
        case "unary": {
          const operand = evaluate(node.operand, variables, depth + 1, calls);
          if (node.token.value === "not") {
            if (typeof operand !== "boolean") fail(node.token, "not needs a true or false value.");
            return !operand;
          }
          if (typeof operand !== "number") fail(node.token, `${node.token.value} needs a number after it.`);
          return node.token.value === "-" ? -operand : operand;
        }
        case "binary": {
          const left = evaluate(node.left, variables, depth + 1, calls);
          const operator = node.token.value;
          if (operator === "and" || operator === "or") {
            if (typeof left !== "boolean") fail(node.token, operator + " needs true or false values.");
            if (operator === "and" ? !left : left) return left;
            const right = evaluate(node.right, variables, depth + 1, calls);
            if (typeof right !== "boolean") fail(node.token, operator + " needs true or false values.");
            return right;
          }
          const right = evaluate(node.right, variables, depth + 1, calls);
          return binary(node.token, left, right);
        }
        case "call":
          return call(node, variables, depth, calls);
      }
    }

    function executeBlock(statements, variables, depth, calls) {
      for (const statement of statements) {
        const token = statement.token;
        step(token, depth);
        switch (statement.kind) {
          case "say": {
            const text = display(evaluate(statement.value, variables, depth + 1, calls));
            outputLength += text.length + 1;
            if (output.length >= outputLineLimit || outputLength > outputLengthLimit) {
              fail(token, "The output is too large. Try using fewer say commands.");
            }
            output.push(text);
            break;
          }
          case "assign":
            variables.set(token.value, evaluate(statement.value, variables, depth + 1, calls));
            break;
          case "if": {
            const condition = evaluate(statement.condition, variables, depth + 1, calls);
            if (typeof condition !== "boolean") fail(token, "if needs a condition that gives true or false.");
            const branch = condition ? statement.body : statement.alternate;
            const returned = executeBlock(branch, variables, depth + 1, calls);
            if (returned) return returned;
            break;
          }
          case "repeat": {
            const count = evaluate(statement.count, variables, depth + 1, calls);
            if (!Number.isInteger(count) || count < 0 || count > repeatLimit) {
              fail(token, `repeat needs a whole number from 0 to ${repeatLimit.toLocaleString("en-US")}.`);
            }
            for (let index = 0; index < count; index++) {
              step(token, depth);
              const returned = executeBlock(statement.body, variables, depth + 1, calls);
              if (returned) return returned;
            }
            break;
          }
          case "return": {
            const value = statement.value ? evaluate(statement.value, variables, depth + 1, calls) : null;
            return { value };
          }
          case "call":
            call(statement, variables, depth, calls);
            break;
        }
      }
    }

    executeBlock(program.statements, globals, 0, 0);
  }

  try {
    if (typeof source !== "string") fail({ line: 1, column: 1 }, "Expected PlainStep source code as text.");
    if (source.length > sourceLimit) fail({ line: 1, column: 1 }, "This program is too large to run here.");
    execute(parse());
    return { output, error: null };
  } catch (error) {
    if (!(error instanceof PlainError)) throw error;
    return { output, error: { line: error.line, column: error.column, message: error.message } };
  }
}

const examples = {
  web: [
    'theme("#508b75")',
    'サイト名 = "森のアトリエ"',
    'page(サイト名, "手を動かし、季節をつくる。")',
    '',
    'section("今月のワークショップ")',
    'text("落ち葉でつくる、小さなポストカード。")',
    'button("持ち物を見る", "汚れてもよい服と、持ち帰り用の袋。")',
    'section_end()',
    '',
    'link("アトリエについて", "about.html")',
    'page("about.html", "アトリエについて", "自然の素材を使う、小さな制作室。")',
    'link("トップに戻る", "index.html")'
  ].join("\n"),
  console: [
    'function 挨拶(名前)',
    '    return "Hello, " + 名前 + "!"',
    'end',
    '',
    'say 挨拶("KH")',
    '番号 = 1',
    'repeat 3',
    '    say "実行 " + 番号 + " 回目"',
    '    番号 = 番号 + 1',
    'end'
  ].join("\n")
};

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = value => value.replace(/[&<>"']/g, character => entities[character]);

const previewStyles = [
  '*{box-sizing:border-box}',
  'html,body{min-height:100%;margin:0}',
  'body{font:15px/1.65 system-ui,"Yu Gothic UI",sans-serif;color:#23352d;background:#f5f6ef;overflow-wrap:anywhere}',
  'article[hidden],p[hidden]{display:none}',
  'header{border-top:4px solid var(--accent);padding:clamp(18px,5vw,34px) clamp(16px,5vw,36px) 21px;background:#fff}',
  'header p{margin:7px 0 0;color:#495a51}',
  'h1,h2,h3{margin:0;font-weight:750;line-height:1.25}',
  'h1{font-size:clamp(25px,6vw,42px);letter-spacing:-.04em}',
  'h2{font-size:18px}',
  'h3{font-size:16px}',
  'main{padding:clamp(14px,4vw,24px) clamp(16px,5vw,36px) 28px}',
  'main>p:first-child{margin-top:0}',
  'section{padding:clamp(14px,4vw,21px);margin:0 0 13px;border:1px solid #dce3d8;border-radius:12px;background:#fff}',
  'section section{margin-top:14px}',
  'section>p{margin:9px 0}',
  'button{font:inherit;font-weight:700;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);padding:6px 13px;border-radius:7px;cursor:pointer}',
  'a{color:#1e5441;font-weight:700;text-underline-offset:3px}',
  ':focus-visible{outline:2px solid #226491;outline-offset:3px}',
  '.result{white-space:pre-wrap;color:#2c483b}',
  '.console{background:#141c20;color:#d3f2df;min-height:100vh;padding:22px}',
  'pre{font:14px/1.7 ui-monospace,Consolas,monospace;margin:0;white-space:pre-wrap}'
].join("");

const previewBehavior = [
  'document.addEventListener("click", (event) => {',
  '  const button = event.target.closest("button[data-message]");',
  '  if (button) {',
  '    const output = button.nextElementSibling;',
  '    output.textContent = button.dataset.message;',
  '    output.hidden = false;',
  '    return;',
  '  }',
  '  const link = event.target.closest("a[data-page-link]");',
  '  if (!link) return;',
  '  const pages = [...document.querySelectorAll("[data-page]")];',
  '  const target = pages.find((page) => page.dataset.page === link.dataset.pageLink);',
  '  if (!target) return;',
  '  event.preventDefault();',
  '  pages.forEach((page) => { page.hidden = page !== target; });',
  '  window.scrollTo(0, 0);',
  '  target.querySelector("h1").focus();',
  '});'
].join("\n");

function accentInk(color) {
  const channels = color.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000" : "#fff";
}

function documentPreview(content, accent, language = "ja", title = "KH コンソール", description = "") {
  return [
    '<!doctype html><html lang="' + language + '"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-a2gtd2Vi&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<style>:root{--accent:' + accent + ';--accent-ink:' + accentInk(accent) + '}' + previewStyles + '</style>',
    '</head><body>', content,
    '<script nonce="a2gtd2Vi">' + previewBehavior + '</script>',
    '</body></html>'
  ].join("");
}

function websiteHost() {
  const pages = new Map();
  let current;
  let accent = "#176b58";
  let language = "ja";
  let bytes = 0;
  const host = new Map();

  function fail(message) {
    throw new Error(message);
  }

  function addCommand(name, min, max, run) {
    host.set(name, args => {
      if (args.length < min || args.length > max || args.some(arg => typeof arg !== "string")) {
        fail(name + " に渡す文字列の個数を確認してください。");
      }
      if (args.some(arg => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(arg))) {
        fail("ウェブ用の文字列に制御文字は使えません。");
      }
      run(...args);
    });
  }

  function body() {
    if (!current) fail("先に page() でページを作成してください。");
    return current;
  }

  function append(markup) {
    const page = body();
    bytes += markup.length;
    if (bytes > 300000 || page.fragments.length >= 2000) fail("プレビューの出力上限に達しました。");
    page.fragments.push(markup);
  }

  addCommand("theme", 1, 1, color => {
    if (!/^#[\da-f]{6}$/i.test(color)) fail('色は "#508b75" のように指定します。');
    accent = color;
  });

  addCommand("language", 1, 1, value => {
    if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value) || value.length > 23) {
      fail('言語は "ja" のように指定します。');
    }
    language = value;
  });

  addCommand("page", 2, 3, (...args) => {
    if (current?.depth) fail("次のページを作る前に section_end() で区切ってください。");
    const [filename, title, description] = args.length === 2 ? ["index.html", ...args] : args;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,58}\.html$/.test(filename) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\.html$/i.test(filename)) {
      fail('ページ名は "about.html" のように指定します。');
    }
    const key = filename.toLowerCase();
    const encoder = new TextEncoder();
    if (!title || encoder.encode(title).length > 400 || encoder.encode(description).length > 1000) {
      fail("ページ名と短い説明を指定してください。");
    }
    if (pages.has(key)) fail("同じページ名がすでに使われています。");
    if (pages.size >= 24) fail("ページを24個まで作成できます。");
    current = { filename, title, description, depth: 0, fragments: [] };
    pages.set(key, current);
  });

  addCommand("heading", 1, 1, title => {
    const tag = body().depth ? "h3" : "h2";
    append("<" + tag + ">" + escapeHtml(title) + "</" + tag + ">");
  });
  addCommand("text", 1, 1, value => append("<p>" + escapeHtml(value) + "</p>"));
  addCommand("section", 1, 1, title => {
    const page = body();
    if (page.depth >= 12) fail("セクションの入れ子が深すぎます。");
    const tag = page.depth ? "h3" : "h2";
    append("<section><" + tag + ">" + escapeHtml(title) + "</" + tag + ">");
    page.depth++;
  });
  addCommand("section_end", 0, 0, () => {
    const page = body();
    if (!page.depth) fail("先に section() を使ってください。");
    append("</section>");
    page.depth--;
  });
  addCommand("button", 2, 2, (label, message) => {
    append('<div><button type="button" data-message="' + escapeHtml(message) + '">' +
      escapeHtml(label) + '</button><p class="result" role="status" hidden></p></div>');
  });
  addCommand("link", 2, 2, (label, url) => {
    if (!url || url.length > 4096 || /[\\\x00-\x20\x7f]/.test(url) || /^\/\//.test(url) ||
        (/^[^/?#]*:/.test(url) && !/^(https?:\/\/[^/]|mailto:.+)/i.test(url))) {
      fail("有効なリンクを指定してください。");
    }
    const localPage = url.match(/^(?:\.\/)?([A-Za-z0-9][A-Za-z0-9_-]{0,58}\.html)(?:[?#].*)?$/);
    if (localPage) {
      append('<p><a href="' + escapeHtml(url) + '" data-page-link="' +
        escapeHtml(localPage[1]) + '">' + escapeHtml(label) + "</a></p>");
    } else {
      append('<p><a href="' + escapeHtml(url) + '">' + escapeHtml(label) + "</a></p>");
    }
  });

  for (const desktopOnly of ["css", "script", "image"]) {
    host.set(desktopOnly, () => fail(desktopOnly + "() はデスクトップ版IDEで使えます。"));
  }

  return {
    host,
    render() {
      const home = pages.get("index.html");
      if (home?.filename !== "index.html") fail("page() でトップページを作成してください。");
      if (current?.depth) fail("section_end() でセクションを閉じてください。");
      const content = [...pages.values()].map(page => {
        const visibility = page.filename === "index.html" ? "" : " hidden";
        return '<article data-page="' + escapeHtml(page.filename) + '"' + visibility +
          '><header><h1 tabindex="-1">' + escapeHtml(page.title) + "</h1>" +
          (page.description ? "<p>" + escapeHtml(page.description) + "</p>" : "") +
          "</header><main>" + page.fragments.join("") + "</main></article>";
      }).join("");
      return documentPreview(content, accent, language, home.title, home.description);
    }
  };
}

const source = document.querySelector("#kh-source");
const preview = document.querySelector("#kh-result");
if (!source || !preview) return;

const diagnostic = document.querySelector("#kh-diagnostic");
const lineNumbers = document.querySelector("#kh-lines");
const modeLabel = document.querySelector("#kh-mode");
const tabs = [...document.querySelectorAll("[data-example]")];
const fileInput = document.querySelector("#kh-file");
const editorPanel = document.querySelector("#kh-editor");
const documents = {
  web: { source: examples.web, filename: "index.kh" },
  console: { source: examples.console, filename: "hello.kh" }
};
let mode = "web";

function setStatus(message, error = false) {
  if (!diagnostic) return;
  diagnostic.textContent = message;
  diagnostic.dataset.state = error ? "error" : "ready";
}

function alignGutter() {
  if (lineNumbers) lineNumbers.scrollTop = source.scrollTop;
}

function showLineNumbers() {
  if (!lineNumbers) return;
  const lines = Math.min(source.value.split("\n").length, 1000);
  lineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
  alignGutter();
}

function showConsole(output) {
  preview.srcdoc = documentPreview('<main class="console"><pre>' + escapeHtml(output) + "</pre></main>", "#176b58");
}

function run() {
  if (mode === "web") {
    const includeLine = source.value.split(/\r\n|\n|\r/).findIndex(line => /^\s*use\s+"/.test(line));
    if (includeLine !== -1) {
      setStatus((includeLine + 1) + " 行 · 関連 .kh の読み込みはデスクトップ版IDEやCLIで使えます。", true);
      return null;
    }
  }
  const website = mode === "web" ? websiteHost() : null;
  const result = runKh(source.value, website?.host);
  if (!website) showConsole(result.output.join("\n") || "出力はありません。");
  if (result.error) {
    setStatus(result.error.line + " 行 " + result.error.column + " 列 · " + result.error.message, true);
    return null;
  }
  let html = null;
  if (website) {
    try {
      html = website.render();
      preview.srcdoc = html;
    } catch (error) {
      setStatus(error.message, true);
      return null;
    }
  }
  setStatus(website ? "HTML プレビューを更新しました。" : "実行完了");
  return html;
}

function selectMode(name) {
  if (!Object.hasOwn(examples, name)) return;
  mode = name;
  for (const tab of tabs) {
    const active = tab.dataset.example === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    if (tab.getAttribute("role") === "tab") tab.tabIndex = active ? 0 : -1;
    if (active && tab.id && editorPanel) editorPanel.setAttribute("aria-labelledby", tab.id);
  }
  if (modeLabel) modeLabel.textContent = name === "web" ? "HTML PREVIEW" : "CONSOLE";
  source.value = documents[name].source;
  source.scrollTop = 0;
  source.scrollLeft = 0;
  showLineNumbers();
  run();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectMode(tab.dataset.example));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || tabs.length < 2) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
      (index + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length;
    selectMode(tabs[next].dataset.example);
    tabs[next].focus();
  });
}
preview.setAttribute("sandbox", "allow-scripts");
document.querySelector("#kh-run")?.addEventListener("click", run);
document.querySelector("#kh-reset")?.addEventListener("click", () => {
  documents[mode] = { source: examples[mode], filename: mode === "web" ? "index.kh" : "hello.kh" };
  selectMode(mode);
});
document.querySelector("#kh-open")?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", async () => {
  const [file] = fileInput.files ?? [];
  fileInput.value = "";
  if (!file) return;
  if (!/\.kh$/i.test(file.name) || file.size > 800000) {
    setStatus("800 KB 以下の .kh ファイルを選んでください。", true);
    return;
  }
  const destination = mode;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (text.length > 200000 || text.includes("\0")) {
      setStatus("200,000 文字以内の UTF-8 テキストを選んでください。", true);
      return;
    }
    documents[destination] = { source: text, filename: file.name };
    if (destination === mode) selectMode(destination);
  } catch {
    setStatus("UTF-8 の .kh ファイルを読み込めませんでした。", true);
  }
});

function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#kh-save")?.addEventListener("click", () => {
  downloadText(documents[mode].filename, source.value, "text/plain");
  setStatus(".kh ファイルを保存しました。");
});
document.querySelector("#kh-export")?.addEventListener("click", () => {
  if (mode !== "web") {
    setStatus("「Webサイト」タブで HTML を保存できます。", true);
    return;
  }
  const html = run();
  if (!html) return;
  downloadText(documents.web.filename.replace(/\.kh$/i, "") + ".html", html, "text/html");
  setStatus("HTML ファイルを保存しました。");
});
document.querySelector("#kh-copy")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(source.value);
    setStatus("コードをコピーしました。");
  } catch {
    source.focus();
    source.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    setStatus(copied ? "コードをコピーしました。" : "コードを選択しました。コピー操作を行ってください。");
  }
});
source.addEventListener("scroll", alignGutter);
source.addEventListener("input", () => {
  documents[mode].source = source.value;
  showLineNumbers();
  setStatus("編集内容を実行できます。");
});
source.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    run();
  }
});
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const sampleCode = params.get("code");
const sampleMode = params.get("mode");
if (sampleCode && sampleCode.length <= 20000 && Object.hasOwn(documents, sampleMode)) {
  documents[sampleMode].source = sampleCode;
  selectMode(sampleMode);
} else {
  selectMode("web");
}
})();
