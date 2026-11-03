// Prueba sin terminal real: renderiza la demo, simula teclas y vuelca la última pantalla.
// Uso: node test/smoke.js
import { PassThrough, Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { Store } from '../src/store.js';
import { Demo } from '../src/demo.js';
import { App } from '../src/ui.js';

process.env.WA_TERMINAL_NO_OPEN = '1';
const ROWS = 30;
const stdin = new PassThrough();
Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let out = '';
const stdout = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
Object.assign(stdout, { columns: 100, rows: ROWS, isTTY: true });

const store = new Store(null);
const backend = new Demo({ store });
const app = render(React.createElement(App, { backend, store, cwd: process.cwd(), demo: true }), { stdin, stdout, debug: true, patchConsole: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (s, ms = 150) => { stdin.write(s); await wait(ms); };
const type = async (s) => { for (const ch of s) await key(ch, 10); await key('\r'); };
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '');
const shot = (label) => {
  const lines = strip(out).split('\n');
  console.log(`\n===== ${label} =====\n` + lines.slice(-ROWS - 1).join('\n'));
  out = '';
};

await wait(600); shot('inicio');
await key('\t'); await key('\x1b[B'); shot('panel: tab + ↓');
await key('\r'); shot('abrir con enter');
await type('hola, ¿qué tal?'); await wait(2500); shot('enviado, el otro escribe');
await wait(2500); shot('respuesta');
await key('\x0e'); shot('ctrl+n');
await key('\x15'); shot('ctrl+u (siguiente sin leer)');
await type('/view'); shot('/view');
await key('\t'); await key('p'); await key('\t'); shot('fijar con p');
await key('\x1b'); await wait(5000); shot('modo jefe');
await key('\x1b'); shot('vuelta');
app.unmount();
process.exit(0);
