// Saca las capturas del README a partir de la demo (nunca de chats reales).
// Arranca la app en una terminal simulada, pulsa teclas, pasa cada pantalla con
// sus colores a HTML y la fotografía con el Chrome instalado (puppeteer-core).
//
//   npm run capturas
//
// Deja los PNG en docs/capturas/. CHROME_PATH permite usar otro navegador.
process.env.FORCE_COLOR = '3';
process.env.WA_TERMINAL_NO_OPEN = '1';

const { PassThrough, Writable } = await import('node:stream');
const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const React = (await import('react')).default;
const { render } = await import('ink');
const { Store } = await import('../src/store.js');
const { Demo } = await import('../src/demo.js');
const { App } = await import('../src/ui.js');
const puppeteer = (await import('puppeteer-core')).default;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'capturas');
fs.mkdirSync(outDir, { recursive: true });

const COLS = 112;
const ROWS = 32;
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));

// ---------- terminal simulada ----------
const stdin = new PassThrough();
Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = '';
const stdout = new Writable({
  write(c, _e, cb) {
    const s = c.toString();
    if (s.trim()) frame = s;
    cb();
  },
});
Object.assign(stdout, { columns: COLS, rows: ROWS, isTTY: true });

const store = new Store(null);
const backend = new Demo({ store });
const app = render(React.createElement(App, { backend, store, cwd: 'C:\\Users\\dev\\api', demo: true }), { stdin, stdout, debug: true, patchConsole: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (s, ms = 200) => {
  stdin.write(s);
  await wait(ms);
};
const type = async (s, enter = true) => {
  for (const ch of s) await key(ch, 15);
  if (enter) await key('\r');
};

// ---------- ANSI a HTML ----------
const BASIC = ['#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc'];
const BRIGHT = ['#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2'];
const FG = '#cccccc';
const BG = '#0c0c0c';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xterm = (n) => {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  n -= 16;
  const c = (x) => (x ? x * 40 + 55 : 0);
  return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
};

function ansiToHtml(text) {
  let st = {};
  let html = '';
  const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
  let last = 0;
  const flush = (s) => {
    if (!s) return;
    let fg = st.fg || FG;
    let bg = st.bg;
    if (st.inverse) [fg, bg] = [bg || BG, fg];
    const css = [`color:${fg}`];
    if (bg) css.push(`background:${bg}`);
    if (st.bold) css.push('font-weight:700');
    if (st.dim) css.push('opacity:.55');
    if (st.italic) css.push('font-style:italic');
    html += `<span style="${css.join(';')}">${esc(s)}</span>`;
  };
  for (const m of text.matchAll(re)) {
    flush(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] === undefined) continue;
    const codes = (m[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) st = {};
      else if (c === 1) st.bold = true;
      else if (c === 2) st.dim = true;
      else if (c === 3) st.italic = true;
      else if (c === 7) st.inverse = true;
      else if (c === 22) st.bold = st.dim = false;
      else if (c === 23) st.italic = false;
      else if (c === 27) st.inverse = false;
      else if (c === 39) delete st.fg;
      else if (c === 49) delete st.bg;
      else if (c >= 30 && c <= 37) st.fg = BASIC[c - 30];
      else if (c >= 90 && c <= 97) st.fg = BRIGHT[c - 90];
      else if (c >= 40 && c <= 47) st.bg = BASIC[c - 40];
      else if (c >= 100 && c <= 107) st.bg = BRIGHT[c - 100];
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        if (c === 38) st.fg = col;
        else st.bg = col;
        i += 4;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        if (c === 38) st.fg = xterm(codes[i + 2]);
        else st.bg = xterm(codes[i + 2]);
        i += 2;
      }
    }
  }
  flush(text.slice(last));
  return html;
}

const page = (body, title) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#1b1b1f}
  .win{display:inline-block;margin:28px;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.55);border:1px solid #333}
  .bar{background:#202020;height:34px;display:flex;align-items:flex-end;padding-left:10px;font:13px "Segoe UI",sans-serif;color:#ddd}
  .tab{background:${BG};padding:7px 18px 8px;border-radius:7px 7px 0 0;display:flex;gap:8px;align-items:center}
  .tab i{display:inline-block;width:12px;height:12px;border-radius:2px;background:#555}
  pre{margin:0;padding:10px 14px 12px;background:${BG};color:${FG};font:14px/1.3 "Cascadia Mono","Cascadia Code",Consolas,monospace;width:${COLS}ch;white-space:pre}
</style><div class="win"><div class="bar"><div class="tab"><i></i>${esc(title)}</div></div><pre>${body}</pre></div>`;

const shots = [];
const shot = (name) => {
  const lines = frame.replace(/\n+$/, '').split('\n').slice(-ROWS);
  shots.push({ name, html: page(lines.map(ansiToHtml).join('\n'), 'claude') });
  console.log('capturada', name);
};

// ---------- guion ----------
await wait(700);
shot('01-inicio');
await key('\x15'); // Ctrl+U: siguiente sin leer (Ana)
await type('¿pido yo?');
await wait(2000); // la demo contesta: «escribiendo…»
shot('02-chat');
await wait(2600);
await key('\x15'); // Familia
await type('/view');
shot('03-grupo');
await key('\t');
await key('\x1b[B');
await key('\x1b[B');
shot('04-lista');
await key('\t');
await type('?');
shot('05-ayuda');
await type('/clear');
await key('\x1b'); // modo jefe
await wait(9500);
shot('06-modo-jefe');
await key('\x1b');
app.unmount();

// ---------- fotos ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const tab = await browser.newPage();
await tab.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
for (const s of shots) {
  await tab.setContent(s.html, { waitUntil: 'load' });
  const el = await tab.$('.win');
  const box = await el.boundingBox();
  const file = path.join(outDir, s.name + '.png');
  await tab.screenshot({ path: file, clip: { x: box.x - 28, y: box.y - 28, width: box.width + 56, height: box.height + 56 } });
  console.log('guardada', path.relative(root, file));
}
await browser.close();
process.exit(0);
