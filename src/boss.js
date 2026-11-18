// Sesión de mentira que se reproduce al pulsar Esc (modo jefe): parece que
// estás pidiéndole cosas a un asistente de código.
//
// No se acaba nunca: encadena varias tareas distintas en orden aleatorio, y
// cada vez con otras cifras (líneas leídas, tests, tiempos) y otro ritmo. Una
// vuelta completa a las seis dura unos 4 minutos; después se barajan otra vez.

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const ms = () => `${rnd(9, 160)}ms`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hex = (n) => Array.from({ length: n }, () => rnd(0, 15).toString(16)).join('');
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ---------- pasos ----------
const bot = (wait, text) => ({ wait, type: 'bot', text });
const read = (wait, path, a, b) => ({ wait, type: 'tool', name: 'Read', arg: path, sub: [`Read ${rnd(a, b)} lines`] });
const search = (wait, pattern, path, files) => ({ wait, type: 'tool', name: 'Search', arg: `pattern: "${pattern}", path: "${path}"`, sub: [`Found ${plural(files, 'file')}`] });
const write = (wait, path, a, b) => {
  const n = rnd(a, b);
  return { wait, type: 'tool', name: 'Write', arg: path, touch: path, sub: [`Wrote ${n} lines to ${path}`] };
};
const update = (wait, path, diff) => {
  const add = diff.filter((d) => d[0] === '+').length + rnd(0, 5);
  const rem = diff.filter((d) => d[0] === '-').length + rnd(0, 3);
  return { wait, type: 'tool', name: 'Update', arg: path, touch: path, sub: [`Updated ${path} with ${plural(add, 'addition')} and ${plural(rem, 'removal')}`], diff };
};
const bash = (wait, cmd, sub, error) => ({ wait, type: 'tool', name: 'Bash', arg: cmd, sub, error });

// npm test con vitest: files = [[fichero, nº de tests], ...]
const tests = (wait, filter, files) => {
  const total = files.reduce((s, [, n]) => s + n, 0);
  return bash(wait, `npm test${filter ? ' -- ' + filter : ''}`, [
    '',
    '> api@2.4.1 test',
    `> vitest run${filter ? ' ' + filter : ''}`,
    '',
    ...files.map(([f, n]) => ` ✓ ${f} (${n} tests) ${ms()}`),
    '',
    ` Test Files  ${files.length} passed (${files.length})`,
    `      Tests  ${total} passed (${total})`,
  ]);
};
const migrate = (wait, name) =>
  bash(wait, `npx prisma migrate dev --name ${name}`, [
    `Applying migration \`${today()}${rnd(100000, 235959)}_${name}\``,
    '',
    'Your database is now in sync with your schema.',
    '',
    `✔ Generated Prisma Client (v6.4.1) in ${rnd(80, 240)}ms`,
  ]);

