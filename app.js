// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

const MAX_CELLS = 25_000_000; // guard for the O(n*m) LCS table

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const toLines = (text) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

// Split a line into words, whitespace runs and single punctuation characters.
const tokenize = (line) => line.match(/\s+|\w+|[^\w\s]/g) || [];

/**
 * LCS-based diff of two key arrays.
 * Returns ops: { type: 'equal' | 'delete' | 'insert', a?: index, b?: index }
 */
function lcsDiff(a, b) {
  let start = 0;
  let endA = a.length;
  let endB = b.length;

  // Trim common prefix / suffix to keep the table small.
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    throw new Error('Texts are too large / too different to compare in the browser.');
  }

  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[start + i] === b[start + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ type: 'equal', a: k, b: k });

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      ops.push({ type: 'equal', a: start + i, b: start + j }); i++; j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ type: 'delete', a: start + i }); i++;
    } else {
      ops.push({ type: 'insert', b: start + j }); j++;
    }
  }
  while (i < n) ops.push({ type: 'delete', a: start + i++ });
  while (j < m) ops.push({ type: 'insert', b: start + j++ });

  for (let k = 0; k < a.length - endA; k++) ops.push({ type: 'equal', a: endA + k, b: endB + k });
  return ops;
}

function makeNormalizer({ ignoreWhitespace, ignoreCase }) {
  return (s) => {
    if (ignoreWhitespace) s = s.trim().replace(/\s+/g, ' ');
    if (ignoreCase) s = s.toLowerCase();
    return s;
  };
}

const DEL_MARK = 'bg-red-300/70 dark:bg-red-700/70 rounded-sm line-through decoration-red-700/50';
const INS_MARK = 'bg-green-300/70 dark:bg-green-700/70 rounded-sm';

/** Word-level diff of two lines, returns highlighted HTML for each side. */
function inlineDiff(oldLine, newLine, normalize) {
  const ta = tokenize(oldLine);
  const tb = tokenize(newLine);
  const ops = lcsDiff(ta.map(normalize), tb.map(normalize));

  let left = '';
  let right = '';
  let run = { type: null, text: '' };

  const flush = () => {
    if (!run.type) return;
    const t = escapeHtml(run.text);
    if (run.type === 'equal') { left += t; right += escapeHtml(run.textB); }
    else if (run.type === 'delete') left += `<mark class="${DEL_MARK}">${t}</mark>`;
    else right += `<mark class="${INS_MARK}">${t}</mark>`;
    run = { type: null, text: '' };
  };

  for (const op of ops) {
    if (op.type !== run.type) { flush(); run = { type: op.type, text: '', textB: '' }; }
    if (op.type === 'equal') { run.text += ta[op.a]; run.textB += tb[op.b]; }
    else if (op.type === 'delete') run.text += ta[op.a];
    else run.text += tb[op.b];
  }
  flush();
  return { left, right };
}

/**
 * Compare two texts. Returns split rows, unified rows and stats.
 * Adjacent delete/insert blocks are paired into "modify" rows with word-level highlights.
 */
function compareTexts(textA, textB, options) {
  const normalize = makeNormalizer(options);
  const linesA = toLines(textA);
  const linesB = toLines(textB);
  const ops = lcsDiff(linesA.map(normalize), linesB.map(normalize));

  const split = [];
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  let dels = [];
  let ins = [];

  const flushChanges = () => {
    const pairs = Math.min(dels.length, ins.length);
    for (let k = 0; k < pairs; k++) {
      const { left, right } = inlineDiff(linesA[dels[k]], linesB[ins[k]], normalize);
      split.push({ type: 'modify', leftNo: dels[k] + 1, rightNo: ins[k] + 1, leftHtml: left, rightHtml: right });
      stats.modified++;
    }
    for (let k = pairs; k < dels.length; k++) {
      split.push({ type: 'delete', leftNo: dels[k] + 1, rightNo: null, leftHtml: escapeHtml(linesA[dels[k]]), rightHtml: '' });
      stats.removed++;
    }
    for (let k = pairs; k < ins.length; k++) {
      split.push({ type: 'insert', leftNo: null, rightNo: ins[k] + 1, leftHtml: '', rightHtml: escapeHtml(linesB[ins[k]]) });
      stats.added++;
    }
    dels = [];
    ins = [];
  };

  for (const op of ops) {
    if (op.type === 'delete') dels.push(op.a);
    else if (op.type === 'insert') ins.push(op.b);
    else {
      flushChanges();
      split.push({ type: 'equal', leftNo: op.a + 1, rightNo: op.b + 1, leftHtml: escapeHtml(linesA[op.a]), rightHtml: escapeHtml(linesB[op.b]) });
      stats.unchanged++;
    }
  }
  flushChanges();

  // Unified view: modified lines become a removed line followed by an added line.
  const unified = [];
  let pendingAdds = [];
  for (const row of split) {
    if (row.type === 'equal') {
      unified.push(...pendingAdds); pendingAdds = [];
      unified.push({ type: 'equal', leftNo: row.leftNo, rightNo: row.rightNo, html: row.leftHtml });
    } else {
      if (row.leftNo) unified.push({ type: 'delete', leftNo: row.leftNo, rightNo: null, html: row.leftHtml });
      if (row.rightNo) pendingAdds.push({ type: 'insert', leftNo: null, rightNo: row.rightNo, html: row.rightHtml });
    }
  }
  unified.push(...pendingAdds);

  const total = linesA.length + linesB.length;
  stats.similarity = total === 0 ? 100 : Math.round((200 * stats.unchanged) / total);
  stats.identical = stats.added + stats.removed + stats.modified === 0;

  return { split, unified, stats };
}

