// The local backend on a throwaway database (ADMIN_PORTAL_PLAN.md, Testing). Nothing is kept on this machine:
// Postgres keeps its data in memory (--tmpfs) and the container is removed when it stops (--rm); the backend's
// log, which holds the sign-in codes and links because no mail server is set, is written to a temporary
// folder that is deleted on stop. Every secret is made up for the run.
//
//   npm run stack          start it, print the first admin and every email, Ctrl+C to stop and clean up
//
// Playwright starts and stops it the same way (tests/e2e/global-setup.ts).
//
// The chain is a stand-in on this machine too (startChain): it knows only the Safes registered with it, so a pool
// wallet can be proposed and approved, and every other read is refused as an unreachable chain would refuse it.
//
// Settings for this script only, not for the portal's .env:
//   BLOCKCOOP_DIR     the backend repo (default ../BlockCoop); its jar is built with ./mvnw package
//   STACK_API_PORT    the backend's port (default 8080, which VITE_API_BASE_URL points at)
//   STACK_ADMIN_EMAIL the first admin, created at startup (default admin-a@test.local)

import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ORIGINS = 'http://localhost:3001,http://localhost:3002';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A password that meets the backend's rule, different every run. */
function makePassword() {
  return `Gp-${randomBytes(9).toString('base64url')}-a1A!`;
}

function findJar(dir) {
  const target = path.join(dir, 'target');
  const jar = existsSync(target) && readdirSync(target).find((f) => f.endsWith('.jar') && !f.endsWith('-plain.jar') && !f.startsWith('original-'));
  if (!jar) throw new Error(`No backend jar in ${target}. Build it first: cd ${dir} && ./mvnw -DskipTests package`);
  return path.join(target, jar);
}

async function waitFor(what, check, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch (e) {
      last = e;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

/** Every email the backend logged instead of sending, oldest first. */
export function readMails(logPath) {
  if (!existsSync(logPath)) return [];
  const log = readFileSync(logPath, 'utf8');
  const mails = [];
  const re = /so this email was NOT sent\.\r?\nTo: (.*)\r?\nSubject: (.*)\r?\n\r?\n([\s\S]*?)(?=\r?\n\d{4}-\d{2}-\d{2}[T ]|\s*$)/g;
  for (const m of log.matchAll(re)) mails.push({ to: m[1].trim(), subject: m[2].trim(), body: m[3] });
  return mails;
}

/** Waits for the next email to `to` whose subject matches, after the first `skip` mails. */
export async function waitForMail(logPath, to, subject, { skip = 0, timeoutMs = 20_000 } = {}) {
  let found;
  await waitFor(`an email "${subject}" to ${to}`, () => {
    found = readMails(logPath).slice(skip).find((m) => m.to === to && subject.test(m.subject));
    return !!found;
  }, timeoutMs);
  return found;
}

export const loginCode = (mail) => /login code is:\s*(\d{6})/.exec(mail.body)?.[1];
export const linkIn = (mail, route) => new RegExp(`https?://\\S+/${route}\\?token=\\S+`).exec(mail.body)?.[0];

// ------------------------------------------------------------------ the chain stand-in

const SAFE_CALLS = { '0xa0e67e2b': 'getOwners', '0xe75235b8': 'getThreshold' };
const word = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

/**
 * A JSON-RPC stand-in for BNB Smart Chain, on a free local port. It answers the reads that check a pool wallet (the
 * block number, a contract's code, a Safe's getOwners and getThreshold) for the Safes registered with `POST /safes`
 * ({ address, owners, threshold }); a sweep's receipt and its block's time for the transactions registered with
 * `POST /receipts` ({ hash, block, time, logs: [{ address, topics, data, logIndex }] }); and an ERC-20 balanceOf for
 * the holdings registered with `POST /balances` ({ token, holder, raw }, raw as a hex word). Any other call gets a
 * JSON-RPC error, so the backend's other chain reads fail as they would with no chain at all.
 */
export async function startChain() {
  const safes = new Map();
  const receipts = new Map();
  const blockTimes = new Map();
  const balances = new Map();
  const answer = ({ method, params = [] }) => {
    if (method === 'eth_blockNumber') return '0x100';
    if (method === 'eth_getTransactionReceipt') {
      const r = receipts.get(String(params[0]).toLowerCase());
      if (r) return r;
    }
    if (method === 'eth_getBlockByNumber' && blockTimes.has(Number(params[0]))) return { timestamp: '0x' + blockTimes.get(Number(params[0])).toString(16) };
    if (method === 'eth_getCode') return safes.has(String(params[0]).toLowerCase()) ? '0x6080' : '0x';
    if (method === 'eth_call') {
      const safe = safes.get(String(params[0]?.to).toLowerCase());
      const call = SAFE_CALLS[String(params[0]?.data).slice(0, 10)];
      if (safe && call === 'getOwners') return '0x' + word('20') + word(safe.owners.length.toString(16)) + safe.owners.map(word).join('');
      if (safe && call === 'getThreshold') return '0x' + word(safe.threshold.toString(16));
      // balanceOf(address): the token is the call's target, the holder its argument
      const data = String(params[0]?.data);
      if (data.slice(0, 10) === '0x70a08231') {
        const raw = balances.get(String(params[0]?.to).toLowerCase() + ':0x' + data.slice(-40).toLowerCase());
        if (raw) return '0x' + word(raw);
      }
    }
    throw new Error(`${method} is not answered by the local chain`);
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      try {
        const json = JSON.parse(body || '{}');
        if (req.url === '/safes') {
          safes.set(json.address.toLowerCase(), { owners: json.owners.map((o) => o.toLowerCase()), threshold: json.threshold });
          res.end('{}');
          return;
        }
        if (req.url === '/receipts') {
          const hex = (n) => '0x' + n.toString(16);
          receipts.set(json.hash.toLowerCase(), {
            transactionHash: json.hash.toLowerCase(),
            status: '0x1',
            blockNumber: hex(json.block),
            logs: json.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: hex(l.logIndex ?? 0) }))
          });
          blockTimes.set(json.block, json.time);
          res.end('{}');
          return;
        }
        if (req.url === '/balances') {
          balances.set(json.token.toLowerCase() + ':' + json.holder.toLowerCase(), json.raw);
          res.end('{}');
          return;
        }
        try {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: answer(json) }));
        } catch (e) {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, error: { code: -32000, message: e.message } }));
        }
      } catch {
        res.statusCode = 400;
        res.end('{}');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const close = () =>
    new Promise((r) => {
      server.close(r);
      server.closeAllConnections();
    });
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}

