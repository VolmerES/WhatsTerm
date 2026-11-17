// Interfaz a pantalla completa, como un chat normal de terminal: lista de chats a
// la izquierda, conversación a la derecha (los tuyos a la derecha, los del otro a
// la izquierda) y la caja de texto abajo. Colores apagados para no llamar la
// atención. El disfraz de asistente de código queda para el modo jefe (Esc).
import React, { useEffect, useRef, useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import QRCode from 'qrcode';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { LineInput } from './input.js';
import { BOSS_PROMPT, BOSS_SCRIPT, BOSS_TREE, SPINNER_VERBS } from './boss.js';

const h = React.createElement;
const ACCENT = '#D77757'; // solo para el modo jefe
const SOFT = '#a8b4c0'; // nombres y marcas, discreto
const ME_BG = '#2b2f33';
const SEL_BG = '#2b2f33';
const SENDER_COLORS = ['#c9b98a', '#8fa9c9', '#b59ac4', '#86b8b8', '#9fbf8f', '#c98f8f', '#c4a582'];
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const GROUP_GAP = 10 * 60_000; // a partir de 10 min sin hablar, se repite el nombre

// abre un fichero con la aplicación por defecto de Windows (WA_TERMINAL_NO_OPEN=1 lo desactiva, para pruebas)
const OPEN_CMD = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const openFile = (file) => process.env.WA_TERMINAL_NO_OPEN || exec(`${OPEN_CMD} "${file}"`);

const COMMANDS = [
  ['/open', 'Abrir un chat por nombre: /open ana'],
  ['/view', 'Abrir un adjunto: /view 3, o el último del chat'],
  ['/pin', 'Fijar o soltar este chat'],
  ['/unread', 'Marcar este chat como no leído'],
  ['/back', 'Cerrar el chat'],
  ['/bell', 'Pitido de la terminal con los mensajes nuevos'],
  ['/clear', 'Quitar las notas de la pantalla'],
  ['/boss', 'Modo jefe (también Esc)'],
  ['/status', 'Estado de la conexión'],
  ['/help', 'Comandos y atajos'],
  ['/logout', 'Desvincular este dispositivo'],
  ['/exit', 'Salir'],
];

const SHORTCUTS = [
  ['Tab', 'Pasar de la caja de texto a la lista de chats y vuelta'],
  ['↑ ↓ / j k', 'En la lista: moverse. Enter: abrir'],
  ['p · u · r', 'En la lista: fijar · marcar no leído · marcar leído'],
  ['Ctrl+N / Ctrl+P', 'Chat siguiente / anterior (también Alt+↓ / Alt+↑)'],
  ['Ctrl+U', 'Siguiente chat con mensajes sin leer'],
  ['PgUp / PgDn', 'Subir y bajar por la conversación'],
  ['Ctrl+B', 'Esconder / mostrar la lista'],
  ['Esc', 'Modo jefe'],
  ['Ctrl+C', 'Salir'],
];

// ---------- utilidades ----------

const slug = (s) =>
  (s || 'chat')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'chat';

const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (ts) => {
  if (sameDay(ts, Date.now())) return 'hoy';
  if (sameDay(ts, Date.now() - 86_400_000)) return 'ayer';
  return new Date(ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
};
// hora si es de hoy, «ayer», o la fecha corta
const when = (ts) => {
  if (!ts) return '';
  if (sameDay(ts, Date.now())) return hhmm(ts);
  if (sameDay(ts, Date.now() - 86_400_000)) return 'ayer';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
};

const cut = (s, n) => {
  // los saltos de línea pasan a espacio; los espacios iniciales (sangría del árbol) se respetan
  const one = (s || '').replace(/\s*\n\s*/g, ' ');
  if (stringWidth(one) <= n) return one;
  let out = '';
  for (const ch of one) {
    if (stringWidth(out + ch) > n - 1) break;
    out += ch;
  }
  return out + '…';
};

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - stringWidth(s)));
const wrap = (text, width) => wrapAnsi(text || ' ', Math.max(10, width), { hard: true, trim: false }).split('\n');
const colorFor = (jid) => {
  let x = 0;
  for (const c of jid || '') x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[x % SENDER_COLORS.length];
};

// ---------- de entradas a líneas ----------
// Una línea es una lista de segmentos { text, color, bg, bold, dim }.

