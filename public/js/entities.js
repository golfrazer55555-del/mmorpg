// 서버 스냅샷 -> 3D 엔티티(플레이어/몬스터/NPC) 동기화
import * as THREE from 'three';
import { MONSTERS, NPCS } from '../shared/data.js';
import { heightAt } from '../shared/terrain.js';
import { buildPlayerModel, buildMonsterModel, buildNpcModel, animateModel } from './models.js';

let shadowTex = null;
function getShadowTex() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const barTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4);
  return new THREE.CanvasTexture(c);
})();

function makeLabel(text, color, sub = null, badge = null) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 30px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  g.font = font;
  const bw = badge ? g.measureText(badge).width * 0.7 + 14 : 0;
  const w = Math.ceil(g.measureText(text).width + 16 + bw);
  const h = sub ? 72 : 42;
  c.width = Math.max(64, w); c.height = h;
  g.font = font;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.8)';
  const cx = c.width / 2 + bw / 2;
  g.strokeText(text, cx, 22);
  g.fillStyle = color; g.fillText(text, cx, 22);
  if (badge) {
    const bx = cx - g.measureText(text).width / 2 - bw / 2 - 2;
    g.fillStyle = '#2b6cb0';
    g.beginPath(); g.roundRect ? g.roundRect(bx - bw / 2 + 2, 9, bw - 4, 26, 6) : g.rect(bx - bw / 2 + 2, 9, bw - 4, 26); g.fill();
    g.font = 'bold 19px sans-serif'; g.fillStyle = '#e3f2ff'; g.fillText(badge, bx, 23);
  }
  if (sub) {
    g.font = 'bold 22px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    g.strokeText(sub, c.width / 2, 56);
    g.fillStyle = '#ffe9a8'; g.fillText(sub, c.width / 2, 56);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const scale = 0.0155;
  sp.scale.set(c.width * scale, c.height * scale, 1);
  sp.userData.base = { x: sp.scale.x, y: sp.scale.y, px: c.height };
  sp.renderOrder = 20;
  sp.center.set(0.5, 0);
  return sp;
}

function makeBar(color) {
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, color: '#111', transparent: true, opacity: 0.75, depthWrite: false }));
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, color, depthWrite: false, transparent: true }));
  bg.scale.set(1.4, 0.13, 1); fg.scale.set(1.36, 0.09, 1);
  bg.renderOrder = 21; fg.renderOrder = 22;
  const grp = new THREE.Group();
  grp.add(bg, fg);
  return { grp, bg, fg, w: 1.36 };
}

function levelColor(my, lv) {
  const d = lv - my;
  if (d >= 4) return '#ff5252';
  if (d >= 2) return '#ffab40';
  if (d >= -3) return '#ffffff';
  return '#a0a0a0';
}