// ---------- tareas ----------
const TASKS = [
  // refactor del middleware de autenticación
  () => {
    const t = rnd(5, 8);
    return {
      prompt: 'refactor the auth middleware to use the new TokenService and add tests',
      steps: [
        bot(1800, "I'll start by looking at the current auth middleware and how tokens are validated."),
        search(1400, 'verifyToken', 'src', rnd(5, 9)),
        read(1600, 'src/middleware/auth.ts', 120, 160),
        read(1300, 'src/services/TokenService.ts', 70, 110),
        bot(2600, "The middleware parses the bearer token by hand and calls jwt.verify directly. TokenService already wraps this with key rotation, so I'll switch the middleware over and keep the error responses identical."),
        update(1900, 'src/middleware/auth.ts', [
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
        ]),
        write(2200, 'src/middleware/__tests__/auth.test.ts', 50, 80),
        tests(1500, 'auth', [['src/middleware/__tests__/auth.test.ts', t]]),
        bot(6000, `All ${t} tests pass. Next I'll check the routes that relied on \`req.user.sub\` being a string, since TokenService returns it as a branded \`UserId\`.`),
        search(2000, 'req\\.user\\.sub', 'src/routes', 2),
        read(2500, 'src/routes/orders.ts', 190, 230),
        update(2300, 'src/routes/orders.ts', [
          [' ', 57, '  const orders = await db.orders.findMany({'],
          ['-', 58, '    where: { ownerId: req.user.sub },'],
          ['+', 58, '    where: { ownerId: String(req.user.sub) },'],
          [' ', 59, '  })'],
        ]),
        read(2000, 'src/routes/invoices.ts', 150, 190),
        update(2400, 'src/routes/invoices.ts', [
          [' ', 34, '  const invoices = await db.invoices.findMany({'],
          ['-', 35, '    where: { customerId: req.user.sub },'],
          ['+', 35, '    where: { customerId: String(req.user.sub) },'],
        ]),
        bash(3000, 'npx tsc --noEmit', ['(No content)']),
        tests(2500, '', [
          ['src/middleware/__tests__/auth.test.ts', t],
          ['src/middleware/__tests__/rateLimit.test.ts', rnd(3, 5)],
          ['src/routes/__tests__/invoices.test.ts', rnd(6, 11)],
          ['src/routes/__tests__/webhooks.test.ts', rnd(4, 7)],
        ]),
        bot(3500, 'Done. The auth middleware now goes through TokenService, so tokens signed with the previous key keep working during rotation. The two routes that compared `req.user.sub` as a string are updated, and the whole suite passes.'),
      ],
    };
  },

  // paginación de facturas
  () => {
    const t = rnd(6, 10);
    return {
      prompt: 'add cursor-based pagination to GET /invoices, the list endpoint times out for big customers',
      steps: [
        bot(1700, "Let me look at how the invoices route queries the database and whether there's already a pagination helper."),
        search(1500, 'findMany', 'src/routes', rnd(3, 5)),
        read(1800, 'src/routes/invoices.ts', 150, 190),
        search(1400, 'paginat', 'src', 2),
        read(1500, 'src/lib/pagination.ts', 25, 40),
        bot(3200, "There's a `paginate()` helper in src/lib/pagination.ts, but only users.ts uses it. invoices.ts loads every row and sorts in memory. I'll switch it to a cursor on (createdAt, id), so pages stay stable when new invoices come in."),
        update(2100, 'src/lib/pagination.ts', [
          [' ', 12, 'export type Page<T> = { items: T[]; nextCursor: string | null }'],
          ['+', 13, ''],
          ['+', 14, 'export const encodeCursor = (d: Date, id: string) =>'],
          ['+', 15, "  Buffer.from(`${d.toISOString()}|${id}`).toString('base64url')"],
          ['+', 16, ''],
          ['+', 17, 'export function decodeCursor(c: string) {'],
          ['+', 18, "  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|')"],
          ['+', 19, '  return { createdAt: new Date(iso), id }'],
          ['+', 20, '}'],
        ]),
        update(2300, 'src/routes/invoices.ts', [
          [' ', 33, "router.get('/', async (req, res) => {"],
          ['-', 34, '  const all = await db.invoices.findMany({ where: { customerId } })'],
          ['-', 35, '  res.json(all.sort(byDateDesc))'],
          ['+', 34, '  const limit = Math.min(Number(req.query.limit) || 50, 200)'],
          ['+', 35, '  const cursor = req.query.cursor ? decodeCursor(String(req.query.cursor)) : null'],
          ['+', 36, '  const items = await db.invoices.findMany({'],
          ['+', 37, "    where: { customerId, ...(cursor && { OR: afterCursor(cursor) }) },"],
          ['+', 38, "    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],"],
          ['+', 39, '    take: limit + 1,'],
          ['+', 40, '  })'],
        ]),
        write(2000, 'src/routes/__tests__/invoices.test.ts', 70, 110),
        tests(1800, 'invoices', [['src/routes/__tests__/invoices.test.ts', t]]),
        bot(4500, "Tests pass. I'll check the response shape against the OpenAPI spec so the frontend doesn't break."),
        search(1600, '/invoices', 'docs', 1),
        read(1700, 'docs/openapi.yaml', 880, 960),
        update(2000, 'docs/openapi.yaml', [
          [' ', 412, '      parameters:'],
          ['+', 413, '        - { name: cursor, in: query, schema: { type: string } }'],
          ['+', 414, '        - { name: limit, in: query, schema: { type: integer, maximum: 200 } }'],
        ]),
        bot(3500, '`GET /invoices` is now paginated: up to 200 per page (50 by default), with a `nextCursor` to fetch the next one. The query uses the existing (customerId, createdAt) index, so it no longer reads every invoice. The OpenAPI spec is updated.'),
      ],
    };
  },

  // el rate limiter con Redis caído
  () => {
    const t = rnd(4, 6);
    return {
      prompt: 'the rate limiter returns 500 when redis is down. make it fail open and log a warning instead',
      steps: [
        bot(1600, "I'll check how rateLimit.ts talks to Redis and what happens when the connection drops."),
        read(1500, 'src/middleware/rateLimit.ts', 55, 75),
        search(1700, 'redis\\.', 'src', 3),
        read(1300, 'src/lib/logger.ts', 35, 50),
        bot(3000, "The middleware awaits `redis.incr()` with no try/catch, so any connection error reaches the error handler as a 500. I'll let the request through when Redis fails and log at most one warning per minute, so the logs don't flood."),
        update(2000, 'src/middleware/rateLimit.ts', [
          [' ', 18, 'export async function rateLimit(req: Request, res: Response, next: NextFunction) {'],
          ['-', 19, '  const hits = await redis.incr(key(req))'],
          ['+', 19, '  let hits: number'],
          ['+', 20, '  try {'],
          ['+', 21, '    hits = await redis.incr(key(req))'],
          ['+', 22, '  } catch (err) {'],
          ['+', 23, "    warnOnce('rate limiter unavailable, failing open', err)"],
          ['+', 24, '    return next()'],
          ['+', 25, '  }'],
        ]),
        update(1700, 'src/lib/logger.ts', [
          ['+', 41, 'const lastWarn = new Map<string, number>()'],
          ['+', 42, 'export function warnOnce(msg: string, err?: unknown, everyMs = 60_000) {'],
          ['+', 43, '  if (Date.now() - (lastWarn.get(msg) ?? 0) < everyMs) return'],
          ['+', 44, '  lastWarn.set(msg, Date.now())'],
          ['+', 45, '  logger.warn({ err }, msg)'],
          ['+', 46, '}'],
        ]),
        write(2100, 'src/middleware/__tests__/rateLimit.test.ts', 45, 70),
        bash(1900, 'npm test -- rateLimit', [
          '',
          '> api@2.4.1 test',
          '> vitest run rateLimit',
          '',
          ` ❯ src/middleware/__tests__/rateLimit.test.ts (${t} tests | 1 failed) ${ms()}`,
          '   × fails open when redis throws',
          '     → expected 200, received 500',
          '',
          ` Test Files  1 failed (1)`,
          `      Tests  1 failed | ${t - 1} passed (${t})`,
        ], true),
        bot(4200, 'One test fails: the mock throws synchronously from `redis.incr`, before there is a promise to await, and the real client does the same when the socket is closed. The try/catch already covers that, but `key(req)` was evaluated outside it. Moving it inside.'),
        update(1800, 'src/middleware/rateLimit.ts', [
          ['-', 18, '  const k = key(req)'],
          [' ', 19, '  try {'],
          ['+', 20, '    const k = key(req)'],
        ]),
        tests(1700, 'rateLimit', [['src/middleware/__tests__/rateLimit.test.ts', t]]),
        bot(3200, 'Fixed. If Redis is unreachable, requests now go through without rate limiting instead of failing with a 500, and a warning is logged at most once a minute. Added tests for Redis being down, slow, and back up.'),
      ],
    };
  },

  // webhooks de Stripe procesados dos veces
  () => {
    const t = rnd(5, 8);
    return {
      prompt: 'stripe webhooks are sometimes processed twice and customers get two emails. add idempotency',
      steps: [
        bot(1700, "Let me look at the webhook handler and how events are stored."),
        read(1600, 'src/routes/webhooks.ts', 120, 150),
        read(1500, 'prisma/schema.prisma', 230, 270),
        search(1600, 'sendReceipt', 'src', 2),
        bot(3400, "Stripe retries a webhook if it doesn't get an answer within a few seconds, and this handler only answers after sending the email. So a slow mail server means a retry, and a second email. I'll record processed event ids, skip duplicates, and answer 200 before doing the slow work."),
        update(2000, 'prisma/schema.prisma', [
          ['+', 251, 'model ProcessedEvent {'],
          ['+', 252, '  id          String   @id'],
          ['+', 253, '  type        String'],
          ['+', 254, '  processedAt DateTime @default(now())'],
          ['+', 255, '}'],
        ]),
        migrate(2600, 'processed_events'),
        update(2400, 'src/routes/webhooks.ts', [
          [' ', 41, "  const event = stripe.webhooks.constructEvent(req.body, sig, secret)"],
          ['+', 42, '  const fresh = await db.processedEvent'],
          ['+', 43, '    .create({ data: { id: event.id, type: event.type } })'],
          ['+', 44, '    .then(() => true, (e) => (isUniqueViolation(e) ? false : Promise.reject(e)))'],
          ['+', 45, '  res.sendStatus(200)'],
          ['+', 46, '  if (!fresh) return'],
          ['-', 47, '  await handle(event)'],
          ['-', 48, '  res.sendStatus(200)'],
          ['+', 47, '  queue.add(() => handle(event))'],
        ]),
        write(2200, 'src/routes/__tests__/webhooks.test.ts', 60, 95),
        tests(1900, 'webhooks', [['src/routes/__tests__/webhooks.test.ts', t]]),
        bot(3600, "Each Stripe event is now handled once: the id is stored in `ProcessedEvent` and retries are acknowledged without doing anything. The handler answers right away and sends the email afterwards, so Stripe stops retrying in the first place."),
      ],
    };
  },

  // id de petición en los logs
  () => {
    const id = `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
    const calls = rnd(19, 31);
    return {
      prompt: 'add a request id to every log line so we can trace a request across services',
      steps: [
        bot(1500, "I'll look at how the logger is set up and how many places call it."),
        read(1500, 'src/lib/logger.ts', 35, 55),
        read(1400, 'src/index.ts', 60, 90),
        search(1800, 'logger\\.(info|warn|error)', 'src', rnd(8, 12)),
        bot(3300, `There are ${calls} log calls. Rather than passing an id through all of them, I'll keep it in AsyncLocalStorage: one middleware sets it per request (reusing X-Request-Id if the gateway sends one) and the logger adds it to every line.`),
        update(2100, 'src/lib/logger.ts', [
          ['+', 1, "import { AsyncLocalStorage } from 'node:async_hooks'"],
          [' ', 2, "import pino from 'pino'"],
          ['+', 3, ''],
          ['+', 4, 'export const requestContext = new AsyncLocalStorage<{ requestId: string }>()'],
          [' ', 5, ''],
          ['-', 6, 'export const logger = pino({ level: env.LOG_LEVEL })'],
          ['+', 6, 'export const logger = pino({'],
          ['+', 7, '  level: env.LOG_LEVEL,'],
          ['+', 8, '  mixin: () => requestContext.getStore() ?? {},'],
          ['+', 9, '})'],
        ]),
        update(2000, 'src/index.ts', [
          [' ', 22, 'app.use(express.json())'],
          ['+', 23, 'app.use((req, res, next) => {'],
          ['+', 24, "  const requestId = req.header('x-request-id') ?? randomUUID()"],
          ['+', 25, "  res.setHeader('X-Request-Id', requestId)"],
          ['+', 26, '  requestContext.run({ requestId }, next)'],
          ['+', 27, '})'],
        ]),
        bash(2600, 'npx tsc --noEmit', ['(No content)']),
        tests(2400, '', [
          ['src/middleware/__tests__/auth.test.ts', rnd(5, 8)],
          ['src/middleware/__tests__/rateLimit.test.ts', rnd(3, 5)],
          ['src/routes/__tests__/invoices.test.ts', rnd(6, 11)],
          ['src/routes/__tests__/webhooks.test.ts', rnd(4, 7)],
        ]),
        bash(2200, 'curl -si localhost:3000/health | head -4', [
          'HTTP/1.1 200 OK',
          `X-Request-Id: ${id}`,
          'Content-Type: application/json; charset=utf-8',
          `Content-Length: ${rnd(14, 18)}`,
        ]),
        bot(3400, `Every log line now carries a \`requestId\`, and the response returns it in \`X-Request-Id\`. If the gateway already sends one, it is reused, so the same id follows the request across services. None of the ${calls} log calls had to change.`),
      ],
    };
  },

  // la página de pedidos va lenta
  () => {
    const rows = rnd(1500000, 2400000).toLocaleString('en-US');
    const slow = (rnd(3400, 4600) + Math.random()).toFixed(3);
    const fast = (Math.random() * 1.5 + 0.3).toFixed(3);
    return {
      prompt: 'the orders page takes 4s to load for big accounts. find out why',
      steps: [
        bot(1600, "I'll start with the query behind the orders list and check its plan."),
        read(1700, 'src/routes/orders.ts', 190, 230),
        bash(2800, `psql "$DATABASE_URL" -c 'EXPLAIN ANALYZE SELECT * FROM "Order" WHERE "ownerId" = $1 ORDER BY "createdAt" DESC LIMIT 50'`, [
          'Limit  (actual time=' + slow + ' rows=50 loops=1)',
          '  ->  Sort  (Sort Method: top-N heapsort  Memory: 41kB)',
          `        ->  Seq Scan on "Order"  (rows=${rows})`,
          '              Filter: ("ownerId" = $1)',
          `Execution Time: ${slow} ms`,
        ]),
        bot(3200, "It's a sequential scan over every order: there's no index on ownerId, so Postgres reads the whole table and sorts it. A composite index on (ownerId, createdAt) covers both the filter and the sort."),
        update(1900, 'prisma/schema.prisma', [
          [' ', 88, '  createdAt DateTime @default(now())'],
          ['+', 89, ''],
          ['+', 90, '  @@index([ownerId, createdAt(sort: Desc)])'],
          [' ', 91, '}'],
        ]),
        migrate(2700, 'orders_owner_created_idx'),
        bash(2500, `psql "$DATABASE_URL" -c 'EXPLAIN ANALYZE SELECT * FROM "Order" WHERE "ownerId" = $1 ORDER BY "createdAt" DESC LIMIT 50'`, [
          'Limit  (actual time=' + fast + ' rows=50 loops=1)',
          '  ->  Index Scan using "Order_ownerId_createdAt_idx" on "Order"',
          '        Index Cond: ("ownerId" = $1)',
          `Execution Time: ${fast} ms`,
        ]),
        bot(3800, 'That brings the query from seconds to under 2ms. While reading orders.ts I also noticed the line items are loaded with one query per order inside a loop, so a page of 50 orders makes 51 queries. Fixing that too.'),
        update(2200, 'src/routes/orders.ts', [
          [' ', 56, '  const orders = await db.orders.findMany({'],
          [' ', 57, '    where: { ownerId: String(req.user.sub) },'],
          ['+', 58, '    include: { items: true },'],
          [' ', 59, '  })'],
          ['-', 60, '  for (const o of orders) o.items = await db.orderItems.findMany({ where: { orderId: o.id } })'],
        ]),
        tests(2300, '', [
          ['src/middleware/__tests__/auth.test.ts', rnd(5, 8)],
          ['src/routes/__tests__/invoices.test.ts', rnd(6, 11)],
          ['src/routes/__tests__/webhooks.test.ts', rnd(4, 7)],
        ]),
        bot(3600, `Two causes: a full scan of the ${rows} orders on every load, and one extra query per order for its line items. With the new index and a single query with \`include\`, the page goes from about ${Math.round(slow / 1000)}s to a few milliseconds.`),
      ],
    };
  },
];

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Sesión sin fin. Cada paso: { wait, entry, touch?, newTask?, idle? }
// - newTask: empieza otra tarea (se limpian las marcas del explorador)
// - idle: la tarea ha acabado y se está «escribiendo» la siguiente
export function* bossSession() {
  let last = null;
  let first = true;
  for (;;) {
    const order = shuffle([...TASKS]);
    if (order[0] === last) order.push(order.shift());
    for (const task of order) {
      const { prompt, steps } = task();
      yield { wait: first ? 0 : rnd(5000, 9000), entry: { type: 'prompt', text: prompt }, newTask: true };
      first = false;
      for (let i = 0; i < steps.length; i++) {
        const { wait, touch, ...entry } = steps[i];
        yield { wait: Math.round(wait * (0.8 + Math.random() * 0.5)), entry, touch, idle: i === steps.length - 1 };
      }
      last = task;
    }
  }
}