/**
 * Starts Postgres and the backend. Returns how to reach them and stop(), which removes the container
 * and the log folder.
 */
export async function startStack({ quiet = false } = {}) {
  const say = (s) => quiet || console.log(s);
  const blockcoop = path.resolve(here, '..', process.env.BLOCKCOOP_DIR || '../BlockCoop');
  const apiPort = Number(process.env.STACK_API_PORT || 8080);
  const admin = { email: process.env.STACK_ADMIN_EMAIL || 'admin-a@test.local', password: makePassword() };
  const jar = findJar(blockcoop);

  const dir = mkdtempSync(path.join(tmpdir(), 'gp-admin-stack-'));
  const logPath = path.join(dir, 'backend.log');
  const dbPassword = randomBytes(18).toString('base64url');
  const name = `gp-admin-stack-${randomBytes(4).toString('hex')}`;
  let backend = null;
  let chain = null;
  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (backend && backend.exitCode === null) {
      backend.kill();
      await Promise.race([new Promise((r) => backend.once('exit', r)), sleep(10_000)]);
    }
    await chain?.close();
    try {
      docker('stop', '-t', '2', name);
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
    say('Stopped: the database container and the backend log are gone.');
  };

  try {
    say('Starting a throwaway Postgres (in memory only)…');
    docker('run', '-d', '--rm', '--name', name, '--tmpfs', '/var/lib/postgresql/data',
      '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-e', 'POSTGRES_DB=blockcoop', '-p', '127.0.0.1::5432', 'postgres:17-alpine');
    const dbPort = docker('port', name, '5432/tcp').split('\n')[0].split(':').pop();
    await waitFor('Postgres', () => {
      docker('exec', name, 'pg_isready', '-U', 'postgres', '-d', 'blockcoop');
      return true;
    }, 60_000);

    chain = await startChain();
    say(`Starting the backend from ${jar} on port ${apiPort}…`);
    const log = createWriteStream(logPath);
    backend = spawn('java', ['-jar', jar], {
      cwd: blockcoop,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SERVER_PORT: String(apiPort),
        DB_URL: `jdbc:postgresql://127.0.0.1:${dbPort}/blockcoop`,
        DB_USERNAME: 'postgres',
        DB_PASSWORD: dbPassword,
        JWT_SECRET: randomBytes(48).toString('base64url'),
        KYC_ENCRYPTION_KEY: `k1:${randomBytes(32).toString('base64')}`,
        // admin email links use ADMIN_WEB_URL, whose default is the portal on :3001; both portal ports may call the API
        CORS_ALLOWED_ORIGINS: PORTAL_ORIGINS,
        SYSTEM_ADMIN_EMAIL: admin.email,
        SYSTEM_ADMIN_PASSWORD: admin.password,
        SYSTEM_ADMIN_PHONE: '0700000001',
        SWAGGER_ENABLED: 'true',
        // no outside services: on-chain reads, the KES rate and scheduled jobs stay off
        LIPA_SAVINGS_LOCK_ENABLED: 'false',
        ONCHAIN_READER_CRON: '-',
        KES_RATE_CRON: '-',
        VALUATION_CRON: '-',
        POOL_TRANSFERS_CRON: '-',
        FACTOR_REFRESH_ENABLED: 'false',
        GUARANTEE_JOBS_ENABLED: 'false',
        // the chain stand-in: it answers for registered Safes only, so a member's wallet sign-in, which reads the
        // chain in the background (locked BLOCKS, Lipa activity), is refused, nothing leaves the machine and
        // locked BLOCKS stay 0
        BSC_RPC_URLS: chain.url,
        ALCHEMY_BSC_URL: '',
        // test runs sign in more often than a person would
        SPRING_APPLICATION_JSON: JSON.stringify({ 'app.rate-limit.enabled': false })
      }
    });
    backend.stdout.pipe(log);
    backend.stderr.pipe(log);
    const exited = new Promise((_, reject) => backend.once('exit', (code) => reject(new Error(`The backend exited (${code}). Its log:\n${tail(logPath)}`))));
    exited.catch(() => {});

    await Promise.race([
      waitFor('the backend', async () => (await fetch(`http://localhost:${apiPort}/actuator/health/readiness`)).ok, 180_000),
      exited
    ]);
    say('Ready.');
    return { apiBase: `http://localhost:${apiPort}/api`, apiPort, admin, logPath, dir, dbContainer: name, chainUrl: chain.url, stop };
  } catch (e) {
    const err = new Error(`${e.message}${backend ? `\n${tail(logPath)}` : ''}`);
    await stop();
    throw err;
  }
}

