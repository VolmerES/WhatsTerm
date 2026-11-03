// Conexión con WhatsApp mediante Baileys (cliente no oficial).
// Configuración conservadora para no llamar la atención:
//  - no se marca «en línea» al conectar,
//  - no se pide el historial completo,
//  - se presenta como WhatsApp de escritorio,
//  - nada de envíos automáticos: solo se manda lo que escribes tú.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  normalizeMessageContent,
  proto,
  toNumber,
  useMultiFileAuthState,
} from 'baileys';

const MEDIA = {
  imageMessage: 'jpg',
  videoMessage: 'mp4',
  audioMessage: 'ogg',
  stickerMessage: 'webp',
  documentMessage: 'bin',
};

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

// Si el mensaje trae un adjunto, devuelve lo necesario para descargarlo más tarde:
// el mensaje en protobuf (base64), sin la miniatura para no engordar store.json.
function mediaOf(m) {
  const content = normalizeMessageContent(m.message);
  const type = content && getContentType(content);
  if (!MEDIA[type]) return null;
  const inner = content[type];
  const slim = { ...inner, jpegThumbnail: undefined };
  const raw = proto.WebMessageInfo.encode({ key: m.key, message: { [type]: slim } }).finish();
  const fromName = inner.fileName && path.extname(inner.fileName).slice(1);
  const ext = fromName || EXT[(inner.mimetype || '').split(';')[0]] || MEDIA[type];
  return { raw: Buffer.from(raw).toString('base64'), ext, fileName: inner.fileName || null };
}

const IGNORAR = (jid) =>
  !jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast');

export function describe(message) {
  const m = normalizeMessageContent(message);
  if (!m) return null;
  const type = getContentType(m);
  const c = m[type];
  switch (type) {
    case 'conversation':
      return m.conversation;
    case 'extendedTextMessage':
      return c.text;
    case 'imageMessage':
      return '[imagen]' + (c.caption ? ' ' + c.caption : '');
    case 'videoMessage':
      return (c.gifPlayback ? '[gif]' : '[vídeo]') + (c.caption ? ' ' + c.caption : '');
    case 'audioMessage':
      return c.ptt ? '[nota de voz]' : '[audio]';
    case 'stickerMessage':
      return '[sticker]';
    case 'documentMessage':
    case 'documentWithCaptionMessage':
      return '[documento] ' + (c.fileName ?? c.message?.documentMessage?.fileName ?? '');
    case 'locationMessage':
    case 'liveLocationMessage':
      return '[ubicación]';
    case 'contactMessage':
    case 'contactsArrayMessage':
      return '[contacto] ' + (c.displayName ?? '');
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return '[encuesta] ' + (c.name ?? '');
    case 'reactionMessage':
      return c.text ? `[reacción ${c.text}]` : null;
    case 'protocolMessage':
    case 'senderKeyDistributionMessage':
    case 'messageContextInfo':
    case 'pollUpdateMessage':
      return null;
    default:
      return type ? `[${type.replace(/Message$/, '')}]` : null;
  }
}

export class WhatsApp extends EventEmitter {
  constructor({ store, dataDir, pairPhone }) {
    super();
    this.pairPhone = pairPhone ? pairPhone.replace(/\D/g, '') : null;
    this.pairRequested = false;
    this.store = store;
    this.dataDir = dataDir;
    this.authDir = path.join(dataDir, 'auth');
    this.logger = pino({ level: 'warn' }, pino.destination({ dest: path.join(dataDir, 'wa.log'), mkdir: true, sync: false }));
    this.sent = new Map(); // id -> contenido, para reintentos de cifrado
    this.sock = null;
    this.stopped = false;
  }