export const SPINNER_VERBS = [
  'Thinking', 'Pondering', 'Cogitating', 'Percolating', 'Brewing', 'Noodling',
  'Ruminating', 'Deliberating', 'Mulling', 'Synthesizing', 'Computing', 'Working',
];

// Árbol de ficheros que enseña el panel lateral en modo jefe. Los que toca la
// tarea en curso se marcan con ● según los va editando.
export const BOSS_TREE = [
  { label: '▾ src', strong: true },
  { label: '  ▾ lib' },
  { label: '      logger.ts', path: 'src/lib/logger.ts' },
  { label: '      pagination.ts', path: 'src/lib/pagination.ts' },
  { label: '  ▾ middleware' },
  { label: '      auth.ts', path: 'src/middleware/auth.ts' },
  { label: '      rateLimit.ts', path: 'src/middleware/rateLimit.ts' },
  { label: '    ▾ __tests__' },
  { label: '        auth.test.ts', path: 'src/middleware/__tests__/auth.test.ts' },
  { label: '        rateLimit.test.ts', path: 'src/middleware/__tests__/rateLimit.test.ts' },
  { label: '  ▾ routes' },
  { label: '      invoices.ts', path: 'src/routes/invoices.ts' },
  { label: '      orders.ts', path: 'src/routes/orders.ts' },
  { label: '      webhooks.ts', path: 'src/routes/webhooks.ts' },
  { label: '    ▾ __tests__' },
  { label: '        invoices.test.ts', path: 'src/routes/__tests__/invoices.test.ts' },
  { label: '        webhooks.test.ts', path: 'src/routes/__tests__/webhooks.test.ts' },
  { label: '  ▾ services' },
  { label: '      TokenService.ts', path: 'src/services/TokenService.ts' },
  { label: '    index.ts', path: 'src/index.ts' },
  { label: '▾ prisma' },
  { label: '    schema.prisma', path: 'prisma/schema.prisma' },
  { label: '▾ docs' },
  { label: '    openapi.yaml', path: 'docs/openapi.yaml' },
  { label: '  package.json', dim: true },
];
