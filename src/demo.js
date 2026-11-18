// Fake backend to try the UI without linking a phone: `npm run demo`.
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

const now = Date.now();
const min = 60_000;

const CHATS = [
  { id: 'anna@s.whatsapp.net', name: 'Anna', unread: 2, msgs: [
    [false, 'hey!! how is your morning going?', 95], [true, 'busy, shipping the release today', 93],
    [true, 'but good, you?', 93], [false, 'fine, stuck on the sales report', 90],
    [false, 'lunch?', 14], [true, 'in 10 min', 12], [false, 'ok, see you downstairs', 3],
    [false, '[image] look at this queue', 2] ] },
  { id: 'mike@s.whatsapp.net', name: 'Mike', unread: 0, msgs: [
    [false, 'did you watch the game?', 120], [true, 'yes, what a finish', 118] ] },
  { id: 'fam@g.us', name: 'Family', isGroup: true, unread: 5, msgs: [
    [false, "sunday lunch at grandma's", 300, 'mom@s.whatsapp.net'],
    [false, "who's bringing dessert?", 298, 'mom@s.whatsapp.net'],
    [false, '[voice note]', 290, 'dad@s.whatsapp.net'], [true, "I'll bring dessert", 282],
    [true, "I'll be there", 280], [false, 'great, see you there', 270, 'lucy@s.whatsapp.net'] ] },
  { id: 'padel@g.us', name: 'Thursday padel', isGroup: true, unread: 0, msgs: [
    [false, 'court booked for 7:30pm', 600, 'mike@s.whatsapp.net'], [true, "I'm in", 590] ] },
  { id: 'boss@s.whatsapp.net', name: 'Martha (work)', unread: 0, msgs: [[false, 'meeting tomorrow at 9', 1440]] },
  { id: 'lucy@s.whatsapp.net', name: 'Lucy', unread: 0, msgs: [[true, "I'll send you the photos later", 2000], [false, 'great, thanks', 1990]] },
  { id: 'landlord@s.whatsapp.net', name: 'James (flat)', unread: 0, msgs: [[false, 'the boiler technician is coming on monday', 4000]] },
];

export class Demo extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
  }

  async start() {
    this.store.setName('mom@s.whatsapp.net', 'Mom');
    this.store.setName('dad@s.whatsapp.net', 'Dad');
    this.store.setName('lucy@s.whatsapp.net', 'Lucy');
    this.store.setName('mike@s.whatsapp.net', 'Mike');
    for (const c of CHATS) {
      const chat = this.store.chat(c.id, { name: c.name, isGroup: !!c.isGroup });
      chat.unread = c.unread;
      c.msgs.forEach(([fromMe, text, ago, sender], i) => {
        let media = null;
        if (/^\[(image|voice note)\]/.test(text)) {
          media = { n: ++this.store.mediaSeq, ext: 'png', fileName: null };
          text = text.replace(/^\[([^\]]+)\]/, `[$1 #${media.n}]`);
        }
        this.store.addMsg(c.id, { id: c.id + i, fromMe, text, ts: now - ago * min, sender: fromMe ? 'me' : sender ?? c.id, media });
      });
    }
    setTimeout(() => this.emit('status', 'open'), 300);
    // Mike starts typing and sends something a few seconds in
    setTimeout(() => this.emit('presence', 'mike@s.whatsapp.net', true), 6000);
    setTimeout(() => {
      this.emit('presence', 'mike@s.whatsapp.net', false);
      this.incoming('mike@s.whatsapp.net', 'padel on thursday?');
    }, 9000);
  }

  incoming(chatId, text) {
    const msg = { id: 'd' + Date.now(), fromMe: false, sender: chatId, text, ts: Date.now() };
    this.store.addMsg(chatId, msg);
    const chat = this.store.chat(chatId);
    chat.unread = (chat.unread || 0) + 1;
    this.emit('message', chatId, msg, true);
  }

  async send(chatId, text) {
    const msg = { id: 'm' + Date.now(), fromMe: true, sender: 'me', text, ts: Date.now() };
    this.store.addMsg(chatId, msg);
    this.emit('message', chatId, msg, false);
    // the other side replies
    setTimeout(() => this.emit('presence', chatId, true), 1500);
    setTimeout(() => {
      this.emit('presence', chatId, false);
      this.incoming(chatId, 'haha ok');
    }, 4000);
  }

  // in the demo, the "attachment" is a PNG generated on the fly
  async download(msg) {
    const { default: QRCode } = await import('qrcode');
    const file = path.join(os.tmpdir(), `whatsterm-demo-${msg.media.n}.png`);
    await QRCode.toFile(file, 'whatsterm demo #' + msg.media.n, { width: 300 });
    return file;
  }

  async markRead(chatId) {
    this.store.chat(chatId).unread = 0;
  }

  async watch() {}
  async logout() {}
  stop() {}
}
