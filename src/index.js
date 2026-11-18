#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render } from 'ink';
import { Store } from './store.js';
import { App } from './ui.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Data lives in ~/.whatsterm, outside the package, so updates don't wipe it.
// If there's a data/ folder next to the code (an old install from git), that one is used.
const dataDir = process.env.WHATSTERM_DATA || process.env.WA_TERMINAL_DATA
  || (fs.existsSync(path.join(root, 'data')) ? path.join(root, 'data') : path.join(os.homedir(), '.whatsterm'));
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  process.exit(0);
}
const demo = process.argv.includes('--demo');
// the path shown in the header; by default, the folder you launch it from
const cwdArg = process.argv.find((a) => a.startsWith('--cwd='));
const cwd = cwdArg ? cwdArg.slice(6) : process.cwd();

// terminal tab title
process.title = 'claude';
process.stdout.write('\x1b]0;claude\x07');

const store = new Store(demo ? null : path.join(dataDir, 'store.json'));
let backend;
if (demo) {
  const { Demo } = await import('./demo.js');
  backend = new Demo({ store });
} else {
  const { WhatsApp } = await import('./wa.js');
  const pairArg = process.argv.find((a) => a.startsWith('--pair='));
  backend = new WhatsApp({ store, dataDir, pairPhone: pairArg?.slice(7) });
}

const app = render(React.createElement(App, { backend, store, cwd, demo, dataDir }), {
  exitOnCtrlC: true,
  // full screen: on exit the terminal goes back to how it was, with no trace of the messages
  alternateScreen: true,
});
await app.waitUntilExit();
backend.stop();
store.flush();
process.exit(0);
