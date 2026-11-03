// Sesión de mentira que se reproduce al pulsar Esc (modo jefe): parece que
// estás pidiéndole un refactor a un asistente de código.
export const BOSS_PROMPT = 'refactor the auth middleware to use the new TokenService and add tests';

export const BOSS_SCRIPT = [
  { wait: 1800, type: 'bot', text: "I'll start by looking at the current auth middleware and how tokens are validated." },
  { wait: 1400, type: 'tool', name: 'Search', arg: 'pattern: "verifyToken", path: "src"', sub: ['Found 7 files'] },
  { wait: 1600, type: 'tool', name: 'Read', arg: 'src/middleware/auth.ts', sub: ['Read 142 lines'] },
  { wait: 1300, type: 'tool', name: 'Read', arg: 'src/services/TokenService.ts', sub: ['Read 88 lines'] },
  { wait: 2600, type: 'bot', text: 'The middleware parses the bearer token by hand and calls jwt.verify directly. TokenService already wraps this with key rotation, so I\'ll switch the middleware over and keep the error responses identical.' },
  { wait: 1900, type: 'tool', name: 'Update', arg: 'src/middleware/auth.ts', sub: ['Updated src/middleware/auth.ts with 9 additions and 14 removals'],
    diff: [
      [' ', 38, "import { Request, Response, NextFunction } from 'express'"],
      ['-', 39, "import jwt from 'jsonwebtoken'"],
      ['+', 39, "import { TokenService } from '../services/TokenService'"],
      [' ', 40, ''],
      ['-', 41, "  const header = req.headers.authorization ?? ''"],
      ['-', 42, "  const token = header.startsWith('Bearer ') ? header.slice(7) : null"],
      ['+', 41, '  const token = TokenService.fromRequest(req)'],
      [' ', 43, '  if (!token) return res.status(401).json({ error: "missing_token" })'],
      ['-', 44, '  const payload = jwt.verify(token, process.env.JWT_SECRET!)'],
      ['+', 43, '  const payload = await tokens.verify(token)'],
    ] },
  { wait: 2200, type: 'tool', name: 'Write', arg: 'src/middleware/__tests__/auth.test.ts', sub: ['Wrote 64 lines to src/middleware/__tests__/auth.test.ts'] },
  { wait: 1500, type: 'tool', name: 'Bash', arg: 'npm test -- auth', sub: ['', '> api@2.4.1 test', '> vitest run auth', '', ' ✓ src/middleware/__tests__/auth.test.ts (6 tests) 41ms', '', ' Test Files  1 passed (1)', '      Tests  6 passed (6)'] },
  { wait: 7000, type: 'bot', text: 'All 6 tests pass. Next I\'ll check the routes that relied on `req.user.sub` being a string, since TokenService returns it as a branded `UserId`.' },
  { wait: 2000, type: 'tool', name: 'Search', arg: 'pattern: "req\\.user\\.sub", path: "src/routes"', sub: ['Found 4 files'] },
  { wait: 2500, type: 'tool', name: 'Read', arg: 'src/routes/orders.ts', sub: ['Read 211 lines'] },
  { wait: 2300, type: 'tool', name: 'Update', arg: 'src/routes/orders.ts', sub: ['Updated src/routes/orders.ts with 2 additions and 2 removals'],
    diff: [
      [' ', 57, '  const orders = await db.orders.findMany({'],
      ['-', 58, '    where: { ownerId: req.user.sub },'],
      ['+', 58, '    where: { ownerId: String(req.user.sub) },'],
      [' ', 59, '  })'],
    ] },
  { wait: 3000, type: 'tool', name: 'Bash', arg: 'npx tsc --noEmit', sub: ['(No content)'] },
  { wait: 4000, type: 'tool', name: 'Read', arg: 'src/routes/invoices.ts', sub: ['Read 176 lines'] },
];

export const SPINNER_VERBS = [
  'Thinking', 'Pondering', 'Cogitating', 'Percolating', 'Brewing', 'Noodling',
  'Ruminating', 'Deliberating', 'Mulling', 'Synthesizing', 'Computing', 'Working',
];

// Árbol de ficheros que enseña el panel lateral en modo jefe
export const BOSS_TREE = [
  { label: '▾ src', strong: true },
  { label: '  ▾ middleware' },
  { label: '      auth.ts', mark: '●', strong: true },
  { label: '      cors.ts', dim: true },
  { label: '      rateLimit.ts', dim: true },
  { label: '    ▾ __tests__' },
  { label: '        auth.test.ts', mark: '●', strong: true },
  { label: '  ▾ routes' },
  { label: '      invoices.ts', dim: true },
  { label: '      orders.ts', mark: '●' },
  { label: '      users.ts', dim: true },
  { label: '  ▾ services' },
  { label: '      TokenService.ts', dim: true },
  { label: '      Mailer.ts', dim: true },
  { label: '    index.ts', dim: true },
  { label: '▸ prisma', dim: true },
  { label: '▸ scripts', dim: true },
  { label: '  package.json', dim: true },
  { label: '  tsconfig.json', dim: true },
  { label: '  vitest.config.ts', dim: true },
];