function entryLines(e, width) {
  const out = [];
  const bubble = Math.max(20, Math.floor(width * 0.72));
  switch (e.type) {
    case 'day': {
      const label = ` ${e.text} `;
      const side = Math.max(2, Math.floor((width - stringWidth(label)) / 2));
      out.push([{ text: '─'.repeat(side) + label + '─'.repeat(side), dim: true }]);
      break;
    }
    // mensajes del otro: a la izquierda, con su nombre en los grupos
    case 'them': {
      if (e.name) out.push([{ text: e.name, color: e.color, bold: true }]);
      for (const it of e.items) {
        const ls = wrap(it.text, bubble - 7);
        ls.forEach((l, i) => {
          const segs = [{ text: l }];
          if (i === ls.length - 1) segs.push({ text: '  ' + it.time, dim: true });
          out.push(segs);
        });
      }
      break;
    }
    // los tuyos: a la derecha, sobre un fondo gris suave
    case 'me': {
      const ls = wrap(e.text, bubble - 9);
      const w = Math.max(...ls.map((l) => stringWidth(l))) + (e.time ? 7 : 0);
      ls.forEach((l, i) => {
        const last = i === ls.length - 1;
        const body = pad(l, w - (last && e.time ? 7 : 0));
        const segs = [{ text: ' '.repeat(Math.max(0, width - w - 2)) }, { text: ' ' + body, bg: ME_BG }];
        if (last && e.time) segs.push({ text: '  ' + e.time, bg: ME_BG, dim: true });
        segs.push({ text: ' ', bg: ME_BG });
        out.push(segs);
      });
      break;
    }
    case 'note': {
      if (e.title) out.push([{ text: e.title, bold: true, color: e.color }]);
      for (const l of e.lines || []) for (const w2 of wrap(l, width - 2)) out.push([{ text: '  ' + w2, dim: !e.color, color: e.color }]);
      break;
    }
    case 'info':
      wrap(e.text, width).forEach((l) => out.push([{ text: l, dim: !e.color, color: e.color }]));
      break;
    // lo de abajo es del modo jefe
    case 'prompt': {
      wrap(e.text, width - 4).forEach((l, i) => out.push([{ text: (i ? '  ' : '> ') + pad(l, width - 3), bg: '#373737' }]));
      break;
    }
    case 'bot':
      wrap(e.text, width - 2).forEach((l, i) => out.push([{ text: i ? '  ' : '⏺ ' }, { text: l }]));
      break;
    case 'tool':
      out.push([{ text: '⏺ ', color: e.error ? 'red' : 'green' }, { text: e.name, bold: true }, { text: e.arg ? '(' + e.arg + ')' : '' }]);
      (e.sub || []).forEach((l, i) => {
        wrap(l, width - 5).forEach((w2, j) => out.push([{ text: i === 0 && j === 0 ? '  ⎿  ' : '     ', dim: true }, { text: w2, dim: true }]));
      });
      for (const [sign, n, code] of e.diff || []) {
        const text = String(n).padStart(4) + ' ' + sign + ' ' + code;
        out.push([{ text: '     ' }, { text: pad(cut(text, width - 6), width - 6), bg: sign === '+' ? '#1f3d22' : sign === '-' ? '#4a1f1f' : undefined, dim: sign === ' ' }]);
      }
      break;
    case 'raw':
      for (const l of e.lines) out.push([{ text: l }]);
      break;
    default:
      out.push([{ text: String(e.text ?? '') }]);
  }
  return out;
}

function toLines(entries, width) {
  const lines = [];
  entries.forEach((e, i) => {
    lines.push(...entryLines(e, width));
    const next = entries[i + 1];
    const tight = e.type === 'raw' || (e.type === 'me' && next?.type === 'me');
    if (next && !tight) lines.push([]);
  });
  return lines;
}