  async start() {
    this.pairRequested = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      // sin red para consultar la versión: se usa la que trae Baileys
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: this.logger,
      browser: Browsers.windows('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => this.sent.get(key.id),
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      if (u.qr) {
        if (this.pairPhone) {
          // vincular con número: se pide el código una sola vez por conexión
          if (!this.pairRequested) {
            this.pairRequested = true;
            sock
              .requestPairingCode(this.pairPhone)
              .then((code) => this.emit('pairing', code))
              .catch((e) => this.emit('error', e));
          }
        } else {
          this.emit('qr', u.qr);
        }
      }
      if (u.connection === 'open') {
        this.emit('status', 'open');
        this.loadGroups();
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(this.authDir, { recursive: true, force: true });
          this.emit('status', 'loggedOut');
          return;
        }
        if (this.stopped) return;
        this.emit('status', 'reconnecting');
        // espera creciente para no martillear los servidores
        this.retries = (this.retries ?? 0) + 1;
        const wait = code === DisconnectReason.restartRequired ? 0 : Math.min(30, 2 ** this.retries) * 1000;
        setTimeout(() => this.start().catch((e) => this.emit('error', e)), wait);
      }
      if (u.connection === 'open') this.retries = 0;
    });

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      for (const ct of contacts ?? []) this.onContact(ct);
      for (const ch of chats ?? []) this.onChat(ch);
      for (const m of messages ?? []) this.onMessage(m, false);
      this.emit('chats');
    });
    sock.ev.on('contacts.upsert', (cs) => cs.forEach((c) => this.onContact(c)));
    sock.ev.on('contacts.update', (cs) => cs.forEach((c) => this.onContact(c)));
    sock.ev.on('chats.upsert', (cs) => {
      cs.forEach((c) => this.onChat(c));
      this.emit('chats');
    });
    sock.ev.on('chats.update', (cs) => {
      cs.forEach((c) => this.onChat(c));
      this.emit('chats');
    });
    sock.ev.on('groups.update', (gs) => gs.forEach((g) => g.id && g.subject && this.store.chat(g.id, { name: g.subject })));

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      for (const m of messages) this.onMessage(m, type === 'notify');
    });

    sock.ev.on('presence.update', ({ id, presences }) => {
      const chatId = this.store.resolve(id);
      const typing = Object.values(presences).some((p) => p.lastKnownPresence === 'composing' || p.lastKnownPresence === 'recording');
      this.emit('presence', chatId, typing);
    });
  }

  async loadGroups() {
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      for (const g of Object.values(groups)) this.store.chat(g.id, { name: g.subject, isGroup: true });
      this.store.save();
      this.emit('chats');
    } catch {
      // no es imprescindible
    }
  }

  onContact(c) {
    const name = c.name || c.notify || c.verifiedName;
    for (const jid of [c.id, c.lid, c.phoneNumber]) if (jid && name) this.store.setName(jid, name);
    if (c.lid && c.phoneNumber) this.store.link(c.phoneNumber, c.lid);
  }

  onChat(ch) {
    if (IGNORAR(ch.id)) return;
    const c = this.store.chat(ch.id, {
      name: ch.name || undefined,
      lastTs: ch.conversationTimestamp ? toNumber(ch.conversationTimestamp) * 1000 : undefined,
    });
    if (typeof ch.unreadCount === 'number') c.unread = Math.max(0, ch.unreadCount);
    this.store.save();
  }

  onMessage(m, isNew) {
    const k = m.key;
    if (!k || IGNORAR(k.remoteJid)) return;
    if (k.remoteJidAlt) this.store.link(k.remoteJid, k.remoteJidAlt);
    let text = describe(m.message);
    if (text == null) return;
    const chatId = this.store.resolve(k.remoteJid);
    let media = null;
    try {
      media = mediaOf(m);
    } catch {
      // adjunto raro: se queda solo con el texto
    }
    const existing = this.store.chat(chatId).msgs.find((x) => x.id === k.id);
    if (existing) {
      // un mensaje que ya teníamos sin los datos del adjunto (guardado por una versión anterior)
      if (media && !existing.media) {
        media.n = ++this.store.mediaSeq;
        existing.media = media;
        existing.text = text.replace(/^\[([^\]]+)\]/, `[$1 #${media.n}]`);
        this.store.save();
        this.emit('chats');
      }
      return;
    }
    if (media) {
      media.n = ++this.store.mediaSeq;
      text = text.replace(/^\[([^\]]+)\]/, `[$1 #${media.n}]`);
    }
    const sender = k.fromMe ? 'me' : k.participant || k.remoteJid;
    if (!k.fromMe && m.pushName) {
      if (!this.store.names.has(sender)) this.store.setName(sender, m.pushName);
      if (k.participantAlt && !this.store.names.has(k.participantAlt)) this.store.setName(k.participantAlt, m.pushName);
    }
    const msg = {
      id: k.id,
      fromMe: !!k.fromMe,
      sender,
      text,
      ts: m.messageTimestamp ? toNumber(m.messageTimestamp) * 1000 : Date.now(),
      key: { remoteJid: k.remoteJid, id: k.id, participant: k.participant, fromMe: !!k.fromMe },
      media,
    };
    const added = this.store.addMsg(chatId, msg);
    if (!added) return;
    const chat = this.store.chat(chatId);
    if (isNew && !msg.fromMe) chat.unread = (chat.unread || 0) + 1;
    this.emit('message', chatId, msg, isNew);
  }

  // Descarga el adjunto a data/media y devuelve la ruta del fichero
  async download(msg) {
    const dir = path.join(this.dataDir, 'media');
    const file = path.join(dir, `${msg.media.n}-${msg.id}.${msg.media.ext}`);
    if (fs.existsSync(file)) return file;
    const wm = proto.WebMessageInfo.decode(Buffer.from(msg.media.raw, 'base64'));
    const buf = await downloadMediaMessage(wm, 'buffer', {}, {
      logger: this.logger,
      // si el enlace ha caducado, se le pide al móvil que lo vuelva a subir
      reuploadRequest: this.sock.updateMediaMessage,
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
  }

  async send(chatId, text) {
    const sent = await this.sock.sendMessage(chatId, { text });
    if (sent?.key?.id) this.sent.set(sent.key.id, sent.message);
    if (sent) this.onMessage(sent, false);
  }

  async markRead(chatId) {
    const chat = this.store.chat(chatId);
    chat.unread = 0;
    this.store.save();
    const keys = chat.msgs.filter((m) => !m.fromMe && m.key).slice(-20).map((m) => m.key);
    if (keys.length) await this.sock?.readMessages(keys).catch(() => {});
  }

  async watch(chatId) {
    if (chatId.endsWith('@g.us')) return;
    await this.sock?.presenceSubscribe(chatId).catch(() => {});
  }

  async logout() {
    this.stopped = true;
    await this.sock?.logout().catch(() => {});
    fs.rmSync(this.authDir, { recursive: true, force: true });
  }

  stop() {
    this.stopped = true;
    this.store.flush();
    this.sock?.end(undefined);
  }
}
