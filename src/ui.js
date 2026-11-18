// Full-screen UI, like a regular terminal chat: chat list on the left, the
// conversation on the right (yours on the right, theirs on the left) and the
// text box at the bottom. Muted colors so it doesn't draw attention. The coding
// assistant disguise is boss mode (Esc).
import React, { useEffect, useRef, useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import QRCode from 'qrcode';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { LineInput } from './input.js';
import { bossSession, BOSS_TREE, SPINNER_VERBS } from './boss.js';

const h = React.createElement;
const ACCENT = '#D77757'; // boss mode only
const SOFT = '#a8b4c0'; // names and markers, discreet
const ME_BG = '#2b2f33';
const SEL_BG = '#2b2f33';
const SENDER_COLORS = ['#c9b98a', '#8fa9c9', '#b59ac4', '#86b8b8', '#9fbf8f', '#c98f8f', '#c4a582'];
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const GROUP_GAP = 10 * 60_000; // after 10 min of silence, the sender's name is shown again
// attachment labels, in English and in Spanish (older versions saved them in Spanish)
const OLD_MEDIA = /^\[(image|video|gif|audio|voice note|sticker|document|imagen|vídeo|nota de voz|documento)\]/;

// opens a file with the system's default app (WA_TERMINAL_NO_OPEN=1 disables it, for tests)
const OPEN_CMD = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const openFile = (file) => process.env.WA_TERMINAL_NO_OPEN || exec(`${OPEN_CMD} "${file}"`);

const COMMANDS = [
  ['/open', 'Open a chat by name: /open ana'],
  ['/view', 'Open an attachment: /view 3, or the latest in the chat'],
  ['/pin', 'Pin or unpin this chat'],
  ['/unread', 'Mark this chat as unread'],
  ['/back', 'Close the chat'],
  ['/bell', 'Terminal bell on new messages'],
  ['/clear', 'Clear notes from the screen'],
  ['/boss', 'Boss mode (also Esc)'],
  ['/status', 'Connection status'],
  ['/help', 'Commands and shortcuts'],
  ['/logout', 'Unlink this device'],
  ['/exit', 'Quit'],
];

const SHORTCUTS = [
  ['Tab', 'Switch between the text box and the chat list'],
  ['↑ ↓ / j k', 'In the list: move. Enter: open'],
  ['p · u · r', 'In the list: pin · mark unread · mark read'],
  ['Ctrl+N / Ctrl+P', 'Next / previous chat (also Alt+↓ / Alt+↑)'],
  ['Ctrl+U', 'Next chat with unread messages'],
  ['PgUp / PgDn', 'Scroll the conversation'],
  ['Ctrl+B', 'Hide / show the chat list'],
  ['Esc', 'Boss mode'],
  ['Ctrl+C', 'Quit'],
];

// ---------- helpers ----------

const slug = (s) =>
  (s || 'chat')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'chat';

const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (ts) => {
  if (sameDay(ts, Date.now())) return 'today';
  if (sameDay(ts, Date.now() - 86_400_000)) return 'yesterday';
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
};
// the time if it's today, "yesterday", or the short date
const when = (ts) => {
  if (!ts) return '';
  if (sameDay(ts, Date.now())) return hhmm(ts);
  if (sameDay(ts, Date.now() - 86_400_000)) return 'yesterday';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
};

const cut = (s, n) => {
  // line breaks become spaces; leading spaces (tree indentation) are kept
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

// ---------- from entries to lines ----------
// A line is a list of segments { text, color, bg, bold, dim }.

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
    // their messages: on the left, with the sender's name in groups
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
    // yours: on the right, on a soft grey background
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
    // the ones below are for boss mode
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
    // attachments without a number were saved before they could be opened: say so
    const text = /^\[[^\]#]+\]/.test(m.text) && !m.media && OLD_MEDIA.test(m.text)
      ? m.text.replace(/^\[([^\]]+)\]/, '[$1, unavailable]')
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

// ---------- side list ----------

// Chats: two lines per chat (name and time; preview and unread count)
function ChatList({ chats, store, width, height, selected, openId, focused, typingId }) {
  const inner = width - 2;
  const per = 3; // two lines and a gap
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
    let preview = c.id === typingId ? 'typing…' : last ? (last.fromMe ? 'You: ' : c.isGroup ? store.nameOf(last.sender).split(' ')[0] + ': ' : '') + last.text : '';
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

// Boss mode: fake file tree
function FakeTree({ width, height, touched }) {
  return h(
    Box,
    { flexDirection: 'column', width, height, borderStyle: 'single', borderTop: false, borderBottom: false, borderLeft: false, borderColor: 'gray' },
    h(Text, { bold: true, dimColor: true }, ' EXPLORER'),
    h(Text, { dimColor: true }, ' ▾ ~/api'),
    ...BOSS_TREE.slice(0, height - 2).map((l, i) => {
      const hit = l.path && touched.includes(l.path);
      return h(
        Text,
        { key: i, wrap: 'truncate' },
        h(Text, { color: hit ? ACCENT : undefined }, hit ? ' ● ' : '   '),
        h(Text, { bold: l.strong || hit, dimColor: l.dim || (l.path && !hit) }, l.label),
      );
    }),
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
  const [typing, setTyping] = useState(null); // id of the open chat when the other side is typing
  const [boss, setBoss] = useState(null); // { start, verb, entries, touched, idle }
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

  // pinned first, then by latest message
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

  // ---- backend events ----
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
      if (s === 'loggedOut') note({ type: 'info', text: 'Logged out. Start again to link a device.', color: 'red' });
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

  // ---- boss mode ----
  // applies one step of the fake session (see bossSession in boss.js)
  const bossStep = (cur, s) => {
    if (s.newTask) return { ...cur, start: Date.now(), verb: 'Thinking', idle: false, touched: [], entries: [...cur.entries, s.entry].slice(-80) };
    return {
      ...cur,
      verb: SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)],
      idle: !!s.idle,
      touched: s.touch && !cur.touched.includes(s.touch) ? [...cur.touched, s.touch] : cur.touched,
      entries: [...cur.entries, s.entry].slice(-80),
    };
  };
  const startBoss = () => {
    const steps = bossSession();
    setBoss(bossStep({ entries: [], touched: [] }, steps.next().value));
    setFocus('input');
    const tick = () => {
      const s = steps.next().value;
      bossTimers.current = [
        setTimeout(() => {
          setBoss((cur) => cur && bossStep(cur, s));
          tick();
        }, s.wait),
      ];
    };
    tick();
  };
  const stopBoss = () => {
    bossTimers.current.forEach(clearTimeout);
    bossTimers.current = [];
    setBoss(null);
    if (openRef.current) backend.markRead(openRef.current);
  };

  // ---- keyboard ----
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

  // ---- commands ----
  const run = async (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    const chat = openRef.current && store.chat(openRef.current);
    switch (cmd) {
      case '/open':
      case '/o': {
        if (!arg) return note({ type: 'info', text: 'Usage: /open <name>' });
        const q = slug(arg);
        const found = chatList().find((c) => slug(store.nameOf(c.id)).includes(q));
        if (!found) return note({ type: 'info', text: `No chat matches "${arg}"`, color: 'yellow' });
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
          const old = chat && chat.msgs.some((x) => !x.media && OLD_MEDIA.test(x.text));
          return note({
            type: 'info',
            color: 'yellow',
            text: arg
              ? `There is no attachment #${arg}`
              : old
                ? "This chat's attachments were saved before they could be opened (\"unavailable\"). New ones will open fine."
                : 'No attachments in this chat',
          });
        }
        const label = m.media.fileName || `#${m.media.n}`;
        note({ type: 'info', text: `Downloading ${label}…` });
        try {
          openFile(await backend.download(m));
          return note({ type: 'info', text: `Opened ${label} in the viewer` });
        } catch (err) {
          return note({ type: 'info', text: `Couldn't open ${label}: ${err?.message || err}`, color: 'red' });
        }
      }
      case '/pin':
        if (!chat) return note({ type: 'info', text: 'No chat is open' });
        chat.pinned = !chat.pinned;
        store.save();
        return refresh();
      case '/unread':
        if (!chat) return note({ type: 'info', text: 'No chat is open' });
        chat.markedUnread = true;
        store.save();
        setOpenId(null);
        return refresh();
      case '/bell':
        setBell((b) => !b);
        return note({ type: 'info', text: `Bell on new messages: ${bell ? 'off' : 'on'}` });
      case '/clear':
        return setNotes([]);
      case '/boss':
        return startBoss();
      case '/help':
      case '/?':
        return note(
          { type: 'note', title: 'Commands', lines: COMMANDS.map(([c, d]) => `${c.padEnd(9)} ${d}`) },
          { type: 'note', title: 'Shortcuts', lines: SHORTCUTS.map(([c, d]) => `${c.padEnd(16)} ${d}`) },
        );
      case '/status':
        return note({ type: 'note', title: 'Status', lines: [`connection: ${status}`, `chats: ${store.list().length}`, demo ? 'mode: demo' : 'mode: live'] });
      case '/logout':
        await backend.logout();
        return exit();
      case '/exit':
      case '/quit':
        return exit();
      default:
        return note({ type: 'info', text: `Unknown command ${cmd}. /help lists them`, color: 'yellow' });
    }
  };

  const submit = async (raw) => {
    const text = raw.trim();
    setValue('');
    if (!text) return;
    if (bossRef.current) {
      // nothing is ever sent to WhatsApp in boss mode
      setBoss((b) => b && { ...b, entries: [...b.entries, { type: 'prompt', text }] });
      return;
    }
    if (text === '?') return run('/help');
    if (text.startsWith('/')) return run(text);
    if (!openRef.current) return note({ type: 'info', text: 'No chat is open. Tab to pick one from the list, or /open <name>' });
    setScroll(0);
    try {
      await backend.send(openRef.current, text);
    } catch (err) {
      note({ type: 'info', text: "Couldn't send: " + (err?.message || err), color: 'red' });
    }
  };

  // ---------- layout ----------
  const sideW = showSide ? Math.max(24, Math.min(38, Math.floor(columns * 0.3))) : 0;
  const paneW = columns - sideW - 3;
  const mainH = Math.max(5, rows - 5); // status (1) + text box (3) + footer (1)
  const openChat = openId ? store.chat(openId) : null;

  // header and content of the right pane
  let title;
  let entries;
  if (boss) {
    title = [{ text: ' ' }];
    entries = boss.entries;
  } else if (pairing) {
    title = [{ text: 'Link a device', bold: true }];
    entries = [
      { type: 'info', text: 'On your phone: Settings → Linked devices → Link a device → Link with phone number instead' },
      { type: 'note', title: 'Code', lines: [pairing] },
    ];
  } else if (qr) {
    title = [{ text: 'Link a device', bold: true }];
    entries = [
      { type: 'info', text: `Scan with WhatsApp → Settings → Linked devices. Also saved as an image at ${path.join(dataDir || '', 'qr.png')} (refreshes every ~20 s). No QR: whatsterm --pair=<number with country code>` },
      { type: 'raw', lines: qr },
    ];
  } else if (openChat) {
    title = [
      { text: store.nameOf(openChat.id), bold: true },
      typing ? { text: '  typing…', color: SOFT, italic: true } : { text: openChat.isGroup ? '  group' : '', dim: true },
    ];
    entries = [...chatEntries(store, openChat), ...notes];
  } else {
    title = [{ text: ' ' }];
    const pending = store.totalUnread();
    entries = [
      ...(status === 'open' || demo
        ? [{ type: 'info', text: `Pick a chat: Tab to go to the list, Ctrl+N for the next one${pending ? `, Ctrl+U for the ${pending} unread` : ''}. /help for everything.` }]
        : [{ type: 'info', text: 'Connecting…' }]),
      ...notes,
    ];
  }

  const lines = toLines(entries, paneW - 1);
  const bodyH = mainH - 2;
  const maxScroll = Math.max(0, lines.length - bodyH);
  const sc = Math.min(scroll, maxScroll);
  const visible = lines.slice(Math.max(0, lines.length - bodyH - sc), lines.length - sc);
  // messages stick to the bottom, like in any chat
  while (visible.length < bodyH) visible.unshift([]);

  // status line
  let statusLine = null;
  if (boss) statusLine = boss.idle ? null : h(Spinner, { verb: boss.verb, start: boss.start });
  else if (sc > 0) statusLine = h(Text, { dimColor: true }, `↓ ${sc} more lines below · PgDn`);

  // footer
  const others = store.totalUnread(openId && store.resolve(openId));
  const suggestion = value.startsWith('/') && !value.includes(' ') ? COMMANDS.find(([c]) => c.startsWith(value)) : null;
  let right = null;
  if (boss) right = others > 0 ? h(Text, { color: ACCENT }, `● ${others} background task${others === 1 ? '' : 's'}`) : null;
  else if (status === 'connecting' || status === 'reconnecting') right = h(Text, { dimColor: true }, status === 'connecting' ? 'connecting…' : 'reconnecting…');
  else if (status === 'loggedOut') right = h(Text, { color: 'red' }, 'logged out');
  else if (others > 0) right = h(Text, { color: SOFT }, `${others} unread in other chats`);
  const left = boss
    ? h(Text, { dimColor: true }, '? for shortcuts')
    : suggestion
      ? h(Text, null, h(Text, { color: SOFT }, suggestion[0] + '  '), h(Text, { dimColor: true }, suggestion[1]))
      : focus === 'side'
        ? h(Text, { dimColor: true }, '↑↓ move · enter open · p pin · u unread · r read · tab back')
        : h(Text, { dimColor: true }, 'tab chats · ctrl+n/p switch · ctrl+u unread · ? help · esc hide');

  return h(
    Box,
    { flexDirection: 'column', width: columns, height: rows },
    h(
      Box,
      { flexDirection: 'row', height: mainH },
      showSide
        ? boss
          ? h(FakeTree, { width: sideW, height: mainH, touched: boss.touched })
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
      h(Box, { flexGrow: 1 }, h(LineInput, { value, onChange: setValue, onSubmit: submit, focus: focus === 'input', placeholder: boss ? '' : openChat ? 'Type a message' : '' })),
    ),
    h(Box, { paddingX: 2, height: 1, justifyContent: 'space-between' }, h(Box, { flexShrink: 1 }, left), right),
  );
}