function chatEntries(store, chat) {
  const out = [];
  let prevDay = null;
  let group = null;
  for (const m of chat.msgs) {
    const day = dayLabel(m.ts);
    if (day !== prevDay) {
      out.push({ type: 'day', text: day });
      prevDay = day;
      group = null;
    }
    // los adjuntos sin número son de antes de poder abrirlos: se indica
    const text = /^\[[^\]#]+\]/.test(m.text) && !m.media && /^\[(imagen|vídeo|gif|audio|nota de voz|sticker|documento)/.test(m.text)
      ? m.text.replace(/^\[([^\]]+)\]/, '[$1, no disponible]')
      : m.text;
    if (m.fromMe) {
      out.push({ type: 'me', text, time: hhmm(m.ts) });
      group = null;
      continue;
    }
    if (group && group.sender === m.sender && m.ts - group.last < GROUP_GAP) {
      group.items.push({ text, time: hhmm(m.ts) });
      group.last = m.ts;
      continue;
    }
    group = {
      type: 'them',
      sender: m.sender,
      name: chat.isGroup ? store.nameOf(m.sender) : null,
      color: colorFor(m.sender),
      last: m.ts,
      items: [{ text, time: hhmm(m.ts) }],
    };
    out.push(group);
  }
  return out;
}

function Line({ segs }) {
  if (!segs.length) return h(Text, null, ' ');
  return h(
    Text,
    { wrap: 'truncate' },
    ...segs.map((s, i) => h(Text, { key: i, color: s.color, backgroundColor: s.bg, bold: s.bold, dimColor: s.dim, italic: s.italic }, s.text)),
  );
}

function Spinner({ verb, start }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 120);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((Date.now() - start) / 1000);
  const tokens = (secs * 37 + 412) / 1000;
  return h(
    Text,
    { wrap: 'truncate' },
    h(Text, { color: ACCENT }, FRAMES[i % FRAMES.length] + ' ' + verb + '… '),
    h(Text, { dimColor: true }, `(${secs}s · ↑ ${tokens.toFixed(1)}k tokens · `, h(Text, { bold: true }, 'esc'), ' to interrupt)'),
  );
}

// ---------- lista lateral ----------

// Chats: dos líneas por chat (nombre y hora; vista previa y no leídos)
function ChatList({ chats, store, width, height, selected, openId, focused, typingId }) {
  const inner = width - 2;
  const per = 3; // dos líneas y una separación
  const room = Math.max(1, Math.floor((height - 2) / per));
  const sel = Math.max(0, chats.findIndex((c) => c.id === selected));
  const start = Math.max(0, Math.min(sel - Math.floor(room / 2), chats.length - room));
  const visible = chats.slice(start, start + room);
  const rows = [];
  for (const c of visible) {
    const isSel = focused && c.id === selected;
    const isOpen = c.id === openId;
    const bg = isSel || isOpen ? SEL_BG : undefined;
    const unread = c.unread > 0 || c.markedUnread;
    const last = c.msgs[c.msgs.length - 1];
    const time = when(c.lastTs);
    const mark = c.pinned ? '◆ ' : '';
    const nameW = inner - stringWidth(time) - stringWidth(mark) - 2;
    const name = pad(cut(store.nameOf(c.id), nameW), nameW);
    const badge = c.unread > 0 ? ` ${c.unread > 99 ? '99+' : c.unread} ` : c.markedUnread ? ' ● ' : '';
    const prevW = inner - stringWidth(badge) - 1;
    let preview = c.id === typingId ? 'escribiendo…' : last ? (last.fromMe ? 'Tú: ' : c.isGroup ? store.nameOf(last.sender).split(' ')[0] + ': ' : '') + last.text : '';
    preview = pad(cut(preview, prevW), prevW);
    rows.push(
      h(
        Text,
        { key: c.id + 'a', wrap: 'truncate', backgroundColor: bg },
        ' ',
        mark ? h(Text, { color: SOFT }, mark) : null,
        h(Text, { bold: unread || isSel, dimColor: !unread && !isOpen && !isSel }, name),
        h(Text, { dimColor: !unread, color: unread ? SOFT : undefined }, ' ' + time),
        ' ',
      ),
      h(
        Text,
        { key: c.id + 'b', wrap: 'truncate', backgroundColor: bg },
        ' ',
        h(Text, { dimColor: true, italic: c.id === typingId }, preview),
        badge ? h(Text, { inverse: true, color: SOFT }, badge) : '',
        ' ',
      ),
      h(Text, { key: c.id + 'c' }, ' '),
    );
  }
  return h(
    Box,
    { flexDirection: 'column', width, height, borderStyle: 'single', borderTop: false, borderBottom: false, borderLeft: false, borderColor: focused ? SOFT : '#3a3a3a' },
    h(Text, { bold: true, dimColor: !focused, wrap: 'truncate' }, ' Chats' + (chats.length ? ` (${chats.length})` : '')),
    h(Text, null, ' '),
    ...rows,
  );
}

