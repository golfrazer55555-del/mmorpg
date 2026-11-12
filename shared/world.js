// 권위적(authoritative) 월드 시뮬레이션.
// Node 서버와 브라우저(오프라인 모드) 양쪽에서 동일하게 동작한다.
import {
  TICK_RATE, MAX_LEVEL, INTEREST_RADIUS, WORLD, CLASSES, SKILLS, ITEMS, MONSTERS, NPCS, QUESTS,
  START_WEAPON, WEAPON_PREFIX, SHOP_LIST, xpToNext, resolveItemId, computeStats, monsterXpFactor,
} from './data.js';
import { isWalkable, inTown, generateSpawns, resolveCollision } from './terrain.js';

const DT = 1 / TICK_RATE;
const R2 = INTEREST_RADIUS * INTEREST_RADIUS;
const LEASH = 34;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeToken() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const a = new Uint8Array(18);
    c.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function sanitizeName(n) {
  if (typeof n !== 'string') return null;
  n = n.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 12) return null;
  return n;
}

function sanitizeText(m, max = 120) {
  if (typeof m !== 'string') return '';
  return m.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

const BOT_NAMES = ['은빛바람', '달그림자', '푸른검객', '별헤는밤', '루나', '철벽수호자', '숲의사냥꾼', '불꽃술사', '새벽이슬', '모험왕'];
const BOT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#00acc1', '#fb8c00', '#6d4c41'];
const BOT_LEVELS = [3, 6, 10, 14, 18, 2, 8, 12, 16, 5];
const BOT_LINES = [
  '오늘 사냥 잘 되네요!', '물약이 너무 빨리 떨어져요 ㅠㅠ', '골렘 잡으러 가실 분 계신가요?',
  '이 근처 몬스터 리젠이 빠르네요', '화산지대 임프는 원거리 공격하니 조심하세요!',
  '마을 상인한테 물약 미리 사두세요~', '자동사냥 켜두면 정말 편해요', '묘지 분위기 너무 으스스해요...',
  '다들 즐거운 모험 되세요~', '북쪽 숲 늑대들 은근 아파요', '퀘스트는 촌장님한테 받으면 돼요!',
];
const BOT_GREET = ['안녕하세요! 👋', '반가워요!', '엘더문에 오신 걸 환영해요~', '하이하이!', '어서오세요!'];

const ZONE_BY_LEVEL = (lv) => (lv < 4 ? 'meadow' : lv < 8 ? 'forest' : lv < 12 ? 'highland' : lv < 16 ? 'graveyard' : 'volcano');
const ZONE_ANGLE = { forest: -Math.PI / 2, highland: 0, graveyard: Math.PI / 2, volcano: Math.PI };

export class World {
  constructor(opts = {}) {
    this.store = opts.store || null; // { load(token) => data|null, save(token, data) }
    this.log = opts.log || (() => {});
    this.time = 0;
    this.nextId = 1;
    this.players = new Map();
    this.monsters = new Map();
    this.events = [];
    this.timers = [];
    this.saveTimer = 0;
    for (const s of generateSpawns()) this.spawnMonster(s);
    const bots = opts.bots ?? 6;
    for (let i = 0; i < bots; i++) this.addBot(i);
  }

  // ---------- 연결 ----------
  connect(send) {
    const conn = { send, player: null };
    return {
      receive: (msg) => {
        try { this.onMessage(conn, msg); } catch (e) { this.log('message error', e); }
      },
      close: () => this.onClose(conn),
    };
  }

  status() {
    let humans = 0, bots = 0;
    for (const p of this.players.values()) (p.bot ? bots++ : humans++);
    return { players: humans, bots, monsters: this.monsters.size };
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!conn.player) {
      if (msg.t === 'join') this.join(conn, msg);
      return;
    }
    const p = conn.player;
    switch (msg.t) {
      case 'move': return this.handleMove(p, msg);
      case 'atk': return this.handleAttack(p, msg);
      case 'sk': return this.handleSkill(p, msg);
      case 'use': return this.handleUse(p, msg);
      case 'equip': return this.handleEquip(p, msg);
      case 'unequip': return this.handleUnequip(p, msg);
      case 'buy': return this.handleBuy(p, msg);
      case 'sell': return this.handleSell(p, msg);
      case 'quest': return this.handleQuest(p);
      case 'pray': return this.handlePray(p);
      case 'chat': return this.handleChat(p, msg);
      case 'respawn': return this.handleRespawn(p);
      case 'ping': return conn.send({ t: 'pong', c: msg.c });
    }
  }

  onClose(conn) {
    const p = conn.player;
    if (!p) return;
    conn.player = null;
    this.savePlayer(p);
    this.removePlayer(p);
    this.broadcastMsg({ k: 'sys', m: `${p.name}님이 접속을 종료했습니다.` });
  }

  join(conn, msg) {
    let token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null;
    let data = token && this.store ? this.store.load(token) : null;
    if (!data) {
      const name = sanitizeName(msg.name);
      if (!name) return conn.send({ t: 'err', m: '이름은 2~12자로 입력해 주세요.' });
      const cls = CLASSES[msg.cls] ? msg.cls : 'warrior';
      const color = typeof msg.color === 'string' && /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#1e88e5';
      token = makeToken();
      data = this.newCharacter(name, cls, color);
    } else {
      for (const other of this.players.values()) {
        if (!other.bot && other.token === token) {
          other.conn.send({ t: 'kick', m: '다른 기기에서 같은 캐릭터로 접속했습니다.' });
          this.savePlayer(other);
          this.removePlayer(other);
          other.conn.player = null;
        }
      }
    }
    const p = this.createPlayer(data, token, conn);
    conn.player = p;
    conn.send({ t: 'welcome', id: p.id, token, me: this.privateState(p), x: p.x, z: p.z });
    this.sendMsg(p, { k: 'sys', m: `엘더문 온라인에 오신 것을 환영합니다, ${p.name}님!` });
    if (!p.quest.active && p.quest.idx === 0) this.sendMsg(p, { k: 'sys', m: '마을 북쪽의 촌장 엘다에게 말을 걸어 퀘스트를 받으세요.' });
    this.broadcastMsg({ k: 'sys', m: `${p.name}님이 접속했습니다.` }, p);
    this.savePlayer(p);
  }

  newCharacter(name, cls, color) {
    return {
      name, cls, color, level: 1, xp: 0, gold: 30,
      inv: { hp_potion: 5, mp_potion: 3 },
      equip: { weapon: START_WEAPON[cls], armor: null },
      quest: { idx: 0, active: false, progress: 0 },
      x: rand(-3, 3), z: rand(5, 8),
    };
  }

  createPlayer(data, token, conn) {
    const p = {
      id: this.nextId++, bot: false, token, conn,
      name: data.name, cls: CLASSES[data.cls] ? data.cls : 'warrior', color: data.color || '#1e88e5',
      level: Math.min(MAX_LEVEL, Math.max(1, data.level | 0)), xp: Math.max(0, data.xp | 0), gold: Math.max(0, data.gold | 0),
      inv: {}, equip: { weapon: null, armor: null },
      quest: { idx: 0, active: false, progress: 0, target: null, count: 0 },
      x: 0, z: 6, ry: 0, hp: 1, mp: 1,
      dead: false, deadUntil: 0, lastMove: this.time, lastCombat: -100,
      cds: {}, buffs: [], known: new Map(), infoVer: 1, chatAt: 0, dirty: true, stats: null,
    };
    for (const [k, v] of Object.entries(data.inv || {})) if (ITEMS[k] && v > 0) p.inv[k] = Math.min(9999, v | 0);
    if (data.equip?.weapon && ITEMS[data.equip.weapon]?.cls === p.cls) p.equip.weapon = data.equip.weapon;
    if (data.equip?.armor && ITEMS[data.equip.armor]?.type === 'armor') p.equip.armor = data.equip.armor;
    if (data.quest) Object.assign(p.quest, data.quest);
    if (p.quest.active && !MONSTERS[p.quest.target]) {
      const d = this.questDef(p);
      p.quest.target = d.target; p.quest.count = d.count;
    }
    if (typeof data.x === 'number' && typeof data.z === 'number' && isWalkable(data.x, data.z)) {
      p.x = data.x; p.z = data.z;
    }
    this.recalc(p);
    p.hp = Math.min(p.stats.maxHp, data.hp > 0 ? data.hp : p.stats.maxHp);
    p.mp = Math.min(p.stats.maxMp, data.mp >= 0 && data.mp !== undefined ? data.mp : p.stats.maxMp);
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(p) {
    this.players.delete(p.id);
    for (const o of this.players.values()) o.known.delete(p.id);
    for (const m of this.monsters.values()) if (m.target === p.id) { m.target = 0; m.state = 'return'; }
  }

  serialize(p) {
    return {
      name: p.name, cls: p.cls, color: p.color, level: p.level, xp: p.xp, gold: p.gold,
      inv: p.inv, equip: p.equip, quest: p.quest, x: r1(p.x), z: r1(p.z),
      hp: Math.ceil(p.hp), mp: Math.ceil(p.mp), savedAt: Date.now(),
    };
  }

  savePlayer(p) {
    if (p.bot || !p.token || !this.store) return;
    try { this.store.save(p.token, this.serialize(p)); } catch (e) { this.log('save error', e); }
  }

  // ---------- 봇 (AI 모험가) ----------
  addBot(i) {
    const cls = ['warrior', 'mage', 'archer'][i % 3];
    const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? i : '');
    const data = this.newCharacter(name, cls, BOT_COLORS[i % BOT_COLORS.length]);
    data.level = BOT_LEVELS[i % BOT_LEVELS.length];
    const p = this.createPlayer(data, null, null);
    p.bot = true;
    p.ai = { state: 'hunt', target: 0, wx: null, wz: null, wanderAt: 0, chatAt: this.time + rand(20, 80), skillAt: 0 };
    this.botGear(p);
    p.hp = p.stats.maxHp; p.mp = p.stats.maxMp;
    const spot = this.botWanderPoint(p);
    p.x = spot.x; p.z = spot.z;
  }

  botGear(p) {
    const tier = p.level >= 18 ? 4 : p.level >= 11 ? 3 : p.level >= 6 ? 2 : p.level >= 2 ? 1 : 0;
    p.equip.weapon = WEAPON_PREFIX[p.cls] + '_' + tier;
    const at = p.level >= 16 ? 4 : p.level >= 10 ? 3 : p.level >= 5 ? 2 : 1;
    p.equip.armor = 'armor_' + at;
    p.inv.hp_potion = 6;
    this.recalc(p);
    p.infoVer++;
  }

  botWanderPoint(p) {
    const zone = ZONE_BY_LEVEL(p.level);
    for (let i = 0; i < 30; i++) {
      let a, r;
      if (zone === 'meadow') { a = rand(-Math.PI, Math.PI); r = rand(48, 86); }
      else { a = ZONE_ANGLE[zone] + rand(-0.55, 0.55); r = rand(112, 165); }
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (isWalkable(x, z) && Math.hypot(x - WORLD.boss.x, z - WORLD.boss.z) > WORLD.boss.r + 10) return { x, z };
    }
    return { x: 0, z: 40 };
  }

  moveEntity(e, tx, tz, speed, dt, stop = 0.3, isMonster = false) {
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return false;
    const step = Math.min(speed * dt, d - stop);
    let nx = e.x + (dx / d) * step, nz = e.z + (dz / d) * step;
    if (isMonster && inTown(nx, nz, 3)) return false;
    if (!isWalkable(nx, nz)) return false;
    if (!isMonster) ({ x: nx, z: nz } = resolveCollision(nx, nz, 0.45));
    e.x = nx; e.z = nz;
    e.ry = Math.atan2(dx, dz);
    return true;
  }

  updateBot(p, dt) {
    const ai = p.ai;
    if (p.dead) {
      if (this.time >= p.deadUntil + 2) this.respawn(p);
      return;
    }
    // 잡담
    if (this.time >= ai.chatAt) {
      ai.chatAt = this.time + rand(70, 160);
      if (this.hasHumans()) this.broadcastChat(p, pick(BOT_LINES));
    }
    const maxHp = p.stats.maxHp;
    if (ai.state === 'hunt' && p.hp < maxHp * 0.35) {
      if ((p.inv.hp_potion || 0) > 0 && (p.cds.potion || 0) <= this.time) this.useItem(p, 'hp_potion');
      else { ai.state = 'rest'; ai.target = 0; }
    }
    if (ai.state === 'rest') {
      if (inTown(p.x, p.z, -6)) {
        if (p.hp >= maxHp * 0.98) {
          ai.state = 'hunt'; p.inv.hp_potion = 6;
          const s = this.botWanderPoint(p); ai.wx = s.x; ai.wz = s.z;
        }
      } else {
        this.moveEntity(p, rand(-1, 1), 6, this.eff(p, 'speed'), dt, 2);
      }
      return;
    }
    let t = this.monsters.get(ai.target);
    if (!t || t.dead) {
      t = null; ai.target = 0;
      let best = 45 * 45;
      for (const m of this.monsters.values()) {
        if (m.dead || m.T.boss || m.T.level > p.level + 2) continue;
        const d = dist2(m, p);
        if (d < best) { best = d; t = m; }
      }
      if (t) ai.target = t.id;
    }
    const spd = this.eff(p, 'speed');
    if (!t) {
      if (ai.wx === null || this.time > ai.wanderAt || Math.hypot(ai.wx - p.x, ai.wz - p.z) < 2) {
        const s = this.botWanderPoint(p); ai.wx = s.x; ai.wz = s.z; ai.wanderAt = this.time + 25;
      }
      if (!this.moveEntity(p, ai.wx, ai.wz, spd, dt, 1)) ai.wx = null;
      return;
    }
    const d = dist(p, t);
    const range = p.stats.range;
    if (d > range - 0.4) {
      if (!this.moveEntity(p, t.x, t.z, spd, dt, range * 0.8)) ai.target = 0;
      return;
    }
    p.ry = Math.atan2(t.x - p.x, t.z - p.z);
    if (this.time >= ai.skillAt) {
      ai.skillAt = this.time + rand(1.5, 3.5);
      const skills = CLASSES[p.cls].skills;
      const sid = pick(skills);
      const S = SKILLS[sid];
      const ok = (S.type === 'target' || S.type === 'aoe_target') ||
        (S.type === 'aoe_self' && d < S.radius) ||
        (S.type === 'heal' && p.hp < maxHp * 0.7) ||
        (S.type === 'buff');
      if (ok && this.castSkill(p, sid, t.id, true)) return;
    }
    if ((p.cds.atk || 0) <= this.time) this.doAttack(p, t);
  }

  hasHumans() {
    for (const p of this.players.values()) if (!p.bot) return true;
    return false;
  }

  // ---------- 스탯 ----------
  recalc(p) {
    p.stats = computeStats(p);
  }

  eff(p, key) {
    let v = p.stats[key];
    for (const b of p.buffs) {
      if (key === 'atkCd' && b.mods.atkSpeed) v /= b.mods.atkSpeed;
      else if (b.mods[key]) v *= b.mods[key];
    }
    return v;
  }

  privateState(p) {
    const q = this.questView(p);
    return {
      id: p.id, name: p.name, cls: p.cls, color: p.color, level: p.level,
      xp: p.xp, xpNext: xpToNext(p.level), gold: p.gold,
      hp: Math.ceil(p.hp), mp: Math.floor(p.mp), maxHp: p.stats.maxHp, maxMp: p.stats.maxMp,
      atk: Math.round(this.eff(p, 'atk')), def: Math.round(this.eff(p, 'def')),
      range: p.stats.range, atkCd: r2(this.eff(p, 'atkCd')), speed: r2(this.eff(p, 'speed')), crit: p.stats.crit,
      inv: p.inv, equip: p.equip, quest: q,
      buffs: p.buffs.map((b) => ({ k: b.k, t: r1(b.until - this.time) })),
      dead: p.dead, respawnIn: p.dead ? r1(Math.max(0, p.deadUntil - this.time)) : 0,
    };
  }

  markDirty(p) { p.dirty = true; }

  playerInfo(o) {
    return { id: o.id, k: 'p', name: o.name, cls: o.cls, color: o.color, level: o.level, weapon: o.equip.weapon, armor: o.equip.armor, bot: o.bot ? 1 : 0 };
  }

  // ---------- 메시지 ----------
  sendMsg(p, obj) {
    if (p.conn) p.conn.send({ t: 'msg', ...obj });
  }

  broadcastMsg(obj, except = null) {
    for (const p of this.players.values()) if (p.conn && p !== except) p.conn.send({ t: 'msg', ...obj });
  }

  broadcastChat(p, m) {
    const msg = { t: 'chat', id: p.id, from: p.name, cls: p.cls, m, bot: p.bot ? 1 : 0 };
    for (const o of this.players.values()) if (o.conn) o.conn.send(msg);
  }

  event(x, z, e) {
    this.events.push({ x, z, e });
  }

  // ---------- 이동 ----------
  handleMove(p, msg) {
    if (p.dead) return;
    const x = Number(msg.x), z = Number(msg.z), ry = Number(msg.ry);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dt = Math.min(1, Math.max(0.1, this.time - p.lastMove));
    const maxD = this.eff(p, 'speed') * dt * 1.4 + 1.5;
    const d = Math.hypot(x - p.x, z - p.z);
    p.lastMove = this.time;
    if (d > maxD || !isWalkable(x, z)) {
      p.conn?.send({ t: 'pos', x: r2(p.x), z: r2(p.z) });
      return;
    }
    p.x = x; p.z = z;
    if (Number.isFinite(ry)) p.ry = ry;
  }

  // ---------- 전투 ----------
  rollDamage(p, m, mult, critBonus = 0) {
    const crit = Math.random() < p.stats.crit + critBonus;
    const dmg = this.eff(p, 'atk') * mult * rand(0.9, 1.1) * (60 / (60 + m.T.def)) * (crit ? 1.6 : 1);
    return [Math.max(1, Math.round(dmg)), crit];
  }

  handleAttack(p, msg) {
    if (p.dead) return;
    const m = this.monsters.get(msg.id);
    if (!m || m.dead) return;
    if ((p.cds.atk || 0) > this.time + 0.3) return;
    if (dist(p, m) > p.stats.range + 1.6 + m.T.size * 0.6) return;
    this.doAttack(p, m);
  }

  doAttack(p, m) {
    p.cds.atk = this.time + this.eff(p, 'atkCd');
    p.ry = Math.atan2(m.x - p.x, m.z - p.z);
    const [dmg, crit] = this.rollDamage(p, m, 1);
    this.damageMonster(m, p, dmg, crit, 'atk_' + p.cls);
    return true;
  }

  handleSkill(p, msg) {
    if (p.dead || typeof msg.s !== 'string') return;
    this.castSkill(p, msg.s, msg.id, false);
  }

  castSkill(p, sid, targetId, quiet) {
    if (!CLASSES[p.cls].skills.includes(sid)) return false;
    const S = SKILLS[sid];
    const now = this.time;
    if ((p.cds[sid] || 0) > now + 0.3) return false;
    if (p.mp < S.mp) { if (!quiet) this.sendMsg(p, { k: 'warn', m: '마나가 부족합니다.' }); return false; }
    let target = null;
    if (S.type === 'target' || S.type === 'aoe_target') {
      target = this.monsters.get(targetId);
      if (!target || target.dead) { if (!quiet) this.sendMsg(p, { k: 'warn', m: '대상을 선택하세요.' }); return false; }
      if (dist(p, target) > S.range + 1.6 + target.T.size * 0.6) { if (!quiet) this.sendMsg(p, { k: 'warn', m: '대상이 너무 멉니다.' }); return false; }
      p.ry = Math.atan2(target.x - p.x, target.z - p.z);
    }
    p.mp -= S.mp;
    p.cds[sid] = now + S.cd;
    p.conn?.send({ t: 'cd', k: sid, d: S.cd });
    this.event(p.x, p.z, ['cast', p.id, sid, target ? target.id : 0]);

    if (S.type === 'target') {
      const [dmg, crit] = this.rollDamage(p, target, S.mult, S.critBonus || 0);
      this.damageMonster(target, p, dmg, crit, sid);
    } else if (S.type === 'aoe_self' || S.type === 'aoe_target') {
      const c = S.type === 'aoe_self' ? p : target;
      for (const m of this.monsters.values()) {
        if (m.dead || dist(m, c) > S.radius + m.T.size * 0.5) continue;
        const [dmg, crit] = this.rollDamage(p, m, S.mult);
        if (S.slow) { m.slowUntil = now + S.slow.dur; m.slowMult = S.slow.mult; }
        this.damageMonster(m, p, dmg, crit, sid);
      }
    } else if (S.type === 'buff') {
      p.buffs = p.buffs.filter((b) => b.k !== sid);
      p.buffs.push({ k: sid, mods: S.buff, until: now + S.buff.dur });
      if (S.heal) this.healPlayer(p, p.stats.maxHp * S.heal);
    } else if (S.type === 'heal') {
      for (const o of this.players.values()) {
        if (o.dead || dist(o, p) > S.radius) continue;
        this.healPlayer(o, o.stats.maxHp * S.heal);
      }
    }
    this.markDirty(p);
    return true;
  }

  healPlayer(p, amt) {
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amt);
    const healed = Math.round(p.hp - before);
    if (healed > 0) this.event(p.x, p.z, ['heal', p.id, healed]);
  }

  damageMonster(m, p, dmg, crit, kind) {
    if (m.dead) return;
    m.hp -= dmg;
    m.damagers.set(p.id, (m.damagers.get(p.id) || 0) + dmg);
    p.lastCombat = this.time;
    this.event(m.x, m.z, ['hit', p.id, m.id, dmg, crit ? 1 : 0, kind]);
    if (m.hp <= 0) return this.killMonster(m, p);
    if (m.state !== 'chase') {
      m.state = 'chase';
      m.target = p.id;
      m.nextAtk = Math.max(m.nextAtk, this.time + 0.6);
    }
  }

  killMonster(m, killer) {
    m.dead = true; m.hp = 0; m.state = 'dead'; m.target = 0;
    m.diedAt = this.time;
    m.respawnAt = this.time + m.T.respawn * rand(0.9, 1.25);
    this.event(m.x, m.z, ['die', m.id]);
    for (const [pid] of m.damagers) {
      const p = this.players.get(pid);
      if (!p || p.dead || dist(p, m) > 60) continue;
      const xp = Math.max(1, Math.round(m.T.xp * monsterXpFactor(p.level, m.T.level)));
      const gold = randInt(m.T.gold[0], m.T.gold[1]);
      p.gold += gold;
      const loot = [];
      for (const [item, chance] of m.T.drops) {
        if (Math.random() < chance) {
          const id = resolveItemId(item, p.cls);
          if (!p.bot) { this.giveItem(p, id, 1); loot.push(ITEMS[id].icon + ' ' + ITEMS[id].name); }
        }
      }
      if (p.quest.active && p.quest.target === m.type && p.quest.progress < p.quest.count) {
        p.quest.progress++;
        const done = p.quest.progress >= p.quest.count;
        this.sendMsg(p, { k: 'quest', m: done ? `퀘스트 목표 달성! 촌장 엘다에게 돌아가세요.` : `${m.T.name} ${p.quest.progress}/${p.quest.count}` });
      }
      this.sendMsg(p, { k: 'loot', m: `+${xp} 경험치 · +${gold} 골드` + (loot.length ? ' · ' + loot.join(', ') : '') });
      this.giveXp(p, xp);
      this.markDirty(p);
    }
    m.damagers.clear();
    if (m.T.boss) this.broadcastMsg({ k: 'boss', m: `⚔️ ${killer.name}님의 일행이 ${m.T.name}을(를) 쓰러뜨렸습니다!` });
  }

  giveXp(p, xp) {
    if (p.level >= MAX_LEVEL || p.bot) return; // 봇은 레벨 고정 (지역별로 고르게 분포)
    p.xp += xp;
    let up = false;
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      up = true;
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
    if (up) {
      this.recalc(p);
      if (p.bot) this.botGear(p);
      p.hp = p.stats.maxHp; p.mp = p.stats.maxMp;
      p.infoVer++;
      this.event(p.x, p.z, ['lvl', p.id]);
      this.sendMsg(p, { k: 'lvl', m: `레벨 업! Lv.${p.level} 달성!` });
      if (!p.bot && p.level % 5 === 0) this.broadcastMsg({ k: 'sys', m: `🎉 ${p.name}님이 Lv.${p.level}을 달성했습니다!` }, p);
      this.savePlayer(p);
    }
    this.markDirty(p);
  }

  giveItem(p, id, n) {
    if (!ITEMS[id]) return;
    p.inv[id] = Math.min(9999, (p.inv[id] || 0) + n);
    this.markDirty(p);
  }

  takeItem(p, id, n = 1) {
    if (!(p.inv[id] >= n)) return false;
    p.inv[id] -= n;
    if (p.inv[id] <= 0) delete p.inv[id];
    this.markDirty(p);
    return true;
  }

  damagePlayer(p, dmg, src, kind) {
    if (p.dead) return;
    p.hp -= dmg;
    p.lastCombat = this.time;
    this.event(p.x, p.z, ['hit', src.id, p.id, dmg, 0, kind]);
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.deadUntil = this.time + 5;
      p.buffs = [];
      const lose = Math.round(xpToNext(p.level) * 0.03);
      p.xp = Math.max(0, p.xp - lose);
      this.event(p.x, p.z, ['die', p.id]);
      this.sendMsg(p, { k: 'death', m: `${src.T ? src.T.name : src.name}에게 쓰러졌습니다. (경험치 -${lose})` });
      for (const m of this.monsters.values()) if (m.target === p.id) { m.target = 0; m.state = 'return'; }
      this.markDirty(p);
    }
  }

  handleRespawn(p) {
    if (!p.dead || this.time < p.deadUntil) return;
    this.respawn(p);
  }

  respawn(p) {
    p.dead = false;
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    p.x = rand(-3, 3); p.z = rand(5, 8);
    p.lastMove = this.time;
    if (p.ai) { p.ai.state = 'hunt'; p.ai.target = 0; p.ai.wx = null; }
    p.conn?.send({ t: 'pos', x: r2(p.x), z: r2(p.z) });
    this.event(p.x, p.z, ['resp', p.id]);
    this.markDirty(p);
  }

  // ---------- 아이템 ----------
  handleUse(p, msg) {
    if (p.dead || typeof msg.item !== 'string') return;
    const it = ITEMS[msg.item];
    if (!it || it.type !== 'consumable') return;
    if ((p.cds.potion || 0) > this.time + 0.15) return;
    if (!(p.inv[msg.item] > 0)) return this.sendMsg(p, { k: 'warn', m: `${it.name}이(가) 없습니다.` });
    this.useItem(p, msg.item);
  }

  useItem(p, id) {
    const it = ITEMS[id];
    if (!this.takeItem(p, id, 1)) return;
    p.cds.potion = this.time + 1.5;
    p.conn?.send({ t: 'cd', k: 'potion', d: 1.5 });
    if (it.hp) this.healPlayer(p, p.stats.maxHp * it.hp);
    if (it.mp) {
      p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * it.mp);
      this.event(p.x, p.z, ['mana', p.id]);
    }
    this.markDirty(p);
  }

  handleEquip(p, msg) {
    const id = msg.item;
    const it = typeof id === 'string' ? ITEMS[id] : null;
    if (!it || !(p.inv[id] > 0)) return;
    if (it.type !== 'weapon' && it.type !== 'armor') return;
    if (it.type === 'weapon' && it.cls !== p.cls) return this.sendMsg(p, { k: 'warn', m: `${CLASSES[it.cls].name} 전용 장비입니다.` });
    if (p.level < it.level) return this.sendMsg(p, { k: 'warn', m: `레벨 ${it.level} 이상 착용 가능합니다.` });
    const slot = it.type;
    const old = p.equip[slot];
    this.takeItem(p, id, 1);
    p.equip[slot] = id;
    if (old) this.giveItem(p, old, 1);
    this.recalc(p);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    p.infoVer++;
    this.sendMsg(p, { k: 'sys', m: `${it.name}을(를) 장착했습니다.` });
    this.markDirty(p);
  }

  handleUnequip(p, msg) {
    if (msg.slot !== 'armor' || !p.equip.armor) return;
    this.giveItem(p, p.equip.armor, 1);
    p.equip.armor = null;
    this.recalc(p);
    p.hp = Math.min(p.hp, p.stats.maxHp);
    p.infoVer++;
    this.markDirty(p);
  }

  nearNpc(p, role) {
    const n = NPCS.find((x) => x.role === role);
    return n && Math.hypot(n.x - p.x, n.z - p.z) < 8;
  }

  shopItems(cls) {
    return SHOP_LIST.map((id) => resolveItemId(id, cls));
  }

  handleBuy(p, msg) {
    if (!this.nearNpc(p, 'shop')) return this.sendMsg(p, { k: 'warn', m: '상인에게 가까이 가야 합니다.' });
    const id = msg.item;
    if (!this.shopItems(p.cls).includes(id)) return;
    const n = Math.max(1, Math.min(50, msg.n | 0 || 1));
    const it = ITEMS[id];
    const cost = it.price * n;
    if (p.gold < cost) return this.sendMsg(p, { k: 'warn', m: '골드가 부족합니다.' });
    p.gold -= cost;
    this.giveItem(p, id, n);
    this.sendMsg(p, { k: 'sys', m: `${it.name} ${n}개를 구매했습니다. (-${cost} 골드)` });
    this.markDirty(p);
  }

  handleSell(p, msg) {
    if (!this.nearNpc(p, 'shop')) return this.sendMsg(p, { k: 'warn', m: '상인에게 가까이 가야 합니다.' });
    const id = msg.item;
    const it = typeof id === 'string' ? ITEMS[id] : null;
    if (!it) return;
    const n = Math.max(1, Math.min(p.inv[id] || 0, msg.n | 0 || 1));
    if (!this.takeItem(p, id, n)) return;
    const gain = Math.max(1, Math.floor(it.price * 0.4)) * n;
    p.gold += gain;
    this.sendMsg(p, { k: 'sys', m: `${it.name} ${n}개를 판매했습니다. (+${gain} 골드)` });
    this.markDirty(p);
  }

  // ---------- 퀘스트 ----------
  questDef(p) {
    const q = p.quest;
    if (q.idx < QUESTS.length) return QUESTS[q.idx];
    let target = q.active && q.target ? q.target : null;
    if (!target) {
      target = 'slime';
      for (const t of ['slime', 'wolf', 'goblin', 'skeleton', 'imp']) if (MONSTERS[t].level <= p.level) target = t;
    }
    const M = MONSTERS[target];
    return {
      name: `[반복] ${M.name} 토벌`, target, count: 15, minLevel: 1, repeat: true,
      xp: Math.round(M.xp * 15 * 0.8), gold: M.gold[1] * 12, items: [['big_hp_potion', 2]],
      text: `${M.name} 15마리를 토벌해 주게. 보상은 넉넉히 챙겨주겠네.`,
    };
  }

  questView(p) {
    const d = this.questDef(p);
    const q = p.quest;
    return {
      idx: q.idx, active: q.active, progress: q.progress, count: d.count, target: d.target,
      name: d.name, text: d.text, minLevel: d.minLevel, xp: d.xp, gold: d.gold,
      items: d.items.map(([id, n]) => [resolveItemId(id, p.cls), n]),
      done: q.active && q.progress >= d.count,
    };
  }

  handleQuest(p) {
    if (!this.nearNpc(p, 'quest')) return this.sendMsg(p, { k: 'warn', m: '촌장에게 가까이 가야 합니다.' });
    const q = p.quest;
    const d = this.questDef(p);
    if (!q.active) {
      if (p.level < d.minLevel) return this.sendMsg(p, { k: 'warn', m: `레벨 ${d.minLevel} 이상이 되면 다시 찾아오게.` });
      q.active = true; q.progress = 0; q.target = d.target; q.count = d.count;
      this.sendMsg(p, { k: 'quest', m: `퀘스트 수락: ${d.name}` });
    } else if (q.progress >= q.count) {
      this.giveXp(p, d.xp);
      p.gold += d.gold;
      const names = [];
      for (const [id0, n] of d.items) {
        const id = resolveItemId(id0, p.cls);
        this.giveItem(p, id, n);
        names.push(`${ITEMS[id].name} x${n}`);
      }
      q.idx++; q.active = false; q.progress = 0; q.target = null; q.count = 0;
      this.event(p.x, p.z, ['quest', p.id]);
      this.sendMsg(p, { k: 'quest', m: `퀘스트 완료: ${d.name}! (+${d.xp} 경험치, +${d.gold} 골드, ${names.join(', ')})` });
      this.savePlayer(p);
    } else {
      this.sendMsg(p, { k: 'warn', m: `아직 완료하지 못했네. (${q.progress}/${q.count})` });
    }
    this.markDirty(p);
  }

  handlePray(p) {
    if (!this.nearNpc(p, 'heal') || p.dead) return;
    this.healPlayer(p, p.stats.maxHp);
    p.mp = p.stats.maxMp;
    this.event(p.x, p.z, ['mana', p.id]);
    this.sendMsg(p, { k: 'sys', m: '사제 루미의 축복으로 체력과 마나가 모두 회복되었습니다.' });
    this.markDirty(p);
  }

  // ---------- 채팅 ----------
  handleChat(p, msg) {
    const m = sanitizeText(msg.m);
    if (!m) return;
    if (this.time - p.chatAt < 0.8) return this.sendMsg(p, { k: 'warn', m: '채팅을 너무 빠르게 보내고 있습니다.' });
    p.chatAt = this.time;
    this.broadcastChat(p, m);
    if (/안녕|하이|ㅎㅇ|반가|hello|\bhi\b/i.test(m)) {
      const bots = [...this.players.values()].filter((b) => b.bot);
      if (bots.length) {
        const b = pick(bots);
        this.timers.push({ at: this.time + rand(1.2, 3), fn: () => this.players.has(b.id) && this.broadcastChat(b, pick(BOT_GREET)) });
      }
    }
  }

  // ---------- 몬스터 ----------
  spawnMonster(s) {
    const T = MONSTERS[s.type];
    const m = {
      id: this.nextId++, type: s.type, T, sx: s.x, sz: s.z, x: s.x, z: s.z, ry: Math.random() * 6.28,
      hp: T.hp, maxHp: T.hp, state: 'idle', target: 0, nextAtk: 0, atkCount: 0,
      wx: null, wz: null, wanderAt: this.time + rand(0, 5), dead: false, diedAt: 0, respawnAt: 0,
      damagers: new Map(), slowUntil: 0, slowMult: 1,
    };
    this.monsters.set(m.id, m);
  }

  respawnMonster(m) {
    m.dead = false; m.hp = m.maxHp; m.state = 'idle'; m.target = 0;
    m.x = m.sx + rand(-2, 2); m.z = m.sz + rand(-2, 2);
    if (!isWalkable(m.x, m.z)) { m.x = m.sx; m.z = m.sz; }
    m.damagers.clear(); m.atkCount = 0;
    this.event(m.x, m.z, ['spawn', m.id]);
  }

  updateMonster(m, dt) {
    const T = m.T;
    if (m.dead) {
      if (this.time >= m.respawnAt) this.respawnMonster(m);
      return;
    }
    const spd = T.speed * (m.slowUntil > this.time ? m.slowMult : 1);
    if (m.state === 'idle') {
      if (T.aggro > 0) {
        let best = T.aggro * T.aggro, tgt = null;
        for (const p of this.players.values()) {
          if (p.dead || inTown(p.x, p.z, 2)) continue;
          const d = dist2(p, m);
          if (d < best) { best = d; tgt = p; }
        }
        if (tgt) {
          m.state = 'chase'; m.target = tgt.id;
          m.nextAtk = Math.max(m.nextAtk, this.time + 0.8);
          return;
        }
      }
      if (this.time >= m.wanderAt) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
        m.wx = m.sx + Math.cos(a) * r; m.wz = m.sz + Math.sin(a) * r;
        m.wanderAt = this.time + rand(4, 9);
      }
      if (m.wx !== null && !this.moveEntity(m, m.wx, m.wz, spd * 0.35, dt, 0.3, true)) m.wx = null;
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * dt);
    } else if (m.state === 'chase') {
      const t = this.players.get(m.target);
      const leash = T.boss ? 26 : LEASH;
      if (!t || t.dead || inTown(t.x, t.z, 2) || Math.hypot(m.x - m.sx, m.z - m.sz) > leash) {
        m.state = 'return'; m.target = 0;
        return;
      }
      const d = dist(m, t);
      const reach = T.range + T.size * 0.4;
      if (d > reach) {
        this.moveEntity(m, t.x, t.z, spd, dt, reach * 0.8, true);
      } else {
        m.ry = Math.atan2(t.x - m.x, t.z - m.z);
        if (this.time >= m.nextAtk) {
          m.nextAtk = this.time + T.atkCd;
          m.atkCount++;
          if (T.slam && m.atkCount % T.slam.every === 0) {
            this.event(m.x, m.z, ['slam', m.id]);
            for (const p of this.players.values()) {
              if (p.dead || dist(p, m) > T.slam.radius) continue;
              this.damagePlayer(p, this.monsterDamage(m, p, T.slam.mult), m, 'slam');
            }
          } else {
            this.damagePlayer(t, this.monsterDamage(m, t, 1), m, T.ranged ? 'm_fire' : 'm_atk');
          }
        }
      }
    } else if (m.state === 'return') {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.25 * dt);
      const moved = this.moveEntity(m, m.sx, m.sz, spd * 1.5, dt, 0.8, true);
      if (!moved) {
        m.state = 'idle'; m.hp = m.maxHp; m.damagers.clear(); m.wx = null;
        if (Math.hypot(m.x - m.sx, m.z - m.sz) > 3) { m.x = m.sx; m.z = m.sz; }
      }
    }
  }

  monsterDamage(m, p, mult) {
    const dmg = m.T.atk * mult * rand(0.85, 1.15) * (60 / (60 + this.eff(p, 'def')));
    return Math.max(1, Math.round(dmg));
  }

  separateMonsters() {
    const arr = [];
    for (const m of this.monsters.values()) if (!m.dead && m.state === 'chase') arr.push(m);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const min = 0.9 + (a.T.size + b.T.size) * 0.35;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4) {
          const push = (min - d) * 0.5;
          const ux = dx / d, uz = dz / d;
          const ax = a.x - ux * push, az = a.z - uz * push;
          const bx = b.x + ux * push, bz = b.z + uz * push;
          if (isWalkable(ax, az) && !inTown(ax, az, 3)) { a.x = ax; a.z = az; }
          if (isWalkable(bx, bz) && !inTown(bx, bz, 3)) { b.x = bx; b.z = bz; }
        }
      }
    }
  }

  // ---------- 플레이어 갱신 ----------
  updatePlayer(p, dt) {
    if (p.buffs.length) {
      const n = p.buffs.length;
      p.buffs = p.buffs.filter((b) => b.until > this.time);
      if (p.buffs.length !== n) this.markDirty(p);
    }
    if (p.bot) this.updateBot(p, dt);
    if (p.dead) return;
    const { maxHp, maxMp } = p.stats;
    const town = inTown(p.x, p.z);
    const calm = this.time - p.lastCombat > 5;
    const hpRate = town ? 0.12 : calm ? 0.04 : 0.004;
    const mpRate = town ? 0.12 : calm ? 0.05 : 0.012;
    p.hp = Math.min(maxHp, p.hp + maxHp * hpRate * dt);
    p.mp = Math.min(maxMp, p.mp + maxMp * mpRate * dt);
  }

  // ---------- 틱 ----------
  tick(dt = DT) {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    for (const m of this.monsters.values()) this.updateMonster(m, dt);
    this.separateMonsters();
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.sendSnapshots();
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      for (const p of this.players.values()) this.savePlayer(p);
    }
  }

  sendSnapshots() {
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const P = [], M = [], I = [];
      for (const o of this.players.values()) {
        if (o !== p && dist2(o, p) > R2) continue;
        P.push([o.id, r1(o.x), r1(o.z), r2(o.ry), Math.ceil(o.hp), o.stats.maxHp, o.dead ? 1 : 0]);
        if (p.known.get(o.id) !== o.infoVer) { p.known.set(o.id, o.infoVer); I.push(this.playerInfo(o)); }
      }
      for (const m of this.monsters.values()) {
        if (m.dead && this.time - m.diedAt > 2.5) continue;
        if (dist2(m, p) > R2) continue;
        M.push([m.id, r1(m.x), r1(m.z), r2(m.ry), Math.ceil(m.hp), m.maxHp, m.dead ? 1 : 0, m.state === 'chase' ? 1 : 0]);
        if (!p.known.has(m.id)) { p.known.set(m.id, 0); I.push({ id: m.id, k: 'm', type: m.type }); }
      }
      const E = [];
      for (const ev of this.events) if ((ev.x - p.x) ** 2 + (ev.z - p.z) ** 2 < R2) E.push(ev.e);
      const msg = { t: 's', P, M, S: [Math.ceil(p.hp), Math.floor(p.mp)] };
      if (I.length) msg.I = I;
      if (E.length) msg.E = E;
      if (p.dirty) { msg.me = this.privateState(p); p.dirty = false; }
      p.conn.send(msg);
    }
    this.events.length = 0;
  }
}
