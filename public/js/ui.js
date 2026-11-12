// HUD, 패널, 미니맵, 채팅 등 DOM UI
import { CLASSES, SKILLS, ITEMS, MONSTERS, NPCS, ZONES, WORLD, SHOP_LIST, resolveItemId, TIER_COLORS } from '../shared/data.js';
import { heightAt, zoneAt, isRoad } from '../shared/terrain.js';
import { ZONE_GROUND } from './scene.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function itemStats(it) {
  const parts = [];
  if (it.atk) parts.push(`공격력 +${it.atk}`);
  if (it.def) parts.push(`방어력 +${it.def}`);
  if (it.type === 'armor' && it.hp) parts.push(`최대 체력 +${it.hp}`);
  if (it.type === 'consumable') {
    if (it.hp) parts.push(it.hp >= 1 ? '체력 전부 회복' : `체력 ${Math.round(it.hp * 100)}% 회복`);
    if (it.mp) parts.push(`마나 ${Math.round(it.mp * 100)}% 회복`);
  }
  if (it.level > 1) parts.push(`요구 레벨 ${it.level}`);
  if (it.cls) parts.push(`${CLASSES[it.cls].name} 전용`);
  return parts.join(' · ');
}

function itemColor(it) {
  return it.tier !== undefined ? TIER_COLORS[it.tier] : '#c7cfe8';
}