/** Replace long runs of unchanged rows with a single "collapsed" row, keeping `ctx` lines of context. */
function collapseUnchanged(rows, ctx = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type === 'equal') return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true;
  });

  const out = [];
  let hidden = 0;
  rows.forEach((r, i) => {
    if (r.type !== 'equal' || keep[i]) {
      if (hidden) { out.push({ type: 'collapsed', count: hidden }); hidden = 0; }
      out.push(r);
    } else hidden++;
  });
  if (hidden) out.push({ type: 'collapsed', count: hidden });
  return out;
}

// ---------------------------------------------------------------------------
// Alpine component
// ---------------------------------------------------------------------------

const SAMPLES = [
  `The quick brown fox jumps over the lazy dog.
Alpine.js is a rugged, minimal framework.
Tailwind CSS makes styling fast.
This line stays the same.
Goodbye, world!`,
  `The quick red fox jumped over the lazy dog.
Alpine.js is a rugged, minimal framework.
Tailwind CSS makes styling fast and fun.
This line stays the same.
A brand new line was added here.
Goodbye, world!`,
  `The quick brown fox jumps over the sleepy cat.
Alpine.js is a rugged, minimal framework.
This line stays the same.
Goodbye, cruel world!`,
];

document.addEventListener('alpine:init', () => {
  Alpine.data('textCompare', () => ({
    texts: [
      { label: 'Original', value: '' },
      { label: 'Modified', value: '' },
    ],
    options: { ignoreWhitespace: false, ignoreCase: false },
    hideUnchanged: false,
    view: 'split', // 'split' | 'unified'
    results: [],
    activePair: 0,
    error: '',
    theme: 'auto', // 'light' | 'dark' | 'auto'

    init() {
      this.$watch('options', () => { if (this.results.length) this.compare(false); });

      try { this.theme = localStorage.getItem('theme') || 'auto'; } catch {}
      if (!['light', 'dark', 'auto'].includes(this.theme)) this.theme = 'auto';
      // In auto mode, follow the OS setting when it changes
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
      this.applyTheme();
    },

    setTheme(theme) {
      this.theme = theme;
      try { localStorage.setItem('theme', theme); } catch {}
      this.applyTheme();
    },

    applyTheme() {
      const dark = this.theme === 'dark' || (this.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    },

    get hasThird() { return this.texts.length === 3; },

    get current() { return this.results[this.activePair] || null; },

    get rows() {
      if (!this.current) return [];
      const rows = this.view === 'split' ? this.current.split : this.current.unified;
      return this.hideUnchanged ? collapseUnchanged(rows) : rows;
    },

    addThird() { this.texts.push({ label: 'Third', value: '' }); },

    removeThird() {
      this.texts.splice(2, 1);
      this.results = this.results.filter((r) => r.b !== 2 && r.a !== 2);
      this.activePair = 0;
    },

    swap(i, j) {
      [this.texts[i], this.texts[j]] = [this.texts[j], this.texts[i]];
      if (this.results.length) this.compare(false);
    },

    clearAll() {
      this.texts.forEach((t) => (t.value = ''));
      this.results = [];
      this.error = '';
    },

    loadSample() {
      this.texts.forEach((t, i) => (t.value = SAMPLES[i]));
      this.compare();
    },

    loadFile(event, i) {
      const file = event.target.files[0];
      if (!file) return;
      file.text().then((text) => (this.texts[i].value = text));
      event.target.value = '';
    },

    async pasteFromClipboard(i) {
      this.error = '';
      try {
        this.texts[i].value = await navigator.clipboard.readText();
      } catch {
        this.error = 'Clipboard access was blocked. Click into the box and press Ctrl/⌘ + V instead.';
      }
    },

    lineCount(text) { return toLines(text).length; },

    compare(scroll = true) {
      this.error = '';
      const pairs = this.hasThird ? [[0, 1], [0, 2], [1, 2]] : [[0, 1]];
      try {
        this.results = pairs.map(([a, b]) => ({ a, b, ...compareTexts(this.texts[a].value, this.texts[b].value, this.options) }));
      } catch (e) {
        this.results = [];
        this.error = e.message;
        return;
      }
      if (this.activePair >= this.results.length) this.activePair = 0;
      if (scroll) this.$nextTick(() => this.$refs.results?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },

    pairLabel(r) { return `${this.texts[r.a].label || 'Text ' + (r.a + 1)} ↔ ${this.texts[r.b].label || 'Text ' + (r.b + 1)}`; },

    rowClass(type, side) {
      if (type === 'equal') return '';
      if (type === 'delete') return side === 'right' ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-red-50 dark:bg-red-950/40';
      if (type === 'insert') return side === 'left' ? 'bg-gray-50 dark:bg-gray-800/40' : 'bg-green-50 dark:bg-green-950/40';
      if (type === 'modify') return side === 'left' ? 'bg-red-50 dark:bg-red-950/40' : 'bg-green-50 dark:bg-green-950/40';
      return '';
    },
  }));
});
