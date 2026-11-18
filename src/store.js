// Chat and name store. Saved to <data>/store.json so that chats and names are
// still there on the next start, even if WhatsApp doesn't resend the history.
import fs from 'node:fs';
import path from 'node:path';

const MAX_MSGS = 150;

export class Store {
  constructor(file) {
    this.file = file;
    this.chats = new Map(); // id -> { id, name, isGroup, unread, lastTs, msgs: [] }
    this.names = new Map(); // jid -> name
    this.alias = new Map(); // alternative jid (lid <-> pn) -> chat id
    this.mediaSeq = 0; // attachment numbering: [image #3]
    this.timer = null;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const c of data.chats ?? []) this.chats.set(c.id, c);
      for (const [k, v] of data.names ?? []) this.names.set(k, v);
      for (const [k, v] of data.alias ?? []) this.alias.set(k, v);
      this.mediaSeq = data.mediaSeq ?? 0;
    } catch {
      // corrupt file: start from scratch
    }
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data = {
      chats: [...this.chats.values()],
      names: [...this.names],
      alias: [...this.alias],
      mediaSeq: this.mediaSeq,
    };
    fs.writeFileSync(this.file, JSON.stringify(data));
  }

  resolve(id) {
    return this.alias.get(id) ?? id;
  }

  link(id, alt) {
    if (!id || !alt || id === alt) return;
    const a = this.resolve(id);
    if (!this.alias.has(alt) && alt !== a) this.alias.set(alt, a);
  }

  setName(jid, name) {
    if (!jid || !name) return;
    this.names.set(jid, name);
  }

  nameOf(jid) {
    if (!jid) return '?';
    const id = this.resolve(jid);
    const chat = this.chats.get(id);
    return (
      this.names.get(jid) ??
      this.names.get(id) ??
      chat?.name ??
      '+' + jid.split('@')[0].split(':')[0]
    );
  }

  chat(id, extra = {}) {
    const real = this.resolve(id);
    let c = this.chats.get(real);
    if (!c) {
      c = { id: real, name: null, isGroup: real.endsWith('@g.us'), unread: 0, lastTs: 0, msgs: [] };
      this.chats.set(real, c);
    }
    Object.assign(c, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
    return c;
  }

  // Returns true if the message is new
  addMsg(chatId, msg) {
    const c = this.chat(chatId);
    if (c.msgs.some((m) => m.id === msg.id)) return false;
    c.msgs.push(msg);
    c.msgs.sort((a, b) => a.ts - b.ts);
    if (c.msgs.length > MAX_MSGS) c.msgs.splice(0, c.msgs.length - MAX_MSGS);
    if (msg.ts > c.lastTs) c.lastTs = msg.ts;
    this.save();
    return true;
  }

  findMedia(n) {
    for (const c of this.chats.values()) {
      const m = c.msgs.find((x) => x.media?.n === n);
      if (m) return m;
    }
    return null;
  }

  list() {
    return [...this.chats.values()]
      .filter((c) => c.lastTs > 0 || c.msgs.length)
      .sort((a, b) => b.lastTs - a.lastTs);
  }

  totalUnread(exceptId) {
    let n = 0;
    for (const c of this.chats.values()) if (c.id !== exceptId) n += c.unread || 0;
    return n;
  }
}
