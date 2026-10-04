const EXT = /\.(html?|txt|json)$/i;
const state = { files: [], results: [] };

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const input = $("fileInput");
const fileList = $("fileList");
const convertBtn = $("convertBtn");
const results = $("results");
const resultList = $("resultList");
const summary = $("summary");
const status = $("status");

$("chooseBtn").addEventListener("click", () => input.click());
input.addEventListener("change", () => addFiles([...input.files]));

["dragenter", "dragover"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", e => addFiles([...e.dataTransfer.files]));

convertBtn.addEventListener("click", convertAll);
$("downloadAllBtn").addEventListener("click", downloadAll);

function addFiles(files) {
  const valid = files.filter(f => EXT.test(f.name));
  const ignored = files.length - valid.length;
  for (const f of valid) {
    if (!state.files.some(x => x.name === f.name && x.size === f.size)) state.files.push(f);
  }
  if (ignored) setStatus(`${ignored} file(s) ignored because they are not HTML, HTM, TXT, or JSON.`);
  renderFiles();
}

function renderFiles() {
  fileList.innerHTML = "";
  if (!state.files.length) {
    fileList.classList.add("hidden");
    convertBtn.disabled = true;
    return;
  }
  fileList.classList.remove("hidden");
  for (const f of state.files) {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML = `<span>${escapeHtml(f.name)}</span><span>${formatBytes(f.size)}</span>`;
    fileList.appendChild(row);
  }
  convertBtn.disabled = false;
}

function setStatus(text, error = false) {
  status.textContent = text || "";
  status.className = "status" + (error ? " error" : "");
}

async function convertAll() {
  if (!state.files.length) return;
  convertBtn.disabled = true;
  state.results = [];
  resultList.innerHTML = "";
  results.classList.remove("hidden");
  setStatus("Converting...");

  const plain = $("plain").checked;
  const header = $("header").checked;
  let ok = 0;

  for (const file of state.files) {
    try {
      const text = await file.text();
      const conv = loadConversation(text);
      if (!conv) throw new Error("No Copilot conversation found");

      const transcript = buildTranscript(conv, plain, header);
      const base = file.name.replace(/\.[^.]+$/, "");
      state.results.push({
        name: `${base}_transcript.txt`,
        source: file.name,
        text: transcript
      });
      ok++;
    } catch (err) {
      state.results.push({ name: file.name, source: file.name, error: err.message });
    }
  }

  renderResults();
  convertBtn.disabled = false;
  setStatus(`Finished: ${ok} of ${state.files.length} file(s) converted.`);
}

function buildTranscript(conv, plain, header) {
  const parts = [];
  if (header) {
    parts.push(
      `${conv.chatName || "Copilot conversation"}\n` +
      (conv.createTimeUtc ? `Started: ${fmtTime(conv.createTimeUtc)}\n` : "") +
      (conv.updateTimeUtc ? `Updated: ${fmtTime(conv.updateTimeUtc)}\n` : "") +
      "\n"
    );
  }

  let count = 0;
  for (const msg of conv.messages || []) {
    if (msg.author !== "user" && msg.author !== "bot") continue;
    if (typeof msg.text !== "string") continue;
    let body = clean(msg.text, plain);
    if (msg.imageName) body += `${body ? "\n\n" : ""}[Attached image: ${msg.imageName}]`;
    if (!body) continue;

    const label = msg.author === "user" ? "USER" : "COPILOT";
    parts.push(`${label}\n${"=".repeat(50)}\n\n${body}\n\n`);
    count++;
  }
  return parts.join("");
}

function findConversation(o) {
  if (o && typeof o === "object") {
    if (o.rawConversationResponse && Array.isArray(o.rawConversationResponse.messages))
      return o.rawConversationResponse;
    if (Array.isArray(o.messages) && o.messages.some(m => m && m.author)) return o;
    for (const v of Object.values(o)) {
      const r = findConversation(v);
      if (r) return r;
    }
  }
  return null;
}

function loadConversation(text) {
  // Strategy A: already JSON
  try {
    const c = findConversation(JSON.parse(text));
    if (c) return c;
  } catch {}

  // Strategy B: JSON.parse("...") embedded in a saved page
  const needle = /JSON\.parse\(\s*(?=")/g;
  let m;
  while ((m = needle.exec(text)) !== null) {
    const lit = readStringLiteral(text, m.index + m[0].length);
    if (!lit) continue;
    if (!lit.value.includes("rawConversationResponse") && !lit.value.includes('"author"')) continue;
    try {
      let data = JSON.parse(lit.value);
      if (typeof data === "string") data = JSON.parse(data);
      const c = findConversation(data);
      if (c) return c;
    } catch {}
  }

  // Strategy C: unescape an escaped blob
  try {
    const unescaped = decodeEscapedBlob(text);
    const i = unescaped.indexOf('"rawConversationResponse"');
    if (i >= 0) {
      const start = unescaped.indexOf("{", i + 25);
      if (start >= 0) {
        let depth = 0, inStr = false;
        for (let k = start; k < unescaped.length; k++) {
          const c = unescaped[k];
          if (inStr) {
            if (c === "\\") k++;
            else if (c === '"') inStr = false;
          } else if (c === '"') inStr = true;
          else if (c === "{") depth++;
          else if (c === "}" && --depth === 0) {
            return JSON.parse(unescaped.slice(start, k + 1));
          }
        }
      }
    }
  } catch {}

  return null;
}

function readStringLiteral(s, i) {
  if (s[i] !== '"') return null;
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") j += 2;
    else if (c === '"') break;
    else j++;
  }
  if (j >= s.length) return null;
  try {
    return { value: JSON.parse(s.slice(i, j + 1)), end: j + 1 };
  } catch { return null; }
}

function decodeEscapedBlob(text) {
  // Equivalent purpose to the Node fallback, but safe for browser input.
  // First decode common HTML entities, then interpret escaped JSON-style sequences.
  const decoded = decodeEntities(text);
  try {
    return JSON.parse('"' + decoded
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/"/g, '\\"')
      .replace(/\\\\n/g, "\\n") + '"');
  } catch {
    return decoded
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
}

function decodeEntities(s) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = s;
  return textarea.value;
}

function htmlToText(s) {
  return decodeEntities(
    s
      .replace(/<br[^>]*>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

function stripMarkdown(s) {
  return s
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/gs, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*---+\s*$/gm, "");
}

function clean(s, plain) {
  let t = htmlToText(s).replace(/\r\n/g, "\n");
  if (plain) t = stripMarkdown(t);
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fmtTime(t) {
  const d = new Date(Number(t) || t);
  return isNaN(d) ? String(t) : d.toLocaleString();
}

function renderResults() {
  resultList.innerHTML = "";
  const good = state.results.filter(r => !r.error).length;
  summary.textContent = `${good} converted • ${state.results.length} total`;

  for (const r of state.results) {
    const box = document.createElement("article");
    box.className = "result";

    if (r.error) {
      box.innerHTML = `
        <div class="result-name">${escapeHtml(r.source)}</div>
        <div class="result-meta">Error: ${escapeHtml(r.error)}</div>`;
      resultList.appendChild(box);
      continue;
    }

    const preview = r.text.length > 4000 ? r.text.slice(0, 4000) + "\n\n[Preview truncated]" : r.text;
    box.innerHTML = `
      <div class="result-top">
        <div>
          <div class="result-name">${escapeHtml(r.name)}</div>
          <div class="result-meta">${escapeHtml(r.source)} • ${formatBytes(new Blob([r.text]).size)}</div>
        </div>
        <div class="result-actions">
          <button class="secondary previewBtn">Preview</button>
          <button class="primary downloadBtn">Download</button>
        </div>
      </div>
      <pre class="preview hidden">${escapeHtml(preview)}</pre>`;

    box.querySelector(".downloadBtn").addEventListener("click", () => downloadText(r.name, r.text));
    box.querySelector(".previewBtn").addEventListener("click", (e) => {
      const p = box.querySelector(".preview");
      p.classList.toggle("hidden");
      e.target.textContent = p.classList.contains("hidden") ? "Preview" : "Hide";
    });
    resultList.appendChild(box);
  }
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadAll() {
  state.results.filter(r => !r.error).forEach(r => downloadText(r.name, r.text));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}