// Modo jefe: árbol de ficheros de mentira
function FakeTree({ width, height }) {
  return h(
    Box,
    { flexDirection: 'column', width, height, borderStyle: 'single', borderTop: false, borderBottom: false, borderLeft: false, borderColor: 'gray' },
    h(Text, { bold: true, dimColor: true }, ' EXPLORER'),
    h(Text, { dimColor: true }, ' ▾ ~/api'),
    ...BOSS_TREE.slice(0, height - 2).map((l, i) =>
      h(
        Text,
        { key: i, wrap: 'truncate' },
        h(Text, { color: l.mark ? ACCENT : undefined }, ' ' + (l.mark || ' ') + ' '),
        h(Text, { bold: l.strong, dimColor: l.dim }, l.label),
      ),
    ),
  );
}

// ---------- App ----------

export function App({ backend, store, cwd, demo, dataDir }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();

  const [value, setValue] = useState('');
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState('input'); // 'input' | 'side'
  const [showSide, setShowSide] = useState(true);
  const [scroll, setScroll] = useState(0);
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [qr, setQr] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [typing, setTyping] = useState(null); // id del chat abierto si el otro escribe
  const [boss, setBoss] = useState(null); // { start, verb, entries }
  const [bell, setBell] = useState(false);
  const [, tick] = useState(0);

  const openRef = useRef(null);
  const bossRef = useRef(null);
  const bellRef = useRef(false);
  const qrOpened = useRef(false);
  const bossTimers = useRef([]);
  openRef.current = openId;
  bossRef.current = boss;
  bellRef.current = bell;

  const note = (...es) => setNotes((xs) => [...xs, ...es]);
  const refresh = () => tick((x) => x + 1);

  // fijados primero, luego por último mensaje
  const chatList = () => {
    const list = store.list();
    return [...list.filter((c) => c.pinned), ...list.filter((c) => !c.pinned)];
  };

  const open = (chat) => {
    if (!chat) return;
    setOpenId(chat.id);
    openRef.current = chat.id;
    setSelected(chat.id);
    setScroll(0);
    setNotes([]);
    setTyping(null);
    chat.markedUnread = false;
    backend.markRead(chat.id);
    backend.watch(chat.id);
    store.save();
    refresh();
  };

  const step = (dir) => {
    const list = chatList();
    if (!list.length) return;
    const from = list.findIndex((c) => c.id === (openRef.current ?? selected));
    const i = from < 0 ? 0 : (from + dir + list.length) % list.length;
    open(list[i]);
  };

  // ---- eventos del backend ----
  useEffect(() => {
    const onQr = async (code) => {
      setQr((await QRCode.toString(code, { type: 'terminal' })).split('\n'));
      if (dataDir) {
        const file = path.join(dataDir, 'qr.png');
        fs.mkdirSync(dataDir, { recursive: true });
        await QRCode.toFile(file, code, { width: 480, margin: 4 });
        if (!qrOpened.current) {
          qrOpened.current = true;
          openFile(file);
        }
      }
    };
    const onPairing = (code) => setPairing(code.match(/.{1,4}/g).join('-'));
    const onStatus = (s) => {
      setStatus(s);
      if (s === 'open') {
        setQr(null);
        setPairing(null);
        if (dataDir) fs.rmSync(path.join(dataDir, 'qr.png'), { force: true });
      }
      if (s === 'loggedOut') note({ type: 'info', text: 'Sesión cerrada. Vuelve a arrancar para vincular.', color: 'red' });
      refresh();
    };
    const onMessage = (chatId, m, isNew) => {
      const cur = openRef.current && store.resolve(openRef.current);
      if (cur === chatId) {
        if (!m.fromMe) {
          setTyping(null);
          if (isNew && !bossRef.current) backend.markRead(chatId);
        }
      } else if (isNew && !m.fromMe && bellRef.current) {
        process.stdout.write('\x07');
      }
      refresh();
    };
    const onPresence = (chatId, isTyping) => {
      const cur = openRef.current && store.resolve(openRef.current);
      if (cur !== chatId) return;
      setTyping(isTyping ? chatId : null);
    };
    const onChats = () => refresh();
    const onError = (err) => note({ type: 'info', text: 'Error: ' + (err?.message || err), color: 'red' });

    const evs = { qr: onQr, pairing: onPairing, status: onStatus, message: onMessage, presence: onPresence, chats: onChats, error: onError };
    for (const [k, fn] of Object.entries(evs)) backend.on(k, fn);
    backend.start().catch(onError);
    return () => {
      for (const [k, fn] of Object.entries(evs)) backend.off(k, fn);
    };
  }, []);

  // ---- modo jefe ----
  const startBoss = () => {
    setBoss({ start: Date.now(), verb: 'Thinking', entries: [{ type: 'prompt', text: BOSS_PROMPT }] });
    setFocus('input');
    let t = 0;
    bossTimers.current = BOSS_SCRIPT.map((s, i) => {
      t += s.wait;
      return setTimeout(() => {
        setBoss((cur) => cur && { ...cur, verb: SPINNER_VERBS[(i + 3) % SPINNER_VERBS.length], entries: [...cur.entries, s] });
      }, t);
    });
  };
  const stopBoss = () => {
    bossTimers.current.forEach(clearTimeout);
    bossTimers.current = [];
    setBoss(null);
    if (openRef.current) backend.markRead(openRef.current);
  };

  // ---- teclado ----
  useInput((input, key) => {
    if (key.escape) return (bossRef.current ? stopBoss : startBoss)();
    if (bossRef.current) return;
    if (key.tab) {
      if (focus === 'input' && showSide && !selected) setSelected(openRef.current ?? chatList()[0]?.id ?? null);
      return setFocus((f) => (f === 'input' && showSide ? 'side' : 'input'));
    }
    if ((key.ctrl && input === 'n') || (key.meta && key.downArrow)) return step(1);
    if ((key.ctrl && input === 'p') || (key.meta && key.upArrow)) return step(-1);
    if (key.ctrl && input === 'u') {
      const list = chatList();
      const from = list.findIndex((c) => c.id === openRef.current);
      const next = [...list.slice(from + 1), ...list.slice(0, from + 1)].find((c) => c.unread > 0 || c.markedUnread);
      if (next) open(next);
      return;
    }
    if (key.ctrl && input === 'b') {
      setShowSide((s) => !s);
      setFocus('input');
      return;
    }
    if (key.pageUp) return setScroll((s) => s + Math.max(3, rows - 10));
    if (key.pageDown) return setScroll((s) => Math.max(0, s - Math.max(3, rows - 10)));

    if (focus !== 'side') return;
    const list = chatList();
    const i = list.findIndex((c) => c.id === selected);
    const sel = list[i];
    if (key.upArrow || input === 'k') return list.length && setSelected(list[Math.max(0, i - 1)].id);
    if (key.downArrow || input === 'j') return list.length && setSelected(list[Math.min(list.length - 1, i + 1)].id);
    if (key.return) {
      open(sel);
      return setFocus('input');
    }
    if (key.rightArrow) return setFocus('input');
    if (!sel) return;
    if (input === 'p') {
      sel.pinned = !sel.pinned;
      store.save();
      return refresh();
    }
    if (input === 'u') {
      sel.markedUnread = true;
      if (sel.id === openRef.current) setOpenId(null);
      store.save();
      return refresh();
    }
    if (input === 'r') {
      sel.markedUnread = false;
      backend.markRead(sel.id);
      return refresh();
    }
  });

  // ---- comandos ----
  const run = async (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    const chat = openRef.current && store.chat(openRef.current);
    switch (cmd) {
      case '/open':
      case '/o': {
        if (!arg) return note({ type: 'info', text: 'Uso: /open <nombre>' });
        const q = slug(arg);
        const found = chatList().find((c) => slug(store.nameOf(c.id)).includes(q));
        if (!found) return note({ type: 'info', text: `Ningún chat coincide con «${arg}»`, color: 'yellow' });
        return open(found);
      }
      case '/chats':
      case '/c':
        setShowSide(true);
        return setFocus('side');
      case '/back':
      case '/b':
        setOpenId(null);
        setTyping(null);
        return setNotes([]);
      case '/view':
      case '/v': {
        let m;
        if (arg) m = store.findMedia(Number(arg.replace('#', '')));
        else m = chat && [...chat.msgs].reverse().find((x) => x.media);
        if (!m) {
          const old = chat && chat.msgs.some((x) => !x.media && /^\[(imagen|vídeo|gif|audio|nota de voz|sticker|documento)\]/.test(x.text));
          return note({
            type: 'info',
            color: 'yellow',
            text: arg
              ? `No hay ningún adjunto #${arg}`
              : old
                ? 'Los adjuntos de este chat son de antes de poder abrirlos («no disponible»). Los que lleguen a partir de ahora sí se abren.'
                : 'No hay adjuntos en este chat',
          });
        }
        const label = m.media.fileName || `#${m.media.n}`;
        note({ type: 'info', text: `Descargando ${label}…` });
        try {
          openFile(await backend.download(m));
          return note({ type: 'info', text: `Abierto ${label} en el visor` });
        } catch (err) {
          return note({ type: 'info', text: `No se pudo abrir ${label}: ${err?.message || err}`, color: 'red' });
        }
      }
      case '/pin':
        if (!chat) return note({ type: 'info', text: 'No hay ningún chat abierto' });
        chat.pinned = !chat.pinned;
        store.save();
        return refresh();
      case '/unread':
        if (!chat) return note({ type: 'info', text: 'No hay ningún chat abierto' });
        chat.markedUnread = true;
        store.save();
        setOpenId(null);
        return refresh();
      case '/bell':
        setBell((b) => !b);
        return note({ type: 'info', text: `Pitido con los mensajes nuevos: ${bell ? 'apagado' : 'encendido'}` });
      case '/clear':
        return setNotes([]);
      case '/boss':
        return startBoss();
      case '/help':
      case '/?':
        return note(
          { type: 'note', title: 'Comandos', lines: COMMANDS.map(([c, d]) => `${c.padEnd(9)} ${d}`) },
          { type: 'note', title: 'Atajos', lines: SHORTCUTS.map(([c, d]) => `${c.padEnd(16)} ${d}`) },
        );
      case '/status':
        return note({ type: 'note', title: 'Estado', lines: [`conexión: ${status}`, `chats: ${store.list().length}`, demo ? 'modo: demo' : 'modo: real'] });
      case '/logout':
        await backend.logout();
        return exit();
      case '/exit':
      case '/quit':
        return exit();
      default:
        return note({ type: 'info', text: `No existe ${cmd}. /help para ver los comandos`, color: 'yellow' });
    }
  };

  const submit = async (raw) => {
    const text = raw.trim();
    setValue('');
    if (!text) return;
    if (bossRef.current) {
      // en modo jefe nunca se envía nada a WhatsApp
      setBoss((b) => b && { ...b, entries: [...b.entries, { type: 'prompt', text }] });
      return;
    }
    if (text === '?') return run('/help');
    if (text.startsWith('/')) return run(text);
    if (!openRef.current) return note({ type: 'info', text: 'No hay ningún chat abierto. Tab para elegir uno de la lista, o /open <nombre>' });
    setScroll(0);
    try {
      await backend.send(openRef.current, text);
    } catch (err) {
      note({ type: 'info', text: 'Error al enviar: ' + (err?.message || err), color: 'red' });
    }
  };

  // ---------- composición ----------
  const sideW = showSide ? Math.max(24, Math.min(38, Math.floor(columns * 0.3))) : 0;
  const paneW = columns - sideW - 3;
  const mainH = Math.max(5, rows - 5); // estado (1) + caja de texto (3) + pie (1)
  const openChat = openId ? store.chat(openId) : null;

  // cabecera y contenido de la derecha
  let title;
  let entries;
  if (boss) {
    title = [{ text: ' ' }];
    entries = boss.entries;
  } else if (pairing) {
    title = [{ text: 'Vincular dispositivo', bold: true }];
    entries = [
      { type: 'info', text: 'En el móvil: Ajustes → Dispositivos vinculados → Vincular un dispositivo → Vincular con el número de teléfono' },
      { type: 'note', title: 'Código', lines: [pairing] },
    ];
  } else if (qr) {
    title = [{ text: 'Vincular dispositivo', bold: true }];
    entries = [
      { type: 'info', text: `Escanea con WhatsApp → Ajustes → Dispositivos vinculados. También como imagen en ${path.join(dataDir || '', 'qr.png')} (se renueva cada ~20 s). Sin QR: whatsterm --pair=34XXXXXXXXX` },
      { type: 'raw', lines: qr },
    ];
  } else if (openChat) {
    title = [
      { text: store.nameOf(openChat.id), bold: true },
      typing ? { text: '  escribiendo…', color: SOFT, italic: true } : { text: openChat.isGroup ? '  grupo' : '', dim: true },
    ];
    entries = [...chatEntries(store, openChat), ...notes];
  } else {
    title = [{ text: ' ' }];
    const pending = store.totalUnread();
    entries = [
      ...(status === 'open' || demo
        ? [{ type: 'info', text: `Elige un chat: Tab para ir a la lista, Ctrl+N para el siguiente${pending ? `, Ctrl+U para los ${pending} sin leer` : ''}. /help para ver todo.` }]
        : [{ type: 'info', text: 'Conectando…' }]),
      ...notes,
    ];
  }

  const lines = toLines(entries, paneW - 1);
  const bodyH = mainH - 2;
  const maxScroll = Math.max(0, lines.length - bodyH);
  const sc = Math.min(scroll, maxScroll);
  const visible = lines.slice(Math.max(0, lines.length - bodyH - sc), lines.length - sc);
  // los mensajes se pegan abajo, como en cualquier chat
  while (visible.length < bodyH) visible.unshift([]);

  // línea de estado
  let statusLine = null;
  if (boss) statusLine = h(Spinner, { verb: boss.verb, start: boss.start });
  else if (sc > 0) statusLine = h(Text, { dimColor: true }, `↓ ${sc} líneas más abajo · PgDn`);

  // pie
  const others = store.totalUnread(openId && store.resolve(openId));
  const suggestion = value.startsWith('/') && !value.includes(' ') ? COMMANDS.find(([c]) => c.startsWith(value)) : null;
  let right = null;
  if (boss) right = others > 0 ? h(Text, { color: ACCENT }, `● ${others} background task${others === 1 ? '' : 's'}`) : null;
  else if (status === 'connecting' || status === 'reconnecting') right = h(Text, { dimColor: true }, status === 'connecting' ? 'conectando…' : 'reconectando…');
  else if (status === 'loggedOut') right = h(Text, { color: 'red' }, 'desvinculado');
  else if (others > 0) right = h(Text, { color: SOFT }, `${others} sin leer en otros chats`);
  const left = boss
    ? h(Text, { dimColor: true }, '? for shortcuts')
    : suggestion
      ? h(Text, null, h(Text, { color: SOFT }, suggestion[0] + '  '), h(Text, { dimColor: true }, suggestion[1]))
      : focus === 'side'
        ? h(Text, { dimColor: true }, '↑↓ moverse · enter abrir · p fijar · u no leído · r leído · tab volver')
        : h(Text, { dimColor: true }, 'tab chats · ctrl+n/p cambiar · ctrl+u sin leer · ? ayuda · esc ocultar');

  return h(
    Box,
    { flexDirection: 'column', width: columns, height: rows },
    h(
      Box,
      { flexDirection: 'row', height: mainH },
      showSide
        ? boss
          ? h(FakeTree, { width: sideW, height: mainH })
          : h(ChatList, { chats: chatList(), store, width: sideW, height: mainH, selected: selected ?? openId, openId, focused: focus === 'side', typingId: typing })
        : null,
      h(
        Box,
        { flexDirection: 'column', paddingLeft: 1, width: paneW + 2 },
        h(Line, { segs: title }),
        h(Text, { dimColor: true }, boss ? ' ' : '─'.repeat(Math.max(0, paneW))),
        ...visible.map((segs, i) => h(Line, { key: i, segs })),
      ),
    ),
    h(Box, { height: 1, paddingLeft: 1 }, statusLine),
    h(
      Box,
      { borderStyle: 'round', borderColor: focus === 'input' ? 'gray' : '#3a3a3a', paddingX: 1, flexDirection: 'row', height: 3 },
      h(Text, { dimColor: focus !== 'input' }, '> '),
      h(Box, { flexGrow: 1 }, h(LineInput, { value, onChange: setValue, onSubmit: submit, focus: focus === 'input', placeholder: boss ? '' : openChat ? 'Escribe un mensaje' : '' })),
    ),
    h(Box, { paddingX: 2, height: 1, justifyContent: 'space-between' }, h(Box, { flexShrink: 1 }, left), right),
  );
}
