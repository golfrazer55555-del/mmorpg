// 엘더문 온라인 - 게임 서버 (정적 파일 + WebSocket)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from '../shared/world.js';
import { TICK_RATE, GAME_NAME } from '../shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BOTS = process.env.BOTS !== undefined ? Number(process.env.BOTS) : 8;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'players.json');

// ---------- 저장소 ----------
let saves = {};
try {
  saves = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  console.log(`[save] ${Object.keys(saves).length}개의 캐릭터를 불러왔습니다.`);
} catch { saves = {}; }

let saveDirty = false;
function flushSaves() {
  if (!saveDirty) return;
  saveDirty = false;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SAVE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(saves));
  fs.renameSync(tmp, SAVE_FILE);
}
setInterval(flushSaves, 10_000).unref();

const store = {
  load: (token) => (Object.hasOwn(saves, token) ? saves[token] : null),
  save: (token, data) => { saves[token] = data; saveDirty = true; },
};

const world = new World({ bots: BOTS, store, log: (...a) => console.error(...a) });

// ---------- 정적 파일 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(dir, '.' + url.slice(prefix.length - 1));
    if (!file.startsWith(dir + path.sep)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': prefix === '/vendor/three/' ? 'public, max-age=86400' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end();
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (req.url.startsWith('/api/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, name: GAME_NAME, ...world.status() }));
  }
  serveStatic(req, res);
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  let alive = true;
  let msgCount = 0;
  let windowStart = Date.now();
  const handle = world.connect((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; msgCount = 0; }
    if (++msgCount > 60) return; // 초당 메시지 제한
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handle.receive(msg);
  });
  ws.on('pong', () => { alive = true; });
  ws.on('close', () => { handle.close(); clearInterval(hb); });
  ws.on('error', () => {});
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);
});

// ---------- 게임 루프 ----------
const STEP = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  while (acc >= STEP) {
    world.tick(STEP / 1000);
    acc -= STEP;
  }
}, STEP / 2);

server.listen(PORT, HOST, () => {
  console.log(`\n🌙 ${GAME_NAME} 서버가 시작되었습니다.`);
  console.log(`   로컬:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`   모바일: http://${a.address}:${PORT}  (같은 Wi-Fi에서 접속)`);
    }
  }
  console.log(`   AI 모험가: ${BOTS}명\n`);
});

function shutdown() {
  console.log('\n서버를 종료합니다. 저장 중...');
  for (const p of world.players.values()) world.savePlayer(p);
  saveDirty = true;
  flushSaves();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
