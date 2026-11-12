// 엘더문 온라인 - 클라이언트 진입점
import * as THREE from 'three';
import { CLASSES, SKILLS, ITEMS, MONSTERS, NPCS, WORLD } from '../shared/data.js';
import { heightAt, zoneAt, resolveCollision, isWalkable, inTown, generateSpawns } from '../shared/terrain.js';
import { createWorld, isMobile } from './scene.js';
import { EntityManager } from './entities.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { connect, checkServer } from './net.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const COLORS = ['#1e88e5', '#e53935', '#43a047', '#fdd835', '#8e24aa', '#00acc1', '#fb8c00', '#ec407a'];
const RANGED_KIND = { atk_mage: 'bolt', atk_archer: 'arrow', fireball: 'fireball', piercing_shot: 'big_arrow', m_fire: 'm_fire' };
const tokenKey = (mode) => `eldermoon_token_${mode}`;
const charKey = (mode) => `eldermoon_char_${mode}`;

function loadSettings() {
  const def = { quality: isMobile ? 'medium' : 'high', fps: false, sens: 1 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('eldermoon_settings') || '{}') }; } catch { return def; }
}

class Game {
  constructor() {
    this.settings = loadSettings();
    this.net = null;
    this.me = null;
    this.myId = 0;
    this.x = 0; this.z = 6; this.ry = Math.PI;
    this.hp = 1; this.mp = 1;
    this.targetId = 0;
    this.engaged = false;
    this.auto = false;
    this.cds = {}; this.cdDur = {};
    this.atkReadyAt = 0;
    this.camYaw = 0; this.camPitch = 0.78; this.camDist = isMobile ? 14 : 13;
    this.sendT = 0; this.lastSent = { x: 0, z: 0, ry: 0 };
    this.pathTo = null;
    this.zone = 'town';
    this.dead = false;
    this.shake = 0;
    this.pingAt = 0;
    this.started = false;
    this.world = null;
    this.ui = null;
    this.fps = { n: 0, t: 0, v: 0 };
    this.autoSkillAt = 0;
    this.nearNpc = null;
    this.ignore = new Map();
    this.stuckT = 0;
  }