export function renderWorldImage(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const cache = {};
  const rgb = (hex) => cache[hex] || (cache[hex] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i / size) * WORLD.size - WORLD.half, z = (j / size) * WORLD.size - WORLD.half;
      const h = heightAt(x, z);
      const r = Math.hypot(x, z);
      let col = rgb(ZONE_GROUND[zoneAt(x, z)]);
      let shade = 0.85 + Math.max(-0.25, Math.min(0.3, h * 0.03));
      if (h < WORLD.waterLevel) col = [47, 134, 201], shade = 1;
      else if (r < 11.5) col = [185, 179, 166];
      else if (isRoad(x, z)) col = [166, 138, 95];
      if (r > WORLD.playRadius) shade *= 0.55;
      const o = (j * size + i) * 4;
      img.data[o] = col[0] * shade; img.data[o + 1] = col[1] * shade; img.data[o + 2] = col[2] * shade; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.panel = null;
    this.panelOpts = {};
    this.sel = null;
    this.shopTab = 'buy';
    this.zoneShown = null;
    this.worldImg = null;
    this.mm = $('minimap').getContext('2d');
    this.lastLog = 0;
    this.bindButtons();
  }

  bindButtons() {
    const g = this.game;
    const press = (id, fn) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('pressed'); fn(); });
      const up = () => el.classList.remove('pressed');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    };
    press('btn-attack', () => g.attackPressed());
    press('btn-s0', () => g.castSkill(0));
    press('btn-s1', () => g.castSkill(1));
    press('btn-s2', () => g.castSkill(2));
    press('btn-hp', () => g.usePotion('hp'));
    press('btn-mp', () => g.usePotion('mp'));
    press('btn-auto', () => g.toggleAuto());
    press('btn-target', () => g.cycleTarget());
    press('btn-interact', () => g.interact());
    document.querySelectorAll('#menu-btns button').forEach((b) => b.addEventListener('click', () => this.openPanel(b.dataset.panel)));
    $('panel-close').addEventListener('click', () => this.closePanel());
    $('panel').addEventListener('pointerdown', (e) => { if (e.target.id === 'panel') this.closePanel(); });
    $('chat-btn').addEventListener('click', () => this.openChat());
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('chat-input').value.trim();
      if (v) g.send({ t: 'chat', m: v });
      $('chat-input').value = '';
      this.closeChat();
    });
    $('chat-input').addEventListener('blur', () => setTimeout(() => this.closeChat(), 150));
    $('btn-respawn').addEventListener('click', () => g.send({ t: 'respawn' }));
    $('minimap').addEventListener('click', () => this.openPanel('map'));
    $('panel-body').addEventListener('click', (e) => this.onPanelClick(e));
    $('panel-body').addEventListener('change', (e) => this.onPanelChange(e));
  }

  openChat() {
    $('chat-form').classList.remove('hidden');
    $('chat-input').focus();
  }

  closeChat() {
    $('chat-form').classList.add('hidden');
    $('chat-input').blur();
  }

  isTyping() { return document.activeElement === $('chat-input'); }

  showGame(me) {
    $('hud').classList.remove('hidden');
    document.body.classList.add('ingame');
    const skills = CLASSES[me.cls].skills;
    skills.forEach((sid, i) => {
      const b = $('btn-s' + i);
      b.querySelector('span').textContent = SKILLS[sid].icon;
      b.title = SKILLS[sid].name;
    });
    $('pf-icon').textContent = CLASSES[me.cls].icon;
    $('pf-name').textContent = me.name;
    if (!this.worldImg) this.worldImg = renderWorldImage(256);
  }

  updateMe(me) {
    $('pf-level').textContent = me.level;
    $('hp-count').textContent = (me.inv.hp_potion || 0) + (me.inv.big_hp_potion || 0);
    $('mp-count').textContent = me.inv.mp_potion || 0;
    const ratio = me.level >= 30 ? 1 : me.xp / me.xpNext;
    $('xp-fill').style.transform = `scaleX(${ratio})`;
    $('xp-t').textContent = me.level >= 30 ? 'MAX' : `Lv.${me.level}  ${me.xp.toLocaleString()} / ${me.xpNext.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`;
    $('buffs').innerHTML = me.buffs.map((b) => `<span class="buff">${SKILLS[b.k]?.icon || '✨'} ${Math.ceil(b.t)}s</span>`).join('');
    const q = me.quest;
    const qt = $('quest-tracker');
    if (q.active) {
      qt.classList.remove('hidden');
      qt.innerHTML = `<b>📜 ${esc(q.name)}</b>${esc(MONSTERS[q.target].name)} <span class="${q.done ? 'done' : ''}">${q.progress}/${q.count}</span>${q.done ? '<div class="done">✔ 촌장에게 보고하세요</div>' : ''}`;
    } else {
      qt.classList.remove('hidden');
      qt.innerHTML = me.level >= q.minLevel ? `<b>📜 새 퀘스트</b>촌장 엘다를 찾아가세요` : `<b>📜 다음 퀘스트</b>Lv.${q.minLevel} 필요`;
    }
    if (this.panel) this.refreshPanel();
  }

  updateVitals(hp, mp, maxHp, maxMp) {
    $('pf-hp').style.transform = `scaleX(${Math.max(0, hp / maxHp)})`;
    $('pf-mp').style.transform = `scaleX(${Math.max(0, mp / maxMp)})`;
    $('pf-hp-t').textContent = `${hp} / ${maxHp}`;
    $('pf-mp-t').textContent = `${mp} / ${maxMp}`;
  }

  updateTarget(v, myLevel) {
    const f = $('target-frame');
    if (!v || v.dead) { f.classList.add('hidden'); return; }
    f.classList.remove('hidden');
    let name;
    if (v.kind === 'monster') {
      const M = MONSTERS[v.info.type];
      name = `${M.boss ? '👑 ' : ''}${esc(M.name)} <small>Lv.${M.level}</small>`;
    } else if (v.kind === 'npc') {
      name = esc(v.info.name);
    } else {
      name = `${esc(v.info.name)} <small>Lv.${v.info.level} ${CLASSES[v.info.cls].name}</small>`;
    }
    if (f.dataset.id !== String(v.id) || f.dataset.name !== name) {
      $('tf-name').innerHTML = name;
      f.dataset.id = v.id; f.dataset.name = name;
    }
    const r = v.kind === 'npc' ? 1 : v.hp / v.maxHp;
    $('tf-hp').style.transform = `scaleX(${Math.max(0, r)})`;
    $('tf-hp-t').textContent = v.kind === 'npc' ? '' : `${v.hp} / ${v.maxHp}`;
  }

  updateCooldowns(now, cds, durs, me, atkReadyAt) {
    const skills = CLASSES[me.cls].skills;
    skills.forEach((sid, i) => {
      const b = $('btn-s' + i);
      const rem = Math.max(0, (cds[sid] || 0) - now);
      const p = rem > 0 ? (rem / (durs[sid] || SKILLS[sid].cd)) * 100 : 0;
      b.querySelector('.cd').style.setProperty('--p', p + '%');
      b.querySelector('.cdt').textContent = rem > 0 ? (rem >= 1 ? Math.ceil(rem) : rem.toFixed(1)) : '';
      b.classList.toggle('nomana', me.mp < SKILLS[sid].mp);
    });
    const prem = Math.max(0, (cds.potion || 0) - now);
    const pp = prem > 0 ? (prem / 1.5) * 100 : 0;
    $('btn-hp').querySelector('.cd').style.setProperty('--p', pp + '%');
    $('btn-mp').querySelector('.cd').style.setProperty('--p', pp + '%');
  }

  setEngaged(on) { $('btn-attack').classList.toggle('engaged', on); }
  setAuto(on) { $('btn-auto').classList.toggle('on', on); }

  setInteract(npc) {
    const b = $('btn-interact');
    if (!npc) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = npc.role === 'quest' ? '💬 대화' : npc.role === 'shop' ? '🛒 상점' : '✨ 치유';
  }

  log(kind, text, from = null, bot = false) {
    const el = document.createElement('div');
    el.className = 'c-' + kind;
    if (from !== null) {
      const w = document.createElement('span');
      w.className = 'who' + (bot ? ' ai' : '');
      w.textContent = from;
      el.appendChild(w);
      el.appendChild(document.createTextNode(': ' + text));
    } else el.textContent = text;
    const box = $('chat-log');
    box.appendChild(el);
    while (box.children.length > 30) box.firstChild.remove();
    const now = performance.now();
    el.dataset.t = now;
    this.lastLog = now;
  }

  fadeLog(now) {
    for (const el of $('chat-log').children) el.classList.toggle('old', now - Number(el.dataset.t) > 12000);
    $('chat-log').classList.add('faded');
  }

  toast(text, big = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (big ? ' big' : '');
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2700);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }

  zoneBanner(zone) {
    if (zone === this.zoneShown) return;
    this.zoneShown = zone;
    const z = ZONES[zone];
    $('zb-name').textContent = z.name;
    $('zb-level').textContent = z.level;
    $('mm-zone').textContent = z.name;
    const b = $('zone-banner');
    b.classList.add('show');
    clearTimeout(this.zbT);
    this.zbT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  showDeath(msg) {
    $('death').classList.remove('hidden');
    $('death-msg').textContent = msg || '';
    $('btn-respawn').disabled = true;
    this.deathAt = performance.now() + 5000;
  }

  hideDeath() { $('death').classList.add('hidden'); this.deathAt = 0; }

  tickDeath(now) {
    if (!this.deathAt) return;
    const rem = Math.max(0, Math.ceil((this.deathAt - now) / 1000));
    $('death-count').textContent = rem;
    $('btn-respawn').disabled = rem > 0;
  }

  setPing(ms, mode) { $('ping').textContent = mode === 'offline' ? '오프라인' : `${ms}ms`; }

  // ---------------- 미니맵 ----------------
  drawMinimap(px, pz, ry, ents, camYaw) {
    const g = this.mm;
    const S = 240, R = 70; // R: 표시 반경(월드 단위)
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0a1226'; g.fillRect(0, 0, S, S);
    if (this.worldImg) {
      const k = this.worldImg.width / WORLD.size;
      const sx = (px - R + WORLD.half) * k, sz = (pz - R + WORLD.half) * k;
      g.imageSmoothingEnabled = true;
      g.drawImage(this.worldImg, sx, sz, R * 2 * k, R * 2 * k, 0, 0, S, S);
    }
    const toS = (x, z) => [S / 2 + ((x - px) / R) * (S / 2), S / 2 + ((z - pz) / R) * (S / 2)];
    for (const e of ents) {
      const [x, y] = toS(e.x, e.z);
      if (x < -5 || y < -5 || x > S + 5 || y > S + 5) continue;
      g.fillStyle = e.c;
      g.beginPath(); g.arc(x, y, e.r, 0, Math.PI * 2); g.fill();
      if (e.ring) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    }
    // 시야 방향
    g.translate(S / 2, S / 2);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.moveTo(0, 0);
    g.arc(0, 0, S * 0.45, -Math.PI / 2 - camYaw - 0.6, -Math.PI / 2 - camYaw + 0.6);
    g.closePath(); g.fill();
    g.rotate(-ry + Math.PI);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath();
    g.stroke(); g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
    g.fillText('N', S / 2, 20);
  }

  // ---------------- 패널 ----------------
  openPanel(name, opts = {}) {
    if (name === 'inventory') this.sel = null;
    this.panel = name;
    this.panelOpts = opts;
    $('panel').classList.remove('hidden');
    this.refreshPanel();
  }

  closePanel() {
    this.panel = null;
    $('panel').classList.add('hidden');
  }

  refreshPanel() {
    const me = this.game.me;
    if (!me || !this.panel) return;
    const body = $('panel-body');
    const title = $('panel-title');
    const scroll = body.scrollTop;
    switch (this.panel) {
      case 'inventory': title.textContent = '🎒 가방'; body.innerHTML = this.inventoryHtml(me); break;
      case 'character': title.textContent = '👤 캐릭터 정보'; body.innerHTML = this.characterHtml(me); break;
      case 'quest': title.textContent = '📜 퀘스트'; body.innerHTML = this.questHtml(me, false); break;
      case 'elder': title.textContent = '촌장 엘다'; body.innerHTML = this.questHtml(me, true); break;
      case 'shop': title.textContent = '🛒 상인 보로의 상점'; body.innerHTML = this.shopHtml(me); break;
      case 'priest': title.textContent = '사제 루미'; body.innerHTML = this.priestHtml(me); break;
      case 'map': title.textContent = '🗺️ 엘더문 대륙 지도'; body.innerHTML = this.mapHtml(); this.drawWorldMap(); break;
      case 'settings': title.textContent = '⚙️ 설정'; body.innerHTML = this.settingsHtml(); break;
    }
    body.scrollTop = scroll;
  }

  slotHtml(id, n, attrs = '') {
    const it = ITEMS[id];
    if (!it) return `<button class="slot empty" ${attrs}></button>`;
    return `<button class="slot ${this.sel === id ? 'sel' : ''}" style="border-color:${itemColor(it)}55" data-sel="${id}" ${attrs}>${it.icon}${n > 1 ? `<em>${n}</em>` : ''}</button>`;
  }

  inventoryHtml(me) {
    const ids = Object.keys(me.inv).filter((k) => me.inv[k] > 0);
    const order = { consumable: 0, weapon: 1, armor: 2, loot: 3 };
    ids.sort((a, b) => order[ITEMS[a].type] - order[ITEMS[b].type] || (ITEMS[b].tier || 0) - (ITEMS[a].tier || 0));
    let detail = '<div class="item-detail"><span style="color:var(--muted)">아이템을 선택하세요.</span></div>';
    const sel = this.sel;
    if (sel && ITEMS[sel]) {
      const it = ITEMS[sel];
      const equipped = me.equip.weapon === sel || me.equip.armor === sel;
      const have = me.inv[sel] > 0;
      let btns = '';
      if (it.type === 'consumable' && have) btns += `<button class="btn primary" data-act="use" data-item="${sel}">사용</button>`;
      if ((it.type === 'weapon' || it.type === 'armor') && have) btns += `<button class="btn primary" data-act="equip" data-item="${sel}" ${it.level > me.level || (it.cls && it.cls !== me.cls) ? 'disabled' : ''}>장착</button>`;
      if (equipped && it.type === 'armor') btns += `<button class="btn" data-act="unequip">해제</button>`;
      detail = `<div class="item-detail"><h4 style="color:${itemColor(it)}">${it.icon} ${esc(it.name)}${equipped ? ' <small>(착용 중)</small>' : ''}</h4>
        <div>${esc(itemStats(it) || it.desc || '')}</div>${it.desc && itemStats(it) ? `<div style="color:var(--muted)">${esc(it.desc)}</div>` : ''}
        <div style="color:var(--muted);font-size:12px;margin-top:4px">판매가 ${Math.max(1, Math.floor(it.price * 0.4))} 골드</div>
        <div class="actions">${btns}</div></div>`;
    }
    return `<div class="equip-row">
        <div>${this.slotHtml(me.equip.weapon, 1)}<div class="lbl">무기</div></div>
        <div>${this.slotHtml(me.equip.armor, 1)}<div class="lbl">방어구</div></div>
        <div style="flex:1;text-align:right;font-size:13px">💰 <span class="gold">${me.gold.toLocaleString()}</span> 골드<br>
        <span style="color:var(--muted);font-size:12px">공격력 ${me.atk} · 방어력 ${me.def}</span></div>
      </div>
      <div class="inv-grid">${ids.map((id) => this.slotHtml(id, me.inv[id])).join('')}${ids.length === 0 ? '<span style="color:var(--muted)">가방이 비어 있습니다.</span>' : ''}</div>
      ${detail}`;
  }

  characterHtml(me) {
    const C = CLASSES[me.cls];
    const skills = C.skills.map((sid) => {
      const S = SKILLS[sid];
      return `<div class="shop-item"><div class="ic">${S.icon}</div><div class="nm"><b>${S.name}</b><small>${esc(S.desc)} · 마나 ${S.mp} · 재사용 ${S.cd}초</small></div></div>`;
    }).join('');
    return `<div class="quest-box"><b>${esc(me.name)}</b> · Lv.${me.level} ${C.icon} ${C.name}<br><span style="color:var(--muted)">${C.desc}</span></div>
      <div class="stat-grid">
        <div>체력 <b>${me.maxHp}</b></div><div>마나 <b>${me.maxMp}</b></div>
        <div>공격력 <b>${me.atk}</b></div><div>방어력 <b>${me.def}</b></div>
        <div>사거리 <b>${me.range}</b></div><div>공격 간격 <b>${me.atkCd}초</b></div>
        <div>이동 속도 <b>${me.speed}</b></div><div>치명타 <b>${Math.round(me.crit * 100)}%</b></div>
        <div>골드 <b>${me.gold.toLocaleString()}</b></div><div>경험치 <b>${me.level >= 30 ? 'MAX' : Math.floor((me.xp / me.xpNext) * 100) + '%'}</b></div>
      </div>
      <h4 style="margin:14px 0 6px">스킬</h4><div class="shop-list">${skills}</div>`;
  }

  rewardText(q) {
    return `${q.xp.toLocaleString()} 경험치 · ${q.gold.toLocaleString()} 골드${q.items.length ? ' · ' + q.items.map(([id, n]) => `${ITEMS[id].icon} ${ITEMS[id].name} x${n}`).join(', ') : ''}`;
  }

  questHtml(me, atNpc) {
    const q = me.quest;
    let status, btn = '';
    if (!q.active) {
      if (me.level < q.minLevel) status = `<span style="color:#ff9c7a">레벨 ${q.minLevel} 이상 수락 가능</span>`;
      else { status = '수락 가능'; btn = atNpc ? '<button class="btn good" data-act="quest">퀘스트 수락</button>' : ''; }
    } else if (q.done) {
      status = '<span style="color:var(--good)">✔ 완료! 보상을 받으세요</span>';
      btn = atNpc ? '<button class="btn good" data-act="quest">보상 받기</button>' : '';
    } else status = `진행 중 — ${MONSTERS[q.target].name} <b>${q.progress} / ${q.count}</b>`;
    const intro = atNpc ? `<div class="dialog-npc"><div class="face">🧙</div><p>"${esc(q.text)}"</p></div>` : '';
    return `${intro}<div class="quest-box"><b>${esc(q.name)}</b><br>${atNpc ? '' : esc(q.text) + '<br>'}상태: ${status}<br>보상: ${esc(this.rewardText(q))}</div>
      ${btn}${!atNpc ? '<p class="help">퀘스트는 마을 북쪽의 <b>촌장 엘다</b>에게서 받고 보고할 수 있습니다.</p>' : ''}`;
  }

  shopHtml(me) {
    const tabs = `<div class="tabs"><button data-tab="buy" class="${this.shopTab === 'buy' ? 'on' : ''}">구매</button><button data-tab="sell" class="${this.shopTab === 'sell' ? 'on' : ''}">판매</button></div>`;
    const gold = `<p style="margin:0 0 8px;font-size:13px">💰 보유 골드: <span class="gold">${me.gold.toLocaleString()}</span></p>`;
    let rows;
    if (this.shopTab === 'buy') {
      rows = SHOP_LIST.map((id0) => {
        const id = resolveItemId(id0, me.cls);
        const it = ITEMS[id];
        const multi = it.type === 'consumable';
        return `<div class="shop-item"><div class="ic">${it.icon}</div><div class="nm" style="color:${itemColor(it)}">${esc(it.name)}<small>${esc(itemStats(it))}</small></div>
          <span class="gold">${it.price}</span>
          <button class="btn" data-act="buy" data-item="${id}" data-n="1" ${me.gold < it.price ? 'disabled' : ''}>구매</button>
          ${multi ? `<button class="btn" data-act="buy" data-item="${id}" data-n="10" ${me.gold < it.price * 10 ? 'disabled' : ''}>x10</button>` : ''}</div>`;
      }).join('');
    } else {
      const ids = Object.keys(me.inv).filter((k) => me.inv[k] > 0);
      rows = ids.length ? ids.map((id) => {
        const it = ITEMS[id];
        const p = Math.max(1, Math.floor(it.price * 0.4));
        const n = me.inv[id];
        return `<div class="shop-item"><div class="ic">${it.icon}</div><div class="nm">${esc(it.name)} x${n}<small>개당 ${p} 골드</small></div>
          <button class="btn" data-act="sell" data-item="${id}" data-n="1">판매</button>
          ${n > 1 ? `<button class="btn" data-act="sell" data-item="${id}" data-n="${n}">전부</button>` : ''}</div>`;
      }).join('') : '<p style="color:var(--muted)">판매할 아이템이 없습니다.</p>';
    }
    return tabs + gold + `<div class="shop-list">${rows}</div>`;
  }

  priestHtml(me) {
    return `<div class="dialog-npc"><div class="face">😇</div><p>"달의 축복이 함께하기를... 지친 몸을 치유해 드릴게요."</p></div>
      <button class="btn good" data-act="pray">✨ 치유 받기 (무료)</button>
      <p class="help">마을 안에서는 체력과 마나가 빠르게 회복됩니다.</p>`;
  }

  mapHtml() {
    const legend = Object.entries(ZONES).map(([id, z]) => `<span><i style="background:${ZONE_GROUND[id]}"></i>${z.name} (${z.level})</span>`).join('');
    return `<canvas id="worldmap" width="512" height="512"></canvas><div class="legend">${legend}<span>👑 보스</span><span><i style="background:#fff"></i>나</span></div>`;
  }

  drawWorldMap() {
    const c = $('worldmap');
    if (!c || !this.worldImg) return;
    const g = c.getContext('2d');
    g.drawImage(this.worldImg, 0, 0, 512, 512);
    const k = 512 / WORLD.size;
    const P = (x, z) => [(x + WORLD.half) * k, (z + WORLD.half) * k];
    g.font = 'bold 15px sans-serif'; g.textAlign = 'center';
    const labels = [['meadow', 0, 62], ['forest', 0, -140], ['highland', 140, 20], ['graveyard', 0, 140], ['volcano', -125, -30]];
    for (const [id, x, z] of labels) {
      const [sx, sy] = P(x, z);
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(ZONES[id].name, sx, sy);
      g.fillStyle = '#fff'; g.fillText(ZONES[id].name, sx, sy);
      g.font = '12px sans-serif'; g.strokeText(ZONES[id].level, sx, sy + 16); g.fillStyle = '#ffd36b'; g.fillText(ZONES[id].level, sx, sy + 16);
      g.font = 'bold 15px sans-serif';
    }
    const [tx, ty] = P(0, 0);
    g.font = '20px sans-serif'; g.fillText('🏠', tx, ty + 7);
    const [bx, by] = P(WORLD.boss.x, WORLD.boss.z);
    g.fillText('👑', bx, by + 7);
    const st = this.game.mapState();
    for (const e of st.ents) {
      if (e.kind !== 'player') continue;
      const [x, y] = P(e.x, e.z);
      g.fillStyle = e.c; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    const [mx, my] = P(st.x, st.z);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  settingsHtml() {
    const s = this.game.settings;
    return `<div class="settings-row"><span>그래픽 품질</span><select data-set="quality">
        <option value="low" ${s.quality === 'low' ? 'selected' : ''}>낮음 (배터리 절약)</option>
        <option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>보통</option>
        <option value="high" ${s.quality === 'high' ? 'selected' : ''}>높음 (그림자)</option></select></div>
      <div class="settings-row"><span>FPS 표시</span><input type="checkbox" data-set="fps" ${s.fps ? 'checked' : ''}></div>
      <div class="settings-row"><span>카메라 감도</span><select data-set="sens">
        ${[0.6, 1, 1.4, 2].map((v) => `<option value="${v}" ${s.sens == v ? 'selected' : ''}>${v === 1 ? '보통' : v < 1 ? '느림' : v < 2 ? '빠름' : '매우 빠름'}</option>`).join('')}</select></div>
      <div class="settings-row"><span>전체 화면</span><button class="btn" data-act="fullscreen">전체 화면 전환</button></div>
      <div class="settings-row"><span>접속 모드: <b>${this.game.net?.mode === 'online' ? '온라인 서버' : '오프라인'}</b></span><button class="btn" data-act="logout">타이틀로</button></div>
      <div class="help" style="margin-top:10px">
        <b>모바일 조작</b><br>왼쪽 화면 드래그: 이동 · 오른쪽 드래그: 카메라 회전 · 두 손가락: 줌<br>
        몬스터 탭: 대상 지정 + 자동 공격 · <b>AUTO</b>: 자동 사냥 (스킬/물약 자동 사용)<br>
        <b>키보드</b><br><kbd>W A S D</kbd> 이동 · <kbd>Space</kbd> 공격 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 스킬 · <kbd>Q</kbd>/<kbd>E</kbd> 물약 · <kbd>Tab</kbd> 대상 변경 · <kbd>F</kbd> 대화 · <kbd>R</kbd> 자동 사냥 · <kbd>Enter</kbd> 채팅 · <kbd>I</kbd> 가방 · <kbd>M</kbd> 지도
      </div>`;
  }

  onPanelClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab) { this.shopTab = tab.dataset.tab; return this.refreshPanel(); }
    const sel = e.target.closest('[data-sel]');
    if (sel) { this.sel = sel.dataset.sel; return this.refreshPanel(); }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const g = this.game;
    const item = b.dataset.item;
    switch (b.dataset.act) {
      case 'use': g.send({ t: 'use', item }); break;
      case 'equip': g.send({ t: 'equip', item }); this.sel = null; break;
      case 'unequip': g.send({ t: 'unequip', slot: 'armor' }); this.sel = null; break;
      case 'buy': g.send({ t: 'buy', item, n: Number(b.dataset.n) }); break;
      case 'sell': g.send({ t: 'sell', item, n: Number(b.dataset.n) }); break;
      case 'quest': g.send({ t: 'quest' }); break;
      case 'pray': g.send({ t: 'pray' }); this.closePanel(); break;
      case 'fullscreen': g.toggleFullscreen(); break;
      case 'logout': g.logout(); break;
    }
  }

  onPanelChange(e) {
    const k = e.target.dataset.set;
    if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    this.game.changeSetting(k, v);
  }
}
