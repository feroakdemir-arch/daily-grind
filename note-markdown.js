/* Read view for notes: turns a note's markdown into formatted HTML.
   Every piece of text is escaped first and only a fixed set of tags is ever
   produced, so a note can never inject its own HTML or scripts. */
(() => {
  const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
  const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

  const escapeHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const indentOf = line => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
  const blank = line => /^\s*$/.test(line);

  function safeUrl(url) {
    const u = url.replace(/&amp;/g, "&").trim();
    return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
  }

  function inline(src) {
    return String(src).split(/(`[^`\n]+`)/g).map(part => {
      if (/^`[^`\n]+`$/.test(part)) return "<code>" + escapeHtml(part.slice(1, -1)) + "</code>";
      let s = escapeHtml(part);
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, url) => {
        const u = safeUrl(url);
        return u ? '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>" : match;
      });
      s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+?)__/g, "<strong>$1</strong>");
      s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
      s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
      return s;
    }).join("");
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map(cell => cell.trim());
  }

  const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]);

  function startsBlock(lines, i) {
    const line = lines[i];
    return HEADING.test(line) || HR.test(line) || /^\s*>/.test(line) || LIST_ITEM.test(line) || isTableStart(lines, i);
  }

  function parseTable(lines, i) {
    const head = splitRow(lines[i]);
    const align = splitRow(lines[i + 1]).map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "");
    const cellTag = (tag, cell, col) => "<" + tag + (align[col] ? ' style="text-align:' + align[col] + '"' : "") + ">" + inline(cell) + "</" + tag + ">";
    let html = '<div class="note-md-table"><table><thead><tr>' + head.map((cell, col) => cellTag("th", cell, col)).join("") + "</tr></thead><tbody>";
    i += 2;
    while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
      const cells = splitRow(lines[i]);
      html += "<tr>" + head.map((_, col) => cellTag("td", cells[col] || "", col)).join("") + "</tr>";
      i++;
    }
    return { html: html + "</tbody></table></div>", next: i };
  }

  function listItemContent(text) {
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (!task) return inline(text);
    return '<span class="note-md-check">' + (task[1] === " " ? "☐" : "☑") + "</span> " + inline(task[2]);
  }

  function parseList(lines, i) {
    const base = indentOf(lines[i]);
    const first = lines[i].match(LIST_ITEM)[1];
    const ordered = /\d/.test(first);
    const start = ordered ? parseInt(first, 10) : 1;
    let html = ordered ? "<ol" + (start !== 1 ? ' start="' + start + '"' : "") + ">" : "<ul>";
    while (i < lines.length) {
      if (blank(lines[i])) {
        let j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && LIST_ITEM.test(lines[j]) && indentOf(lines[j]) >= base) { i = j; continue; }
        break;
      }
      const match = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (!match || indentOf(lines[i]) !== base) break;
      i++;
      let item = listItemContent(match[2]);
      while (i < lines.length && !blank(lines[i]) && indentOf(lines[i]) > base && !LIST_ITEM.test(lines[i])) {
        item += "<br>" + inline(lines[i].trim());
        i++;
      }
      if (i < lines.length && LIST_ITEM.test(lines[i]) && indentOf(lines[i]) > base) {
        const sub = parseList(lines, i);
        item += sub.html;
        i = sub.next;
      }
      html += "<li>" + item + "</li>";
    }
    return { html: html + (ordered ? "</ol>" : "</ul>"), next: i };
  }

  function renderLines(lines) {
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }
      const heading = line.match(HEADING);
      if (heading) {
        const level = heading[1].length;
        html += "<h" + level + ">" + inline(heading[2]) + "</h" + level + ">";
        i++;
        continue;
      }
      if (HR.test(line)) {
        html += "<hr>";
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const inner = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { inner.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        html += "<blockquote>" + renderLines(inner) + "</blockquote>";
        continue;
      }
      if (isTableStart(lines, i)) {
        const table = parseTable(lines, i);
        html += table.html;
        i = table.next;
        continue;
      }
      if (LIST_ITEM.test(line)) {
        const list = parseList(lines, i);
        html += list.html;
        i = list.next;
        continue;
      }
      const paragraph = [];
      while (i < lines.length && !blank(lines[i]) && (paragraph.length === 0 || !startsBlock(lines, i))) {
        paragraph.push(inline(lines[i].trim()));
        i++;
      }
      html += "<p>" + paragraph.join("<br>") + "</p>";
    }
    return html;
  }

  function render(text) {
    return renderLines(String(text || "").replace(/\r\n?/g, "\n").split("\n"));
  }

  // Only notes that are clearly written in markdown open in the read view on their own.
  function looksLikeMarkdown(text) {
    const s = String(text || "");
    if (/^#{1,6}\s+\S/m.test(s)) return true;
    if (/^\s*>\s/m.test(s) && /\*\*[^*\n]+\*\*/.test(s)) return true;
    const lines = s.split(/\r?\n/);
    for (let i = 0; i + 1 < lines.length; i++) if (lines[i].includes("|") && TABLE_RULE.test(lines[i + 1])) return true;
    return (s.match(/\*\*[^*\n]+\*\*/g) || []).length >= 3 && /^\s*[-*]\s+\S/m.test(s);
  }

  // Page title for an imported file: its first heading, otherwise the file name.
  function titleFor(text, fileName) {
    const heading = String(text || "").match(/^#{1,6}\s+(.+?)\s*#*\s*$/m);
    const raw = heading ? heading[1] : String(fileName || "").replace(/\.[^.]+$/, "");
    return raw.replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim().slice(0, 120) || "Imported page";
  }

  window.noteMarkdown = { render, looksLikeMarkdown, titleFor, escapeHtml };
})();