  // ---------------- 로그인 ----------------
  async initLogin() {
    const classList = $('class-list');
    let cls = 'warrior', color = COLORS[0];
    classList.innerHTML = Object.entries(CLASSES).map(([id, c]) =>
      `<button class="cls-card ${id === cls ? 'on' : ''}" data-cls="${id}"><div class="ic">${c.icon}</div><b>${c.name}</b><small>${c.desc}</small></button>`).join('');
    classList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cls]');
      if (!b) return;
      cls = b.dataset.cls;
      classList.querySelectorAll('.cls-card').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('color-list').innerHTML = COLORS.map((c, i) => `<button class="color-sw ${i === 0 ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
    $('color-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      color = b.dataset.c;
      $('color-list').querySelectorAll('.color-sw').forEach((x) => x.classList.toggle('on', x === b));
    });

    const modeInputs = [...document.querySelectorAll('input[name=mode]')];
    const lastMode = localStorage.getItem('eldermoon_mode');
    if (lastMode) modeInputs.forEach((i) => { i.checked = i.value === lastMode; });
    const getMode = () => modeInputs.find((i) => i.checked).value;
    const refreshContinue = () => {
      const mode = getMode();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(charKey(mode)) || 'null'); } catch { saved = null; }
      const tok = localStorage.getItem(tokenKey(mode));
      if (saved && tok) {
        $('continue-box').classList.remove('hidden');
        $('create-box').classList.add('hidden');
        $('btn-continue').textContent = `▶ ${saved.name} (Lv.${saved.level} ${CLASSES[saved.cls]?.name || ''}) 이어하기`;
      } else {
        $('continue-box').classList.add('hidden');
        $('create-box').classList.remove('hidden');
      }
    };
    modeInputs.forEach((i) => i.addEventListener('change', refreshContinue));

    const status = await checkServer();
    const st = $('server-status');
    if (status) {
      st.className = 'status on';
      st.textContent = `🟢 서버 온라인 · 접속자 ${status.players}명 · AI 모험가 ${status.bots}명`;
    } else {
      st.className = 'status off';
      st.textContent = '🟠 서버에 연결할 수 없어 오프라인 모드로 플레이합니다';
      modeInputs.find((i) => i.value === 'offline').checked = true;
      modeInputs.find((i) => i.value === 'online').disabled = true;
    }
    refreshContinue();

    $('btn-new').addEventListener('click', () => {
      $('continue-box').classList.add('hidden');
      $('create-box').classList.remove('hidden');
    });
    $('btn-continue').addEventListener('click', () => {
      const mode = getMode();
      this.start(mode, { t: 'join', token: localStorage.getItem(tokenKey(mode)) });
    });
    $('btn-start').addEventListener('click', () => {
      const name = $('in-name').value.trim();
      if (name.length < 2 || name.length > 12) { $('login-err').textContent = '이름은 2~12자로 입력해 주세요.'; return; }
      this.start(getMode(), { t: 'join', name, cls, color });
    });
    $('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-start').click(); });
  }

  async start(mode, join) {
    if (this.starting) return;
    this.starting = true;
    $('login-err').textContent = '';
    $('loading').classList.remove('hidden');
    $('loading-t').textContent = mode === 'online' ? '서버에 접속하는 중...' : '오프라인 월드를 만드는 중...';
    await new Promise((r) => setTimeout(r, 30));
    try {
      this.net = await connect(mode);
    } catch (e) {
      $('loading').classList.add('hidden');
      $('login-err').textContent = (e && e.message) || '접속 실패';
      this.starting = false;
      return;
    }
    this.mode = mode;
    localStorage.setItem('eldermoon_mode', mode);
    if (!this.world) {
      $('loading-t').textContent = '3D 월드를 불러오는 중...';
      await new Promise((r) => setTimeout(r, 30));
      this.buildWorld();
    }
    this.net.onMessage((m) => this.onMessage(m));
    this.net.onClose(() => this.onDisconnect());
    this.pendingJoin = join;
    this.net.send(join);
    if (isMobile) this.tryFullscreen();
  }

  buildWorld() {
    const canvas = $('game');
    this.world = createWorld(canvas, this.settings.quality);
    this.ents = new EntityManager(this.world.scene);
    this.fx = new FX(this.world.scene, this.world.camera, $('labels'));
    this.input = new Input(canvas, $('joy-zone'), $('joy-base'), $('joy-knob'));
    this.input.onKey = (code, e) => this.onKey(code, e);
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.world.resize());
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const t = performance.now();
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      this.frame(dt, t / 1000);
    };
    // 로그인 화면 배경용 카메라 연출
    this.world.camera.position.set(30, 14, 40);
    this.world.camera.lookAt(0, 3, 0);
    requestAnimationFrame(loop);
  }

  // ---------------- 네트워크 메시지 ----------------
  onMessage(m) {
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 'err':
        $('loading').classList.add('hidden');
        $('login-err').textContent = m.m;
        this.net.close();
        this.net = null;
        this.starting = false;
        if (this.pendingJoin?.token) {
          localStorage.removeItem(tokenKey(this.mode));
          localStorage.removeItem(charKey(this.mode));
          $('continue-box').classList.add('hidden');
          $('create-box').classList.remove('hidden');
        }
        return;
      case 's': return this.onSnapshot(m);
      case 'pos':
        this.x = m.x; this.z = m.z;
        this.ents.setLocal(this.myId, this.x, this.z, this.ry);
        return;
      case 'cd':
        this.cds[m.k] = now() + m.d;
        this.cdDur[m.k] = m.d;
        return;
      case 'msg': return this.onSysMsg(m);
      case 'chat': return this.ui.log('chat', m.m, m.from, !!m.bot);
      case 'kick':
        alert(m.m);
        location.reload();
        return;
      case 'pong':
        this.ui.setPing(Math.round(performance.now() - m.c), this.mode);
        return;
    }
  }

  onWelcome(m) {
    this.myId = m.id;
    this.ents.myId = m.id;
    this.me = m.me;
    this.x = m.x; this.z = m.z;
    this.hp = m.me.hp; this.mp = m.me.mp;
    this.dead = !!m.me.dead;
    this.camYaw = 0;
    localStorage.setItem(tokenKey(this.mode), m.token);
    this.saveCharSummary();
    $('login').classList.add('hidden');
    $('loading').classList.add('hidden');
    this.ui.showGame(this.me);
    this.ui.updateMe(this.me);
    this.ents.setMyLevel(this.me.level);
    this.started = true;
    this.ui.setPing(0, this.mode);
    if (this.mode === 'offline') this.ui.log('sys', '오프라인 모드: 진행 상황은 이 기기에 저장됩니다.');
    if (this.me.dead) this.ui.showDeath('');
  }

  saveCharSummary() {
    if (!this.me) return;
    localStorage.setItem(charKey(this.mode), JSON.stringify({ name: this.me.name, cls: this.me.cls, level: this.me.level }));
  }

  onSnapshot(s) {
    if (s.I) for (const info of s.I) this.ents.setInfo(info);
    this.ents.applySnapshot(s);
    if (s.S) { this.hp = s.S[0]; this.mp = s.S[1]; }
    if (s.me) this.onMe(s.me);
    if (s.E) for (const e of s.E) this.onEvent(e);
  }

  onMe(me) {
    const prevLevel = this.me?.level;
    const wasDead = this.me?.dead;
    this.me = me;
    this.hp = me.hp; this.mp = me.mp;
    this.ui.updateMe(me);
    this.ents.setMyLevel(me.level);
    if (prevLevel && me.level > prevLevel) this.saveCharSummary();
    if (me.dead && !wasDead) this.onDeath();
    if (!me.dead && wasDead) { this.dead = false; this.ui.hideDeath(); }
    const q = me.quest;
    this.ents.setQuestMark(q.active ? (q.done ? 'done' : 'none') : (me.level >= q.minLevel ? 'new' : 'none'));
  }

  onDeath() {
    this.dead = true;
    this.engaged = false;
    this.targetId = 0;
    this.ui.showDeath(this.deathMsg || '');
    this.ui.setEngaged(false);
  }

  onSysMsg(m) {
    const kind = m.k;
    this.ui.log(kind, m.m);
    if (kind === 'lvl') this.ui.toast('🎉 ' + m.m, true);
    else if (kind === 'quest') this.ui.toast(m.m);
    else if (kind === 'boss') this.ui.toast(m.m);
    else if (kind === 'warn') this.ui.toast(m.m);
    else if (kind === 'death') this.deathMsg = m.m;
  }

  onDisconnect() {
    if (!this.started) return;
    this.started = false;
    this.ui.toast('서버와의 연결이 끊어졌습니다.', true);
    setTimeout(() => location.reload(), 2500);
  }

  send(m) { this.net?.send(m); }

  // ---------------- 이벤트 시각화 ----------------
  epos(id, yOff = 1.2) {
    if (id === this.myId) return new THREE.Vector3(this.x, heightAt(this.x, this.z) + yOff, this.z);
    const p = this.ents.pos(id);
    if (!p) return null;
    p.y += yOff * (this.ents.height(id) / 2.3);
    return p;
  }

  onEvent(e) {
    const type = e[0];
    const fx = this.fx;
    if (type === 'hit') {
      const [, src, dst, dmg, crit, kind] = e;
      if (src !== this.myId || !kind.startsWith('atk_')) this.ents.playAttack(src);
      const showNum = src === this.myId || dst === this.myId;
      const impact = () => {
        this.ents.flash(dst);
        const p = this.epos(dst, 1.4);
        if (!p) return;
        if (showNum) fx.number(p, (crit ? '💥' : '') + dmg, dst === this.myId ? 'taken' : crit ? 'crit' : 'mine');
        const c = kind === 'fireball' || kind === 'm_fire' ? '#ff7a1a' : kind === 'frost_nova' ? '#9fe6ff' : kind === 'slam' ? '#c8a27a' : '#fff3c4';
        fx.burst(p, c, crit ? 14 : 7, crit ? 6 : 4, 0.45, 0.4);
        if (dst === this.myId) this.shake = Math.max(this.shake, kind === 'slam' ? 0.5 : 0.15);
      };
      const rk = RANGED_KIND[kind];
      const from = this.epos(src, 1.5);
      if (rk && from) {
        fx.projectile(from, () => this.epos(dst, 1.2), rk, impact);
      } else {
        fx.later(kind.startsWith('atk_') || kind === 'power_strike' || kind === 'm_atk' ? 0.16 : 0.05, impact);
      }
    } else if (type === 'cast') {
      const [, src, sid, dst] = e;
      this.ents.playCast(src);
      const p = this.epos(src, 0);
      if (!p) return;
      const S = SKILLS[sid];
      if (sid === 'whirlwind') {
        fx.ring(p, '#dbe7ff', S.radius, 0.45, { y: 1, from: 0.6, spin: 12 });
        fx.ring(p, '#9fb8ff', S.radius, 0.6, { y: 0.4, from: 0.3 });
      } else if (sid === 'frost_nova') {
        fx.ring(p, '#9fe6ff', S.radius, 0.7, { from: 0.1 });
        fx.burst(p.clone().setY(p.y + 0.5), '#bff3ff', 26, 9, 0.6, 0.6, -2);
      } else if (sid === 'war_cry') {
        fx.ring(p, '#ff8a50', 5, 0.6, { from: 0.1 });
        fx.rise(p, '#ffab40', 18, 1.2, 0.5);
      } else if (sid === 'heal') {
        fx.ring(p, '#7dff9a', S.radius, 0.8, { from: 0.1 });
      } else if (sid === 'swift_wind') {
        fx.rise(p, '#8ff7ff', 20, 1.0, 0.45, 0.8);
        fx.ring(p, '#8ff7ff', 2.5, 0.5, { y: 0.3, spin: 8, follow: () => this.epos(src, 0) });
      } else if (sid === 'arrow_rain' && dst) {
        const tp = this.epos(dst, 0);
        if (tp) {
          fx.ring(tp, '#ffe082', S.radius, 1.0, { from: 0.9 });
          for (let i = 0; i < 16; i++) {
            fx.later(i * 0.04, () => {
              const a = Math.random() * Math.PI * 2, r = Math.random() * S.radius;
              const from = new THREE.Vector3(tp.x + Math.cos(a) * r, tp.y + 12, tp.z + Math.sin(a) * r);
              const to = new THREE.Vector3(from.x, tp.y, from.z);
              fx.projectile(from, () => to, 'arrow', () => fx.burst(to, '#fff3c4', 3, 2, 0.3, 0.3));
            });
          }
        }
      } else if (sid === 'power_strike') {
        const tp = this.epos(dst, 1);
        if (tp) fx.later(0.15, () => fx.burst(tp, '#ffb74d', 18, 7, 0.6, 0.5));
      } else if (sid === 'fireball') {
        fx.burst(p.clone().setY(p.y + 1.8), '#ff9100', 8, 2, 0.4, 0.4, 0);
      }
    } else if (type === 'heal') {
      const [, id, amt] = e;
      const p = this.epos(id, 0);
      if (!p) return;
      fx.rise(p, '#7dff9a', 10, 0.8, 0.4, 0.9);
      if (id === this.myId) fx.number(p.clone().setY(p.y + 2), '+' + amt, 'heal');
    } else if (type === 'mana') {
      const p = this.epos(e[1], 0);
      if (p) fx.rise(p, '#64b5ff', 10, 0.8, 0.4, 0.9);
    } else if (type === 'die') {
      const id = e[1];
      const p = this.epos(id, 0.8);
      if (p) fx.burst(p, id === this.myId ? '#ff5252' : '#d0c8ff', 16, 5, 0.6, 0.8);
      if (id === this.targetId && !this.auto) { this.targetId = 0; this.engaged = false; }
      if (id === this.targetId && this.auto) this.targetId = 0;
    } else if (type === 'lvl') {
      const p = this.epos(e[1], 0);
      if (!p) return;
      fx.ring(p, '#ffd54f', 3, 1.2, { from: 0.2 });
      fx.rise(p, '#ffe082', 40, 1.2, 0.6, 1.6);
    } else if (type === 'slam') {
      const p = this.epos(e[1], 0);
      if (!p) return;
      fx.ring(p, '#ffb27a', 8, 0.7, { from: 0.1 });
      fx.burst(p.clone().setY(p.y + 0.3), '#a1887f', 30, 9, 0.8, 0.7);
      if (p.distanceTo(new THREE.Vector3(this.x, p.y, this.z)) < 18) this.shake = 0.6;
    } else if (type === 'resp' || type === 'spawn') {
      const p = this.epos(e[1], 0);
      if (p) fx.rise(p, type === 'resp' ? '#ffffff' : '#c7a6ff', 12, 0.8, 0.4, 0.8);
    } else if (type === 'quest') {
      const p = this.epos(e[1], 0);
      if (p) fx.rise(p, '#ffd54f', 30, 1, 0.5, 1.4);
    }
  }

  // ---------------- 조작 ----------------
  onKey(code, e) {
    if (!this.started) return;
    if (code === 'Enter') { e.preventDefault(); this.ui.openChat(); return; }
    if (code === 'Escape') { this.ui.closePanel(); return; }
    if (this.ui.panel) return;
    if (code === 'Space') { e.preventDefault(); this.attackPressed(); }
    else if (code === 'Digit1') this.castSkill(0);
    else if (code === 'Digit2') this.castSkill(1);
    else if (code === 'Digit3') this.castSkill(2);
    else if (code === 'KeyQ') this.usePotion('hp');
    else if (code === 'KeyE') this.usePotion('mp');
    else if (code === 'Tab') { e.preventDefault(); this.cycleTarget(); }
    else if (code === 'KeyF') this.interact();
    else if (code === 'KeyR') this.toggleAuto();
    else if (code === 'KeyI') this.ui.openPanel('inventory');
    else if (code === 'KeyM') this.ui.openPanel('map');
    else if (code === 'KeyC') this.ui.openPanel('character');
  }

  monsterView(id) {
    const v = this.ents.views.get(id);
    return v && v.kind === 'monster' && !v.dead ? v : null;
  }

  findNearestMonster(maxDist = 30, preferLevel = true) {
    let best = null, bestD = maxDist;
    for (const v of this.ents.views.values()) {
      if (v.kind !== 'monster' || v.dead) continue;
      if (inTown(v.x, v.z, 1)) continue;
      if ((this.ignore.get(v.id) || 0) > now()) continue;
      const M = MONSTERS[v.info.type];
      let d = Math.hypot(v.x - this.x, v.z - this.z);
      if (preferLevel && M.level > this.me.level + 4) d += 25;
      if (M.boss && this.me.level < 18) d += 40;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // 자동 사냥: 레벨에 맞는 사냥터 위치
  huntSpot() {
    if (!this.spawns) this.spawns = generateSpawns();
    let type = 'slime';
    for (const t of ['slime', 'wolf', 'goblin', 'skeleton', 'imp']) if (MONSTERS[t].level <= this.me.level + 1) type = t;
    let best = null, bd = Infinity;
    for (const sp of this.spawns) {
      if (sp.type !== type) continue;
      const d = Math.hypot(sp.x - this.x, sp.z - this.z);
      if (d < bd) { bd = d; best = sp; }
    }
    return best;
  }

  attackPressed() {
    if (this.dead || !this.me) return;
    let t = this.monsterView(this.targetId);
    if (!t) {
      t = this.findNearestMonster(32);
      if (!t) { this.ui.toast('주변에 공격할 대상이 없습니다.'); return; }
      this.targetId = t.id;
    }
    this.engaged = true;
    this.pathTo = null;
  }

  cycleTarget() {
    if (!this.me) return;
    const list = [...this.ents.views.values()]
      .filter((v) => v.kind === 'monster' && !v.dead && Math.hypot(v.x - this.x, v.z - this.z) < 35)
      .sort((a, b) => Math.hypot(a.x - this.x, a.z - this.z) - Math.hypot(b.x - this.x, b.z - this.z));
    if (!list.length) return;
    const i = list.findIndex((v) => v.id === this.targetId);
    this.targetId = list[(i + 1) % list.length].id;
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.ui.setAuto(this.auto);
    this.ui.toast(this.auto ? '⚡ 자동 사냥 시작' : '자동 사냥 종료');
    if (!this.auto) { this.engaged = false; if (this.pathTo?.auto) this.pathTo = null; }
  }

  castSkill(i, quiet = false) {
    if (this.dead || !this.me) return false;
    const sid = CLASSES[this.me.cls].skills[i];
    const S = SKILLS[sid];
    if ((this.cds[sid] || 0) > now()) { if (!quiet) this.ui.toast(`${S.name} 재사용 대기 중`); return false; }
    if (this.mp < S.mp) { if (!quiet) this.ui.toast('마나가 부족합니다.'); return false; }
    let id = 0;
    if (S.type === 'target' || S.type === 'aoe_target') {
      let t = this.monsterView(this.targetId);
      if (!t) {
        t = this.findNearestMonster(S.range + 4);
        if (t) this.targetId = t.id;
      }
      if (!t) { if (!quiet) this.ui.toast('대상이 없습니다.'); return false; }
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d > S.range + 0.8) {
        if (!quiet) { this.engaged = true; this.ui.toast('대상이 너무 멉니다.'); }
        return false;
      }
      id = t.id;
      this.ry = Math.atan2(t.x - this.x, t.z - this.z);
    }
    this.cds[sid] = now() + 0.4; // 서버 응답 전 중복 입력 방지
    this.cdDur[sid] = S.cd;
    this.send({ t: 'sk', s: sid, id });
    return true;
  }

  usePotion(kind) {
    if (this.dead || !this.me) return false;
    const inv = this.me.inv;
    let item;
    if (kind === 'hp') {
      const missing = this.me.maxHp - this.hp;
      item = inv.big_hp_potion > 0 && (missing > this.me.maxHp * 0.6 || !(inv.hp_potion > 0)) ? 'big_hp_potion' : inv.hp_potion > 0 ? 'hp_potion' : null;
    } else item = inv.mp_potion > 0 ? 'mp_potion' : null;
    if (!item) { this.ui.toast(kind === 'hp' ? '체력 물약이 없습니다. 상점에서 구매하세요.' : '마나 물약이 없습니다.'); return false; }
    if ((this.cds.potion || 0) > now()) return false;
    this.cds.potion = now() + 0.5;
    this.send({ t: 'use', item });
    return true;
  }

  interact() {
    const npc = this.nearNpc;
    if (!npc) return;
    this.openNpc(npc);
  }

  openNpc(npc) {
    this.pathTo = null;
    if (npc.role === 'quest') this.ui.openPanel('elder');
    else if (npc.role === 'shop') { this.ui.shopTab = 'buy'; this.ui.openPanel('shop'); }
    else this.ui.openPanel('priest');
  }

  handleTap(tap) {
    const cam = this.world.camera;
    const v3 = new THREE.Vector3();
    let best = null, bestD = isMobile ? 70 : 50;
    for (const v of this.ents.views.values()) {
      if (v.dead || v.id === this.myId) continue;
      v3.set(v.x, heightAt(v.x, v.z) + v.model.height * 0.5, v.z).project(cam);
      if (v3.z > 1) continue;
      const sx = (v3.x * 0.5 + 0.5) * window.innerWidth, sy = (-v3.y * 0.5 + 0.5) * window.innerHeight;
      const d = Math.hypot(sx - tap.x, sy - tap.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return;
    if (best.kind === 'npc') {
      const npc = NPCS.find((n) => n.id === best.id);
      this.targetId = best.id;
      if (Math.hypot(npc.x - this.x, npc.z - this.z) < 5) this.openNpc(npc);
      else { this.pathTo = { x: npc.x, z: npc.z, npc }; this.engaged = false; }
    } else if (best.kind === 'monster') {
      if (this.targetId === best.id) this.engaged = true;
      this.targetId = best.id;
      this.engaged = true;
      this.pathTo = null;
    } else {
      this.targetId = best.id;
    }
  }

  mapState() {
    const ents = [];
    for (const v of this.ents.views.values()) {
      if (v.id === this.myId || v.dead) continue;
      if (v.kind === 'player') ents.push({ kind: 'player', x: v.x, z: v.z, c: v.info.bot ? '#7fd3ff' : '#5a8bff' });
    }
    return { x: this.x, z: this.z, ents };
  }

  changeSetting(k, v) {
    if (k === 'quality') { this.settings.quality = v; this.world.setQuality(v); }
    if (k === 'fps') this.settings.fps = v;
    if (k === 'sens') this.settings.sens = Number(v);
    localStorage.setItem('eldermoon_settings', JSON.stringify(this.settings));
  }

  tryFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        screen.orientation?.lock?.('landscape').catch(() => {});
      }).catch(() => {});
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else this.tryFullscreen();
  }

  logout() {
    this.net?.close();
    location.reload();
  }

  // ---------------- 매 프레임 ----------------
  frame(dt, t) {
    const world = this.world;
    if (!this.started) {
      // 타이틀 화면: 마을 주위를 천천히 회전
      const a = t * 0.05;
      world.camera.position.set(Math.sin(a) * 42, 16, Math.cos(a) * 42);
      world.camera.lookAt(0, 3, 0);
      this.ents.update(dt, t, world.camera);
      world.update(dt, t, new THREE.Vector3(0, 0, 0), 'town');
      world.renderer.render(world.scene, world.camera);
      return;
    }
    const tnow = now();
    const me = this.me;
    const input = this.input;
    if (this.ui.panel || this.ui.isTyping()) input.keys.clear();

    // 카메라 입력
    const c = input.consumeCam();
    const sens = this.settings.sens || 1;
    this.camYaw -= c.dx * 0.0065 * sens;
    this.camPitch = Math.max(0.12, Math.min(1.25, this.camPitch + c.dy * 0.0045 * sens));
    this.camDist = Math.max(5, Math.min(24, this.camDist + c.zoom));
    for (const tap of input.consumeTaps()) this.handleTap(tap);

    // 이동
    let mx = 0, mz = 0, manual = false;
    const speed = me.speed;
    if (!this.dead) {
      const mv = input.moveVector();
      if (mv.x || mv.y) {
        manual = true;
        const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
        const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
        mx = fx * mv.y + rx * mv.x;
        mz = fz * mv.y + rz * mv.x;
        this.pathTo = null;
        if (this.engaged && !this.auto) this.engaged = false;
      }
    }

    let target = this.monsterView(this.targetId);
    if (this.auto && !this.dead && !manual) {
      if (!target) {
        target = this.findNearestMonster(40) || this.findNearestMonster(85);
        if (target) { this.targetId = target.id; this.pathTo = null; }
      }
      this.engaged = !!target;
      if (!target && !this.pathTo) {
        const sp = this.huntSpot();
        if (sp && Math.hypot(sp.x - this.x, sp.z - this.z) > 6) this.pathTo = { x: sp.x, z: sp.z, auto: true };
      }
      // 자동 물약
      if (this.hp < me.maxHp * 0.4) this.usePotion('hp');
      else if (this.mp < me.maxMp * 0.15 && me.inv.mp_potion > 0) this.usePotion('mp');
    }
    if (target && this.engaged && !manual && !this.dead) {
      const dx = target.x - this.x, dz = target.z - this.z;
      const d = Math.hypot(dx, dz);
      const reach = me.range + (MONSTERS[target.info.type].size - 1) * 0.6;
      if (d > reach - 0.4) {
        mx = dx / d; mz = dz / d;
      } else {
        this.ry = Math.atan2(dx, dz);
        if (tnow >= this.atkReadyAt) {
          this.atkReadyAt = tnow + me.atkCd;
          this.send({ t: 'atk', id: target.id });
          this.ents.playAttack(this.myId);
        }
        if (this.auto && tnow > this.autoSkillAt) {
          this.autoSkillAt = tnow + 0.6;
          const skills = CLASSES[me.cls].skills;
          for (let i = 0; i < 3; i++) {
            const S = SKILLS[skills[i]];
            if ((this.cds[skills[i]] || 0) > tnow || this.mp < S.mp) continue;
            if (S.type === 'heal' && this.hp > me.maxHp * 0.65) continue;
            if (S.type === 'aoe_self' && d > S.radius) continue;
            if (S.type === 'buff' && skills[i] === 'war_cry' && this.hp > me.maxHp * 0.85 && MONSTERS[target.info.type].hp < 300) continue;
            if (this.castSkill(i, true)) break;
          }
        }
      }
    } else if (this.pathTo && !this.dead) {
      const dx = this.pathTo.x - this.x, dz = this.pathTo.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < (this.pathTo.npc ? 3.2 : 1.5)) {
        const { npc, then } = this.pathTo;
        this.pathTo = then || null;
        if (npc) this.openNpc(npc);
      } else { mx = dx / d; mz = dz / d; }
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 0.01 && !this.dead) {
      const step = speed * dt * Math.min(1, ml);
      const ox = this.x, oz = this.z;
      let nx = this.x + (mx / ml) * step, nz = this.z + (mz / ml) * step;
      ({ x: nx, z: nz } = resolveCollision(nx, nz, 0.45));
      if (isWalkable(nx, nz)) { this.x = nx; this.z = nz; }
      else if (isWalkable(nx, this.z)) this.x = nx;
      else if (isWalkable(this.x, nz)) this.z = nz;
      this.ry = Math.atan2(mx, mz);
      // 막힘 감지 (자동 이동 중 장애물/물가에 걸린 경우 우회)
      if (!manual && Math.hypot(this.x - ox, this.z - oz) < step * 0.25) this.stuckT += dt;
      else this.stuckT = 0;
      if (this.stuckT > 1.0) {
        this.stuckT = 0;
        if (this.engaged && this.targetId) {
          this.ignore.set(this.targetId, tnow + 12);
          this.targetId = 0;
          if (!this.auto) this.engaged = false;
        }
        const a = Math.atan2(mx, mz) + (Math.random() < 0.5 ? 1.4 : -1.4);
        const back = this.pathTo;
        this.pathTo = { x: this.x + Math.sin(a) * 7, z: this.z + Math.cos(a) * 7, auto: true, then: back && !back.auto ? back : null };
      }
    }

    // 서버로 위치 전송 (10Hz)
    this.sendT += dt;
    if (this.sendT >= 0.1) {
      this.sendT = 0;
      const ls = this.lastSent;
      if (Math.abs(ls.x - this.x) > 0.01 || Math.abs(ls.z - this.z) > 0.01 || Math.abs(ls.ry - this.ry) > 0.05) {
        this.send({ t: 'move', x: Math.round(this.x * 100) / 100, z: Math.round(this.z * 100) / 100, ry: Math.round(this.ry * 100) / 100 });
        ls.x = this.x; ls.z = this.z; ls.ry = this.ry;
      }
    }
    if (this.mode === 'online' && tnow - this.pingAt > 3) {
      this.pingAt = tnow;
      this.send({ t: 'ping', c: performance.now() });
    }

    // 엔티티
    this.ents.targetId = this.targetId;
    this.ents.setLocal(this.myId, this.x, this.z, this.ry);
    this.fx.update(dt);

    // 카메라
    const py = heightAt(this.x, this.z);
    const focus = new THREE.Vector3(this.x, py + 1.7, this.z);
    const cp = Math.cos(this.camPitch);
    const camPos = new THREE.Vector3(
      focus.x + Math.sin(this.camYaw) * cp * this.camDist,
      focus.y + Math.sin(this.camPitch) * this.camDist,
      focus.z + Math.cos(this.camYaw) * cp * this.camDist,
    );
    const ground = heightAt(camPos.x, camPos.z) + 1.0;
    if (camPos.y < ground) camPos.y = ground;
    const cam = world.camera;
    if (!this.camInit) { cam.position.copy(camPos); this.camInit = true; }
    cam.position.lerp(camPos, 1 - Math.exp(-dt * 12));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(focus);
    this.ents.update(dt, t, cam);

    // 지역
    const zone = zoneAt(this.x, this.z);
    if (zone !== this.zone) { this.zone = zone; }
    this.ui.zoneBanner(zone);
    world.update(dt, t, new THREE.Vector3(this.x, py, this.z), zone);
    world.renderer.render(world.scene, cam);

    // UI (10Hz)
    this.uiT = (this.uiT || 0) + dt;
    if (this.uiT > 0.1) {
      this.uiT = 0;
      this.ui.updateVitals(this.hp, this.mp, me.maxHp, me.maxMp);
      this.ui.updateCooldowns(tnow, this.cds, this.cdDur, { ...me, mp: this.mp }, this.atkReadyAt);
      const tv = this.ents.views.get(this.targetId);
      this.ui.updateTarget(tv, me.level);
      this.ui.setEngaged(this.engaged);
      let near = null;
      for (const n of NPCS) if (Math.hypot(n.x - this.x, n.z - this.z) < 5) near = n;
      this.nearNpc = near;
      this.ui.setInteract(near);
      this.ui.tickDeath(performance.now());
      const ents = [];
      for (const v of this.ents.views.values()) {
        if (v.id === this.myId || v.dead) continue;
        if (v.kind === 'monster') {
          const boss = MONSTERS[v.info.type].boss;
          ents.push({ x: v.x, z: v.z, c: boss ? '#ff7043' : '#ff4d4d', r: boss ? 7 : 3.5, ring: v.id === this.targetId });
        } else if (v.kind === 'npc') ents.push({ x: v.x, z: v.z, c: '#ffd54f', r: 4.5 });
        else ents.push({ x: v.x, z: v.z, c: v.info.bot ? '#7fd3ff' : '#5a8bff', r: 4, ring: v.id === this.targetId });
      }
      ents.push({ x: WORLD.boss.x, z: WORLD.boss.z, c: 'rgba(255,112,67,0.5)', r: 9 });
      this.ui.drawMinimap(this.x, this.z, this.ry, ents, this.camYaw);
      this.ui.fadeLog(performance.now());
      if (this.ui.panel === 'map') this.ui.drawWorldMap();
    }
    // FPS
    this.fps.n++; this.fps.t += dt;
    if (this.fps.t >= 1) {
      this.fps.v = Math.round(this.fps.n / this.fps.t);
      this.fps.n = 0; this.fps.t = 0;
      if (this.settings.fps) $('mm-zone').textContent = `${this.fps.v} FPS`;
      else $('mm-zone').textContent = this.ui.zoneShown ? (document.getElementById('zb-name').textContent) : '';
    }
  }
}

const game = new Game();
window.__game = game;
game.initLogin().then(() => {
  // 로그인 화면 뒤에 3D 월드를 미리 그려 배경으로 사용
  requestAnimationFrame(() => { if (!game.world) game.buildWorld(); });
});