/** The log's errors and their causes, then its last lines: enough to see why the backend stopped. */
function tail(file, lines = 15) {
  try {
    const all = readFileSync(file, 'utf8').split('\n');
    const causes = all.filter((l) => / ERROR |^Caused by:|^Description:|^Reason:|^[\w.$]+(Exception|Error)\b/.test(l)).slice(0, 20);
    return [...causes, '…', ...all.slice(-lines)].join('\n');
  } catch {
    return '(no log)';
  }
}

// ------------------------------------------------------------------ npm run stack

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = await startStack();
  console.log(`\nThe GP API is at ${stack.apiBase}. Start the portal with: npm run dev`);
  console.log(`First admin: ${stack.admin.email}\nPassword:    ${stack.admin.password}`);
  console.log('Emails are printed here as the backend writes them. Ctrl+C stops everything and deletes it.\n');

  let shown = 0;
  const timer = setInterval(() => {
    const mails = readMails(stack.logPath);
    for (const m of mails.slice(shown)) {
      const code = loginCode(m);
      const link = /https?:\/\/\S+\?token=\S+/.exec(m.body)?.[0];
      console.log(`[email to ${m.to}] ${m.subject}${code ? `  code: ${code}` : ''}${link ? `\n  ${link}` : ''}`);
    }
    shown = mails.length;
  }, 1000);

  const shutdown = async () => {
    clearInterval(timer);
    await stack.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
