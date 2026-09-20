(() => {
  const PAGE_W = 1240, PAGE_H = 1754, MARGIN = 90, FOOTER = 58;
  const FIRST_TOP = 255, NEXT_TOP = 90;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const RENDER_SCALE = 2, MAX_SCALE = 2;
  // Mirror the note editor exactly: monospace 14px, line-height 1.8, browser tab stops every 8 characters.
  const NOTE_FONT_STACK = "'SF Mono','Fira Code','JetBrains Mono',monospace";
  const NOTE_FONT_SIZE = 14, NOTE_LINE_HEIGHT = 1.8, NOTE_TAB_SIZE = 8, NOTE_LINE_PX = NOTE_FONT_SIZE * NOTE_LINE_HEIGHT;
  const firstCapacity = PAGE_H - FOOTER - FIRST_TOP;
  const nextCapacity = PAGE_H - FOOTER - NEXT_TOP;
  const cleanName = value => (String(value || "Untitled note").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toLowerCase().slice(0, 80) || "untitled-note");
  function inkColor(value) {
    const match = /^#([0-9a-f]{6})$/i.exec(value || "");
    if (!match) return "#111827";
    const rgb = match[1].match(/.{2}/g).map(part => parseInt(part, 16));
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luminance > 0.72 ? "#111827" : value;
  }
  function pagePosition(logicalY) {
    if (logicalY < firstCapacity) return { page: 0, y: FIRST_TOP + logicalY };
    const rest = logicalY - firstCapacity;
    return { page: 1 + Math.floor(rest / nextCapacity), y: NEXT_TOP + (rest % nextCapacity) };
  }
  function pageStart(page) { return page === 0 ? 0 : firstCapacity + (page - 1) * nextCapacity; }
  function noteFontFamily() {
    try {
      const editor = document.querySelector('textarea[aria-label="Note body"]');
      const family = editor && getComputedStyle(editor).fontFamily;
      if (family) return family;
    } catch (error) { /* no DOM (tests) or the editor is closed: use the shell font stack */ }
    return NOTE_FONT_STACK;
  }
  function expandTabs(line) {
    let out = "", column = 0;
    for (const char of line) {
      if (char === "\t") { const gap = NOTE_TAB_SIZE - (column % NOTE_TAB_SIZE); out += " ".repeat(gap); column += gap; }
      else { out += char; column += 1; }
    }
    return out;
  }
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
      const paragraph = expandTabs(raw);
      if (!paragraph) { lines.push(""); continue; }
      const words = paragraph.split(/(\s+)/).filter(Boolean);
      let line = "";
      for (const word of words) {
        if (line && ctx.measureText(line + word).width > maxWidth) { lines.push(line.trimEnd()); line = word.trimStart(); }
        else line += word;
        // The textarea uses overflow-wrap: break-word, so a single word wider than the line breaks by character.
        while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          lines.push(line.slice(0, cut)); line = line.slice(cut);
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  function splitLineAcrossPages(x1, y1, x2, y2) {
    const points = [{ x: x1, y: y1 }];
    if (y1 !== y2) {
      const low = Math.min(y1, y2), high = Math.max(y1, y2);
      const boundaries = [firstCapacity];
      for (let y = firstCapacity + nextCapacity; y < high; y += nextCapacity) boundaries.push(y);
      for (const boundary of boundaries) if (boundary > low && boundary < high) {
        const t = (boundary - y1) / (y2 - y1);
        points.push({ x: x1 + (x2 - x1) * t, y: boundary });
      }
    }
    points.push({ x: x2, y: y2 });
    return points.sort((a, b) => (y2 >= y1 ? a.y - b.y : b.y - a.y));
  }
  async function loadImage(data) {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("A screenshot could not be rendered in the PDF.")); image.src = data; });
    return image;
  }
  async function build(note) {
    if (!window.jspdf?.jsPDF) throw new Error("The PDF library did not load. Refresh and try again.");
    const canvases = [];
    const page = index => {
      while (canvases.length <= index) {
        const canvas = document.createElement("canvas"); canvas.width = PAGE_W * RENDER_SCALE; canvas.height = PAGE_H * RENDER_SCALE;
        const ctx = canvas.getContext("2d"); ctx.scale(RENDER_SCALE, RENDER_SCALE); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
        canvases.push(canvas);
      }
      return canvases[index].getContext("2d");
    };
    const header = page(0);
    header.fillStyle = "#6d28d9"; header.fillRect(0, 0, PAGE_W, 18);
    header.fillStyle = "#111827"; header.font = "700 48px Arial";
    const titleLines = wrapText(header, note.title || "Untitled note", CONTENT_W);
    titleLines.slice(0, 2).forEach((line, i) => header.fillText(line, MARGIN, 85 + i * 55));
    header.fillStyle = "#6b7280"; header.font = "22px Arial";
    const meta = [note.tag ? `Section: ${note.tag}` : "Quick Notes", new Date(note.updatedAt || note.createdAt || Date.now()).toLocaleString()].join("   |   ");
    header.fillText(meta, MARGIN, 210);

    // Lay everything out in the editor's own pixel space first (14px monospace, 25.2px line boxes, tabs at
    // 8-character stops, wrapping at the editor's locked page width), then scale text and ink by ONE shared
    // factor so pen strokes land on the same characters they were drawn over.
    const fontFamily = noteFontFamily();
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `${NOTE_FONT_SIZE}px ${fontFamily}`;
    const strokes = note.drawing || [], boxes = note.textBoxes || [];
    const longestBodyLine = String(note.body || "").replace(/\r/g, "").split("\n").reduce((longest, line) => Math.max(longest, measure.measureText(expandTabs(line)).width), 0);
    const anchoredWidth = Math.max(0, ...strokes.map(stroke => stroke.pageWidth || 0), ...boxes.map(box => box.pageWidth || 0));
    const pageWidth = anchoredWidth || Math.max(700, Math.ceil(longestBodyLine) + 8);
    const bodyLines = wrapText(measure, note.body || "", pageWidth);
    let usedWidth = bodyLines.reduce((longest, line) => Math.max(longest, measure.measureText(line).width), 0);
    const boxLayouts = boxes.map(box => {
      const longest = String(box.text || "").split("\n").reduce((max, line) => Math.max(max, measure.measureText(expandTabs(line)).width), 0);
      // The editor grows a box frame to fit its longest line (capped only by the paper's right edge).
      const frameWidth = Math.ceil(Math.max(box.width, longest + 12));
      usedWidth = Math.max(usedWidth, box.x + frameWidth);
      return { box, lines: wrapText(measure, box.text, frameWidth - 2) };
    });
    for (const stroke of strokes) for (const point of stroke.points || []) usedWidth = Math.max(usedWidth, point[0] + (stroke.width || 0) / 2);
    // Fit the part of the page that is actually used, so a short table stays legible on A4.
    const scale = Math.min(MAX_SCALE, CONTENT_W / Math.max(360, usedWidth + 24));
    const lineHeight = NOTE_LINE_PX * scale, noteFont = `${NOTE_FONT_SIZE * scale}px ${fontFamily}`;
    let logicalBottom = 0;
    const drawLine = (text, x, logicalY) => {
      const pos = pagePosition(logicalY), ctx = page(pos.page);
      ctx.fillStyle = "#111827"; ctx.font = noteFont; ctx.textBaseline = "middle";
      ctx.fillText(text, x, pos.y + lineHeight / 2);
      logicalBottom = Math.max(logicalBottom, logicalY + lineHeight);
    };
    bodyLines.forEach((line, i) => drawLine(line, MARGIN, i * lineHeight));
    // Positioned text boxes render inside a 1px frame border in the editor.
    for (const { box, lines } of boxLayouts) lines.forEach((line, i) => drawLine(line, MARGIN + (box.x + 1) * scale, (box.y + 1) * scale + i * lineHeight));
    for (const stroke of note.drawing || []) {
      const points = stroke.points || [];
      if (!points.length) continue;
      const color = inkColor(stroke.color);
      if (points.length === 1) {
        const y = points[0][1] * scale, pos = pagePosition(y), ctx = page(pos.page);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(MARGIN + points[0][0] * scale, pos.y, Math.max(1, stroke.width * scale / 2), 0, Math.PI * 2); ctx.fill();
      } else for (let i = 1; i < points.length; i++) {
        const fragments = splitLineAcrossPages(points[i - 1][0] * scale, points[i - 1][1] * scale, points[i][0] * scale, points[i][1] * scale);
        for (let j = 1; j < fragments.length; j++) {
          const a = fragments[j - 1], b = fragments[j];
          const probe = Math.min(a.y, b.y) + 0.01, posA = pagePosition(probe), start = pagePosition(a.y + (a.y === firstCapacity ? 0.01 : 0)), end = pagePosition(b.y - (b.y === firstCapacity ? 0.01 : 0));
          const ctx = page(posA.page); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, stroke.width * scale); ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(MARGIN + a.x, start.y); ctx.lineTo(MARGIN + b.x, end.y); ctx.stroke();
        }
      }
      logicalBottom = Math.max(logicalBottom, ...points.map(point => point[1] * scale + 30));
    }

    let cursor = Math.max(logicalBottom + 70, 80);
    if ((note.images || []).length) {
      const loadedImages = [];
      for (const item of note.images) loadedImages.push({ item, image: await loadImage(await window.noteImageStore.load(item.assetId)) });
      const first = loadedImages[0].image;
      let firstWidth = Math.min(CONTENT_W, first.naturalWidth), firstHeight = first.naturalHeight * firstWidth / first.naturalWidth;
      const maxHeight = nextCapacity - 100;
      if (firstHeight > maxHeight) { firstHeight = maxHeight; firstWidth = first.naturalWidth * firstHeight / first.naturalHeight; }
      let pos = pagePosition(cursor);
      if (firstHeight + 110 > PAGE_H - FOOTER - pos.y) { cursor = pageStart(pos.page + 1); pos = pagePosition(cursor); }
      const heading = page(pos.page); heading.fillStyle = "#6d28d9"; heading.font = "700 28px Arial"; heading.fillText("Screenshots", MARGIN, pos.y);
      cursor += 55;
      for (const { item, image } of loadedImages) {
        let width = Math.min(CONTENT_W, image.naturalWidth), height = image.naturalHeight * width / image.naturalWidth;
        if (height > maxHeight) { height = maxHeight; width = image.naturalWidth * height / image.naturalHeight; }
        pos = pagePosition(cursor);
        const remaining = (pos.page === 0 ? PAGE_H - FOOTER : PAGE_H - FOOTER) - pos.y;
        if (height + 55 > remaining) { cursor = pageStart(pos.page + 1); pos = pagePosition(cursor); }
        const ctx = page(pos.page); ctx.fillStyle = "#374151"; ctx.font = "20px Arial"; ctx.fillText(item.name || "Screenshot", MARGIN, pos.y + 20);
        ctx.drawImage(image, MARGIN, pos.y + 38, width, height);
        cursor += 38 + height + 45;
      }
    }
    page(pagePosition(Math.max(cursor, logicalBottom)).page);
    canvases.forEach((canvas, index) => {
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#9ca3af"; ctx.font = "18px Arial"; ctx.textAlign = "center";
      ctx.fillText(`Organized Me  |  Page ${index + 1} of ${canvases.length}`, PAGE_W / 2, PAGE_H - 22); ctx.textAlign = "left";
    });
    const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
    canvases.forEach((canvas, index) => { if (index) pdf.addPage("a4", "portrait"); pdf.addImage(canvas, "PNG", 0, 0, 595.28, 841.89, undefined, "FAST"); });
    return { pdf, pageCount: canvases.length, filename: `organized-me-${cleanName(note.title)}.pdf` };
  }
  async function download(note) { const result = await build(note); await result.pdf.save(result.filename, { returnPromise: true }); return result; }
  window.notePdf = { build, download, cleanName, inkColor, wrapText, expandTabs, pagePosition, splitLineAcrossPages };
})();
