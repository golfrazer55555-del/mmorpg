// 네트워크 계층: 온라인(WebSocket) / 오프라인(브라우저 내 월드 시뮬레이션)

export async function checkServer() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('api/status', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}

export function connect(mode) {
  return mode === 'online' ? connectOnline() : connectOffline();
}

function makeHandlers() {
  return { msg: () => {}, close: () => {} };
}

function connectOnline() {
  return new Promise((resolve, reject) => {
    const base = new URL('ws', location.href);
    base.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(base.href);
    const h = makeHandlers();
    let opened = false;
    const timer = setTimeout(() => { if (!opened) { ws.close(); reject(new Error('서버 응답 시간 초과')); } }, 6000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        mode: 'online',
        send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
        onMessage: (f) => { h.msg = f; },
        onClose: (f) => { h.close = f; },
        close: () => { h.close = () => {}; ws.close(); },
      });
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      h.msg(m);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (!opened) reject(new Error('서버에 연결할 수 없습니다'));
      else h.close();
    };
    ws.onerror = () => {};
  });
}

const OFFLINE_KEY = 'eldermoon_offline_saves';

async function connectOffline() {
  const { World } = await import('../shared/world.js');
  let saves = {};
  try { saves = JSON.parse(localStorage.getItem(OFFLINE_KEY)) || {}; } catch { saves = {}; }
  let pending = null;
  const store = {
    load: (t) => saves[t] || null,
    save: (t, d) => {
      saves[t] = d;
      clearTimeout(pending);
      pending = setTimeout(() => { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(saves)); } catch { /* 저장 공간 부족 */ } }, 300);
    },
  };
  const world = new World({ bots: 8, store });
  const h = makeHandlers();
  const queue = [];
  let flushing = false;
  const deliver = (m) => {
    queue.push(m);
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => {
      flushing = false;
      const items = queue.splice(0);
      for (const it of items) h.msg(it);
    });
  };
  const handle = world.connect((m) => deliver(structuredClone(m)));
  let last = performance.now();
  const iv = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    world.tick(dt);
  }, 100);
  const flushSave = () => {
    for (const p of world.players.values()) world.savePlayer(p);
    clearTimeout(pending);
    try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(saves)); } catch { /* 무시 */ }
  };
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  return {
    mode: 'offline',
    send: (m) => handle.receive(structuredClone(m)),
    onMessage: (f) => { h.msg = f; },
    onClose: (f) => { h.close = f; },
    close: () => { flushSave(); clearInterval(iv); handle.close(); },
  };
}
