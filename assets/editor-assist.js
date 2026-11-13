"use strict";

(() => {
  const source = document.querySelector("#kh-source");
  if (!source) return;

  const general = [
    ["say", "say 式", "式の値を実行結果に1行表示します。", 'say "こんにちは！"', "こんにちは！"],
    ["if", "if 条件 … end", "条件が true のときだけ中の処理を実行します。", "if true\n    \nend", "true"],
    ["else", "else", "if の条件が false のときに実行する処理を始めます。"],
    ["end", "end", "if、repeat、function のブロックを閉じます。"],
    ["repeat", "repeat 回数 … end", "指定した回数だけ中の処理を繰り返します。", "repeat 3\n    \nend", "3"],
    ["function", "function 名前(引数) … end", "あとから呼び出せる処理を定義します。", "function 名前(引数)\n    return 引数\nend", "名前"],
    ["return", "return 式", "関数の実行を終え、呼び出し元に値を返します。", "return 0", "0"],
    ["true", "true", "真を表す値です。条件式に使えます。"],
    ["false", "false", "偽を表す値です。条件式に使えます。"],
    ["and", "左 and 右", "両方の条件が true なら true です。"],
    ["or", "左 or 右", "少なくとも一方の条件が true なら true です。"],
    ["not", "not 条件", "条件の true と false を反転します。"]
  ];
  const web = [
    ["page", "page(タイトル, 説明) / page(ファイル名, タイトル, 説明)", "トップページまたは追加ページを作ります。", 'page("タイトル", "ページの説明")', "タイトル"],
    ["heading", "heading(見出し)", "ページに見出しを追加します。", 'heading("見出し")', "見出し"],
    ["text", "text(本文)", "ページに本文の段落を追加します。", 'text("本文")', "本文"],
    ["link", "link(表示名, URL)", "別ページや外部サイトへのリンクを追加します。", 'link("リンク名", "about.html")', "リンク名"],
    ["section", "section(見出し) … section_end()", "関連する内容をまとめるセクションを開きます。", 'section("見出し")\n    \nsection_end()', "見出し"],
    ["section_end", "section_end()", "直前に開いたセクションを閉じます。", "section_end()"],
    ["button", "button(表示名, メッセージ)", "クリックするとメッセージを表示するボタンを追加します。", 'button("ボタン名", "メッセージ")', "ボタン名"],
    ["theme", "theme(色)", "サイトのアクセント色を #RRGGBB 形式で指定します。", 'theme("#1e684d")', "#1e684d"],
    ["language", "language(言語タグ)", "HTMLの言語を指定します。日本語は ja です。", 'language("ja")', "ja"]
  ];
  const desktop = [
    ["use", 'use "ファイル.kh"', "Windows版IDEとCLIで、同じフォルダーの .kh を取り込みます。"],
    ["image", "image(URL, 代替テキスト)", "Windows版IDEとCLIで、ページに画像を追加します。"],
    ["css", "css(CSS文字列)", "Windows版IDEとCLIで、公開用CSSにルールを追加します。"],
    ["script", "script(JavaScript文字列)", "Windows版IDEとCLIで、公開用JavaScriptに処理を追加します。"]
  ];
  function entries(rows, kind) {
    return rows.map(([name, signature, explanation, template, field]) =>
      ({ name, signature, explanation, template, field, kind }));
  }
  const keywords = entries(general, "命令・文法");
  const webCommands = entries(web, "Web命令");
  const docs = new Map([...keywords, ...webCommands, ...entries(desktop, "Windows IDE・CLI")]
    .map(item => [item.name, item]));
  const word = "[\\p{ID_Start}_][\\p{ID_Continue}_]*";
  // Strings and comments precede identifiers so their contents are never offered.
  const tokens = new RegExp('#[^\\r\\n]*|"(?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])*"?|(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)|' + word, "gu");
  const nameToken = new RegExp("^" + word + "$", "u");
  const declaration = new RegExp("^\\s*function\\s+(" + word + ")\\s*\\(([^#\\r\\n)]*)\\)|^\\s*(" + word + ")\\s*=(?!=)", "u");
  const maxCandidates = 24;
  const maxSourceUnits = 200000;
  const maxHoverLineUnits = 4000;
  const create = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };
  const list = create("div", "kh-assist-list");
  list.id = "kh-assist-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "KHの入力候補");
  list.hidden = true;

  const tip = create("div", "kh-assist-tip");
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const tipSignature = create("code", "kh-assist-signature");
  const tipBody = create("p", "kh-assist-explanation");
  tip.append(tipSignature, tipBody);

  const announcement = create("span", "kh-assist-sr");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  const mirror = create("pre", "kh-assist-mirror");
  mirror.setAttribute("aria-hidden", "true");
  document.body.append(list, tip, announcement, mirror);
  source.setAttribute("aria-autocomplete", "list");
  source.setAttribute("aria-controls", list.id);

  let active = null;
  let selected = 0;
  let hoverTimer = 0;
  let updateTimer = 0;
  let composing = false;
  let inserting = false;
  let previousDocument = null;
  let previousDeclarations = new Map();

  function names(value) {
    if (value === previousDocument) return previousDeclarations;
    const result = new Map();
    for (const line of value.split("\n")) {
      const match = declaration.exec(line);
      if (!match) continue;
      const name = match[1] || match[3];
      if (docs.has(name) || result.has(name) || name.length > 80) continue;
      const fn = Boolean(match[1]);
      result.set(name, {
        name,
        signature: fn ? name + "(" + match[2].trim() + ")" : name,
        explanation: fn ? "このファイルで定義した関数です。" : "このファイルで代入された変数です。",
        kind: fn ? "関数" : "変数"
      });
      if (result.size >= 512) break;
    }
    previousDocument = value;
    previousDeclarations = result;
    return result;
  }

  function lineAt(value, index) {
    const start = index > 0 ? value.lastIndexOf("\n", index - 1) + 1 : 0;
    const next = value.indexOf("\n", index);
    return { start, text: value.slice(start, next < 0 ? value.length : next) };
  }

  function wordAt(text, index) {
    for (const match of text.matchAll(tokens)) {
      if (match.index > index) break;
      const end = match.index + match[0].length;
      if (index > end) continue;
      if (index === end && match[0][0] === '"' && match[0].length > 1 &&
          /(?:^|[^\\])(?:\\\\)*"$/.test(match[0])) continue;
      return { name: match[0], start: match.index, end, ignored: !nameToken.test(match[0]) };
    }
    return { name: "", start: index, end: index, ignored: false };
  }

  function context() {
    const value = source.value;
    const caret = source.selectionStart;
    if (value.length > maxSourceUnits || caret !== source.selectionEnd) return null;
    const line = lineAt(value, caret);
    if (line.text.length > maxHoverLineUnits) return null;
    const token = wordAt(line.text, caret - line.start);
    if (token.ignored) return null;
    return {
      value, caret, line, name: token.name,
      start: line.start + token.start, end: line.start + token.end,
      prefix: line.text.slice(token.start, caret - line.start)
    };
  }

  function metrics() {
    const style = getComputedStyle(source);
    const rect = source.getBoundingClientRect();
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return {
      style, rect, lineHeight,
      top: rect.top + source.clientTop + parseFloat(style.paddingTop),
      left: rect.left + source.clientLeft + parseFloat(style.paddingLeft)
    };
  }

  function lineGeometry(text, properties) {
    const { style } = properties;
    mirror.style.font = style.font;
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.fontStyle = style.fontStyle;
    mirror.style.fontVariant = style.fontVariant;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.wordSpacing = style.wordSpacing;
    mirror.style.tabSize = style.tabSize;
    mirror.style.direction = style.direction;
    mirror.textContent = text + "\u200b";
    const origin = mirror.getBoundingClientRect().left;
    const range = document.createRange();
    return (start, end = start) => {
      range.setStart(mirror.firstChild, start);
      range.setEnd(mirror.firstChild, end);
      const bounds = range.getBoundingClientRect();
      return { left: bounds.left - origin, right: bounds.right - origin };
    };
  }

  function place(element, x, y, rowHeight) {
    element.style.left = "0px";
    element.style.top = "0px";
    element.hidden = false;
    const box = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = Math.max(8, Math.min(x, viewportWidth - box.width - 8));
    const below = y + rowHeight + 5;
    const above = y - box.height - 5;
    const top = below + box.height > viewportHeight - 8 && above >= 8 ? above : below;
    element.style.left = left + "px";
    element.style.top = Math.max(8, Math.min(top, viewportHeight - box.height - 8)) + "px";
  }

  function closeList() {
    clearTimeout(updateTimer);
    active = null;
    list.hidden = true;
    source.removeAttribute("aria-activedescendant");
  }

  function closeTip() {
    clearTimeout(hoverTimer);
    tip.hidden = true;
  }

  function setSelected(index) {
    const count = active.items.length;
    selected = (index + count) % count;
    for (let i = 0; i < count; i++) list.children[i].setAttribute("aria-selected", String(i === selected));
    const option = list.children[selected];
    source.setAttribute("aria-activedescendant", option.id);
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    const bottom = option.offsetTop + option.offsetHeight;
    if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function showList(manual) {
    closeList();
    if (composing || document.activeElement !== source) return;
    const current = context();
    if (!current || (!manual && !current.prefix)) return;
    const local = names(current.value);
    const onWeb = document.querySelector('[data-example="web"]')?.getAttribute("aria-selected") === "true";
    const items = [...keywords, ...(onWeb ? webCommands : []), ...local.values()]
      .filter(item => item.name.startsWith(current.prefix) &&
        (manual || item.name !== current.name || current.caret !== current.end))
      .slice(0, maxCandidates);
    if (!items.length) {
      if (manual) announcement.textContent = "一致するKHの入力候補はありません。";
      return;
    }
    const properties = metrics();
    const row = current.value.slice(0, current.line.start).split("\n").length - 1;
    const x = properties.left + lineGeometry(current.line.text, properties)(current.caret - current.line.start).left - source.scrollLeft;
    const y = properties.top + row * properties.lineHeight - source.scrollTop;
    if (x < properties.rect.left - 1 || x > properties.rect.right || y + properties.lineHeight <= properties.rect.top ||
        y >= properties.rect.bottom || y < -properties.lineHeight || y >= document.documentElement.clientHeight) return;
    closeTip();
    const options = items.map((item, index) => {
      const option = create("div", "kh-assist-option");
      option.id = "kh-assist-option-" + index;
      option.dataset.index = String(index);
      option.setAttribute("role", "option");
      const name = create("code", "kh-assist-name");
      name.textContent = item.name;
      const kind = create("span", "kh-assist-kind");
      kind.textContent = item.kind;
      option.append(name, kind);
      return option;
    });
    list.replaceChildren(...options);
    active = { ...current, items };
    place(list, x, y, properties.lineHeight);
    list.scrollTop = 0;
    setSelected(0);
    announcement.textContent = items.length + "件の入力候補。上下キーで選択、EnterまたはTabで挿入。";
  }

  function sameContext(current) {
    return active && active.value === current.value && active.caret === current.caret;
  }

  function insert(item, current, template) {
    if (!item || !current) return false;
    let value = item.name;
    let field = "";
    if (template) {
      if (!item.template) return false;
      const before = current.value.slice(current.line.start, current.start);
      const after = current.value.slice(current.end, current.line.start + current.line.text.length);
      // Avoid replacing arguments or splitting a line into a nested command.
      if (before.trim() || after.trim()) {
        announcement.textContent = "ひな形は、命令だけを書いた行に挿入できます。";
        return true;
      }
      const indent = before.match(/^[\t ]*/)[0];
      value = item.template.replaceAll("\n", "\n" + indent);
      field = item.field || "";
    }
    closeList();
    closeTip();
    inserting = true;
    try {
      source.focus();
      source.setSelectionRange(current.start, current.end);
      // Browsers supporting insertText add a native undo entry.
      if (!document.execCommand?.("insertText", false, value)) {
        source.setRangeText(value, current.start, current.end, "end");
        source.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const offset = field ? value.indexOf(field) : -1;
      const start = offset >= 0 ? current.start + offset : current.start + value.length;
      source.setSelectionRange(start, start + (offset >= 0 ? field.length : 0));
    } finally {
      inserting = false;
    }
    announcement.textContent = template ? item.name + " のひな形を挿入しました。" : item.name + " を挿入しました。";
    return true;
  }

  list.addEventListener("pointerdown", event => {
    if (event.target.closest("[data-index]")) event.preventDefault();
  });
  list.addEventListener("click", event => {
    const option = event.target.closest("[data-index]");
    const current = context();
    if (option && current && sameContext(current)) insert(active.items[Number(option.dataset.index)], current, false);
    else closeList();
  });

  source.addEventListener("input", () => {
    closeList();
    closeTip();
    if (!inserting && !composing) updateTimer = setTimeout(() => showList(false), 100);
  });
  source.addEventListener("compositionstart", () => {
    composing = true;
    closeList();
    closeTip();
  });
  source.addEventListener("compositionend", () => {
    composing = false;
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => showList(false), 100);
  });
  source.addEventListener("keydown", event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.ctrlKey && !event.shiftKey && !event.altKey && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      showList(true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      closeList();
      return;
    }
    const current = context();
    if (active && (!current || !sameContext(current))) closeList();
    if (event.key === "F2" && current) {
      const item = active ? active.items[selected] : docs.get(current.name);
      if (item?.kind !== "Windows IDE・CLI" && insert(item, current, true)) event.preventDefault();
      return;
    }
    if (!active) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(selected + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeList();
    } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      insert(active.items[selected], current, false);
    } else if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      closeList();
    }
  }, true);

  function hoverAt(x, y) {
    if (composing || active || source.value.length > maxSourceUnits) return;
    const properties = metrics();
    const right = properties.rect.left + source.clientLeft + source.clientWidth;
    const bottom = properties.rect.top + source.clientTop + source.clientHeight;
    if (x < properties.left || x >= right || y < properties.top || y >= bottom) return;
    const row = Math.floor((y - properties.top + source.scrollTop) / properties.lineHeight);
    const line = source.value.split("\n")[row];
    if (line === undefined || line.length > maxHoverLineUnits) return;
    const relativeX = x - properties.left + source.scrollLeft;
    const geometry = lineGeometry(line, properties);
    const local = names(source.value);
    for (const match of line.matchAll(tokens)) {
      if (!nameToken.test(match[0])) continue;
      const item = docs.get(match[0]) || local.get(match[0]);
      if (!item) continue;
      const { left, right } = geometry(match.index, match.index + match[0].length);
      if (relativeX < left || relativeX >= right) continue;
      tipSignature.textContent = item.signature;
      tipBody.textContent = item.explanation;
      place(tip, properties.left + left - source.scrollLeft,
        properties.top + row * properties.lineHeight - source.scrollTop, properties.lineHeight);
      return;
    }
  }

  source.addEventListener("pointermove", event => {
    closeTip();
    if (event.pointerType !== "mouse" || event.buttons) return;
    const { clientX, clientY } = event;
    hoverTimer = setTimeout(() => hoverAt(clientX, clientY), 420);
  });
  source.addEventListener("pointerleave", closeTip);
  source.addEventListener("pointerdown", () => { closeList(); closeTip(); });
  source.addEventListener("blur", closeList);
  window.addEventListener("resize", () => { closeList(); closeTip(); });
  document.addEventListener("scroll", event => {
    if (event.target !== list) { closeList(); closeTip(); }
  }, true);
})();