export class EntityManager {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
    this.infos = new Map();
    this.myId = 0;
    this.myLevel = 1;
    this.targetId = 0;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.85, depthWrite: false }));
    ring.visible = false;
    ring.renderOrder = 5;
    scene.add(ring);
    this.ring = ring;
    for (const n of NPCS) this.createNpc(n);
  }

  createNpc(n) {
    const model = buildNpcModel(n);
    const v = this.baseView(n.id, 'npc', model, { name: n.name, role: n.role });
    v.x = v.tx = n.x; v.z = v.tz = n.z;
    v.ry = v.try = Math.atan2(-n.x, -n.z);
    const sub = n.role === 'quest' ? '[퀘스트]' : n.role === 'shop' ? '[상점]' : '[치유]';
    v.label = makeLabel(n.name, '#ffd54f', sub);
    v.label.position.y = model.height + 0.1;
    v.group.add(v.label);
    if (n.role === 'quest') {
      const mark = makeLabel('!', '#ffd54f');
      mark.scale.multiplyScalar(2.2);
      mark.position.y = model.height + 1.25;
      v.group.add(mark);
      v.mark = mark;
    }
    this.views.set(n.id, v);
  }

  baseView(id, kind, model, info) {
    const group = new THREE.Group();
    group.add(model.root);
    model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const sh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const ss = kind === 'monster' ? (MONSTERS[info.type]?.size || 1) * 1.5 : 1.5;
    sh.scale.set(ss, 1, ss);
    sh.renderOrder = 1;
    this.scene.add(group);
    this.scene.add(sh);
    return {
      id, kind, info, group, model, shadow: sh, label: null, bar: null,
      x: 0, z: 0, tx: 0, tz: 0, ry: 0, try: 0, hp: 1, maxHp: 1, dead: false, deadT: 0,
      atk: -1, cast: 0, move: 0, flash: 0, spawnT: 1, seen: true, lx: 0, lz: 0, chase: false,
    };
  }

  setInfo(info) {
    const old = this.infos.get(info.id);
    this.infos.set(info.id, info);
    const v = this.views.get(info.id);
    if (v && old && info.k === 'p') {
      const rebuild = old.weapon !== info.weapon || old.armor !== info.armor || old.color !== info.color;
      if (rebuild) this.rebuildModel(v, info);
      if (old.level !== info.level || old.name !== info.name) this.refreshLabel(v);
    }
  }

  rebuildModel(v, info) {
    v.group.remove(v.model.root);
    v.model = buildPlayerModel(info);
    v.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    v.group.add(v.model.root);
    v.info = info;
  }

  refreshLabel(v) {
    if (v.label) { v.group.remove(v.label); v.label.material.map.dispose(); v.label.material.dispose(); }
    const info = this.infos.get(v.id) || v.info;
    v.info = info;
    let text, color, badge = null;
    if (v.kind === 'player') {
      text = `Lv.${info.level} ${info.name}`;
      color = v.id === this.myId ? '#7dffb0' : info.bot ? '#a6dcff' : '#ffffff';
      if (info.bot) badge = 'AI';
    } else {
      const M = MONSTERS[info.type];
      text = `Lv.${M.level} ${M.name}`;
      color = M.boss ? '#ff7043' : levelColor(this.myLevel, M.level);
    }
    v.label = makeLabel(text, color, null, badge);
    v.label.position.y = v.model.height + 0.28;
    v.group.add(v.label);
  }

  ensureView(id, kind) {
    let v = this.views.get(id);
    if (v) return v;
    const info = this.infos.get(id);
    if (!info) return null;
    const model = kind === 'player' ? buildPlayerModel(info) : buildMonsterModel(info.type);
    v = this.baseView(id, kind, model, info);
    v.spawnT = 0;
    this.refreshLabel(v);
    const bar = makeBar(kind === 'player' ? (id === this.myId ? '#4cd38a' : '#5aa0ff') : '#e5484d');
    bar.grp.position.y = model.height + 0.12;
    v.group.add(bar.grp);
    v.bar = bar;
    this.views.set(id, v);
    return v;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.scene.remove(v.shadow);
    v.group.traverse((o) => {
      if (o.material) {
        if (o.material.map && o.isSprite && o.material.map !== barTex) o.material.map.dispose();
        o.material.dispose();
      }
    });
    v.shadow.material.dispose();
    this.views.delete(id);
    if (this.targetId === id) this.targetId = 0;
  }

  setMyLevel(lv) {
    if (lv === this.myLevel) return;
    this.myLevel = lv;
    for (const v of this.views.values()) if (v.kind === 'monster') this.refreshLabel(v);
  }

  applySnapshot(s) {
    for (const v of this.views.values()) if (v.kind !== 'npc') v.seen = false;
    for (const [id, x, z, ry, hp, maxHp, dead] of s.P) {
      const v = this.ensureView(id, 'player');
      if (!v) continue;
      v.seen = true;
      if (id !== this.myId) this.setTarget(v, x, z, ry);
      v.hp = hp; v.maxHp = maxHp;
      this.setDead(v, !!dead);
    }
    for (const [id, x, z, ry, hp, maxHp, dead, chase] of s.M) {
      const v = this.ensureView(id, 'monster');
      if (!v) continue;
      v.seen = true;
      this.setTarget(v, x, z, ry);
      v.hp = hp; v.maxHp = maxHp; v.chase = !!chase;
      this.setDead(v, !!dead);
    }
    for (const v of [...this.views.values()]) if (!v.seen) this.removeView(v.id);
  }

  setTarget(v, x, z, ry) {
    if (v.fresh === undefined) { v.x = x; v.z = z; v.ry = ry; v.fresh = false; }
    v.tx = x; v.tz = z; v.try = ry;
  }

  setDead(v, dead) {
    if (dead && !v.dead) { v.deadT = 0; }
    if (!dead && v.dead) { v.spawnT = 0; v.deadT = 0; }
    v.dead = dead;
  }

  setLocal(id, x, z, ry) {
    const v = this.views.get(id);
    if (!v) return;
    v.x = v.tx = x; v.z = v.tz = z; v.try = ry;
    v.fresh = false;
  }

  playAttack(id) { const v = this.views.get(id); if (v) v.atk = 0; }
  playCast(id) { const v = this.views.get(id); if (v) v.cast = 0.001; }
  flash(id) { const v = this.views.get(id); if (v) v.flash = 0.14; }

  pos(id, out = new THREE.Vector3()) {
    const v = this.views.get(id);
    if (!v) return null;
    return out.set(v.x, heightAt(v.x, v.z), v.z);
  }

  height(id) { return this.views.get(id)?.model.height || 2; }

  // 이름표가 화면에서 너무 크거나 작아지지 않도록 픽셀 크기를 제한
  clampSprite(sp, cam, wpos, minPx, maxPx) {
    const b = sp.userData.base;
    const d = Math.max(0.5, cam.position.distanceTo(wpos));
    const unit = (2 * Math.tan((cam.fov * Math.PI) / 360)) / window.innerHeight; // 거리 1에서 1px의 월드 크기
    const px = b.y / (unit * d);
    const want = Math.max(minPx, Math.min(maxPx, px));
    const f = want / px;
    sp.scale.set(b.x * f, b.y * f, 1);
    return f;
  }

  update(dt, t, cam) {
    const k = 1 - Math.exp(-dt * 10);
    const me = this.views.get(this.myId);
    const wp = new THREE.Vector3();
    for (const v of this.views.values()) {
      if (v.id !== this.myId && v.kind !== 'npc') {
        const dx = v.tx - v.x, dz = v.tz - v.z;
        if (dx * dx + dz * dz > 400) { v.x = v.tx; v.z = v.tz; }
        else { v.x += dx * k; v.z += dz * k; }
      }
      // 이동량 추정
      const sp = Math.hypot(v.x - v.lx, v.z - v.lz) / Math.max(dt, 1e-3);
      v.lx = v.x; v.lz = v.z;
      const mvTarget = Math.min(1, sp / 4);
      v.move += (mvTarget - v.move) * Math.min(1, dt * 10);
      let dr = v.try - v.ry;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      v.ry += dr * Math.min(1, dt * 12);

      const y = heightAt(v.x, v.z);
      v.group.position.set(v.x, y, v.z);
      v.model.root.rotation.y = v.ry;
      v.shadow.position.set(v.x, y + 0.06, v.z);

      if (v.atk >= 0) { v.atk += dt / 0.45; if (v.atk >= 1) v.atk = -1; }
      if (v.cast > 0) { v.cast += dt / 0.6; if (v.cast >= 1) v.cast = 0; }

      if (v.dead) {
        v.deadT += dt;
        animateModel(v.model, { t, move: 0, atk: -1, cast: 0 });
        if (v.kind === 'monster') {
          const s = Math.max(0, 1 - Math.max(0, v.deadT - 0.6) / 1.2);
          v.model.root.scale.setScalar((v.model.baseScale ??= v.model.root.scale.x) * Math.max(0.001, s));
          v.model.root.position.y = -Math.min(1, v.deadT) * 0.3;
          v.model.root.rotation.z = Math.min(1, v.deadT * 3) * 1.2;
        } else {
          v.model.root.rotation.x = -Math.min(1, v.deadT * 3) * (Math.PI / 2);
          v.model.root.position.y = 0.25;
        }
        if (v.bar) v.bar.grp.visible = false;
        v.shadow.visible = false;
      } else {
        animateModel(v.model, { t: t + (typeof v.id === 'number' ? v.id : v.id.length) * 0.7, move: v.move, atk: v.atk, cast: v.cast });
        const base = (v.model.baseScale ??= v.model.root.scale.x);
        if (v.spawnT < 1) v.spawnT = Math.min(1, v.spawnT + dt * 2.5);
        v.model.root.scale.setScalar(base * (0.3 + 0.7 * v.spawnT));
        v.model.root.position.y = 0; v.model.root.rotation.x = 0; v.model.root.rotation.z = 0;
        v.shadow.visible = true;
        if (v.bar) {
          const ratio = Math.max(0, Math.min(1, v.hp / Math.max(1, v.maxHp)));
          const show = v.kind === 'player' || ratio < 1 || v.id === this.targetId;
          v.bar.grp.visible = show;
          v.bar.fg.scale.x = Math.max(0.001, v.bar.w * ratio);
          v.bar.fg.center.x = 0.5 / Math.max(0.001, ratio);
        }
      }
      if (v.flash > 0) {
        v.flash -= dt;
        const on = v.flash > 0;
        for (const m of v.model.mats) {
          if (on) {
            if (!m.userData.saved) m.userData.saved = { e: m.emissive.getHex(), i: m.emissiveIntensity };
            m.emissive.set('#ffffff'); m.emissiveIntensity = 0.55;
          } else if (m.userData.saved) {
            m.emissive.setHex(m.userData.saved.e); m.emissiveIntensity = m.userData.saved.i;
            delete m.userData.saved;
          }
        }
      }
      // 멀리 있는 이름표/체력바는 숨김 (드로우콜 절약)
      const far = me && v !== me && v.kind !== 'npc' && Math.hypot(v.x - me.x, v.z - me.z) > (v.id === this.targetId ? 70 : 42);
      if (v.label) v.label.visible = !far;
      if (far && v.bar) v.bar.grp.visible = false;
      if (cam && v.label && !far) {
        wp.set(v.x, v.group.position.y + v.model.height, v.z);
        const lpx = v.label.userData.base.px;
        const f = this.clampSprite(v.label, cam, wp, lpx * 0.36, lpx * 0.62);
        if (v.bar) v.bar.grp.scale.setScalar(Math.max(0.6, Math.min(2.5, f)));
        if (v.mark) this.clampSprite(v.mark, cam, wp, 34, 60);
      }
      if (v.mark) v.mark.position.y = v.model.height + 1.25 + Math.sin(t * 3) * 0.12;
    }
    const tv = this.views.get(this.targetId);
    if (tv && !tv.dead) {
      this.ring.visible = true;
      const s = tv.kind === 'monster' ? (MONSTERS[tv.info.type]?.size || 1) : 1;
      this.ring.scale.setScalar(s);
      this.ring.position.set(tv.x, heightAt(tv.x, tv.z) + 0.08, tv.z);
      this.ring.rotation.y = t * 1.5;
      this.ring.material.color.set(tv.kind === 'monster' ? '#ff4d4d' : '#ffd54f');
    } else this.ring.visible = false;
  }

  setQuestMark(state) {
    const v = this.views.get('npc_elder');
    if (!v || !v.mark) return;
    v.mark.visible = state !== 'none';
    v.mark.material.color.set(state === 'done' ? '#7dff9a' : '#ffffff');
  }
}
