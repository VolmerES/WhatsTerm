// Backend de mentira para probar la interfaz sin vincular el móvil: `npm run demo`.
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

const ahora = Date.now();
const min = 60_000;

const CHATS = [
  { id: 'ana@s.whatsapp.net', name: 'Ana', unread: 2, msgs: [
    [false, 'buenas!! ¿qué tal la mañana?', 95], [true, 'liado, con la release de hoy', 93],
    [true, 'pero bien, ¿y tú?', 93], [false, 'bien, aquí con el informe de ventas', 90],
    [false, '¿bajas a comer?', 14], [true, 'en 10 min', 12], [false, 'vale, te espero abajo', 3],
    [false, '[imagen] mira qué cola hay', 2] ] },
  { id: 'curro@s.whatsapp.net', name: 'Curro', unread: 0, msgs: [
    [false, '¿te pasaste el partido?', 120], [true, 'sí, qué final', 118] ] },
  { id: 'fam@g.us', name: 'Familia', isGroup: true, unread: 5, msgs: [
    [false, 'el domingo comemos en casa de la abuela', 300, 'mama@s.whatsapp.net'],
    [false, '¿quién trae el postre?', 298, 'mama@s.whatsapp.net'],
    [false, '[nota de voz]', 290, 'papa@s.whatsapp.net'], [true, 'yo llevo el postre', 282],
    [true, 'allí estaré', 280], [false, 'perfecto, nos vemos allí', 270, 'lucia@s.whatsapp.net'] ] },
  { id: 'padel@g.us', name: 'Pádel jueves', isGroup: true, unread: 0, msgs: [
    [false, 'pista reservada a las 19:30', 600, 'curro@s.whatsapp.net'], [true, 'me apunto', 590] ] },
  { id: 'jefe@s.whatsapp.net', name: 'Marta (trabajo)', unread: 0, msgs: [[false, 'mañana reunión a las 9', 1440]] },
  { id: 'lucia@s.whatsapp.net', name: 'Lucía', unread: 0, msgs: [[true, 'te paso las fotos luego', 2000], [false, 'genial, gracias', 1990]] },
  { id: 'casero@s.whatsapp.net', name: 'Javier (piso)', unread: 0, msgs: [[false, 'el lunes pasa el técnico de la caldera', 4000]] },
];

export class Demo extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
  }

  async start() {
    this.store.setName('mama@s.whatsapp.net', 'Mamá');
    this.store.setName('papa@s.whatsapp.net', 'Papá');
    this.store.setName('lucia@s.whatsapp.net', 'Lucía');
    this.store.setName('curro@s.whatsapp.net', 'Curro');
    for (const c of CHATS) {
      const chat = this.store.chat(c.id, { name: c.name, isGroup: !!c.isGroup });
      chat.unread = c.unread;
      c.msgs.forEach(([fromMe, text, hace, sender], i) => {
        let media = null;
        if (/^\[(imagen|nota de voz)\]/.test(text)) {
          media = { n: ++this.store.mediaSeq, ext: 'png', fileName: null };
          text = text.replace(/^\[([^\]]+)\]/, `[$1 #${media.n}]`);
        }
        this.store.addMsg(c.id, { id: c.id + i, fromMe, text, ts: ahora - hace * min, sender: fromMe ? 'me' : sender ?? c.id, media });
      });
    }
    setTimeout(() => this.emit('status', 'open'), 300);
    // Curro escribe y manda algo a los pocos segundos
    setTimeout(() => this.emit('presence', 'curro@s.whatsapp.net', true), 6000);
    setTimeout(() => {
      this.emit('presence', 'curro@s.whatsapp.net', false);
      this.incoming('curro@s.whatsapp.net', '¿echamos un pádel el jueves?');
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
    // el otro contesta
    setTimeout(() => this.emit('presence', chatId, true), 1500);
    setTimeout(() => {
      this.emit('presence', chatId, false);
      this.incoming(chatId, 'jajaja vale');
    }, 4000);
  }

  // en la demo, el «adjunto» es un PNG generado al vuelo
  async download(msg) {
    const { default: QRCode } = await import('qrcode');
    const file = path.join(os.tmpdir(), `wa-terminal-demo-${msg.media.n}.png`);
    await QRCode.toFile(file, 'wa-terminal demo #' + msg.media.n, { width: 300 });
    return file;
  }

  async markRead(chatId) {
    this.store.chat(chatId).unread = 0;
  }

  async watch() {}
  async logout() {}
  stop() {}
}
