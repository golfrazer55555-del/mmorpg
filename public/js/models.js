// 로우폴리 캐릭터/몬스터 모델 (기본 도형으로 절차적 생성)
import * as THREE from 'three';
import { TIER_COLORS, ITEMS } from '../shared/data.js';
import { optimizeModel } from './merge.js';

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphere = (r, d = 1) => geo(`s${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const cone = (r, h, s = 6) => geo(`c${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const cyl = (rt, rb, h, s = 7) => geo(`y${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));

function makeMats() {
  const list = [];
  const M = (color, extra = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
    list.push(m);
    return m;
  };
  return { M, list };
}

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

function pivot(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(f);
}

// ---------------- 무기 ----------------
function buildWeapon(kind, tier, M) {
  const g = new THREE.Group();
  const tc = TIER_COLORS[Math.max(0, Math.min(4, tier))];
  const glow = tier >= 3;
  g.position.set(0, -0.62, 0);
  if (kind === 'sword' || kind === 'rusty') {
    const len = kind === 'rusty' ? 0.8 : 0.95 + tier * 0.07;
    const bladeColor = kind === 'rusty' ? '#a1887f' : tc;
    g.add(mesh(box(0.07, 0.15, len), M(bladeColor, glow ? { emissive: tc, emissiveIntensity: 0.4 } : {}), 0, 0, 0.16 + len / 2));
    g.add(mesh(box(0.36, 0.1, 0.08), M(kind === 'rusty' ? '#5d4037' : '#8d6e63'), 0, 0, 0.14));
    g.add(mesh(box(0.07, 0.07, 0.24), M('#4e342e'), 0, 0, 0));
    g.rotation.x = -0.35;
  } else if (kind === 'club') {
    const c = mesh(cyl(0.12, 0.05, 0.85, 5), M('#795548'), 0, 0, 0.4);
    c.rotation.x = Math.PI / 2;
    g.add(c);
    g.rotation.x = -0.35;
  } else if (kind === 'staff') {
    g.add(mesh(cyl(0.04, 0.05, 1.7, 5), M('#6d4c41'), 0, 0.15, 0.08));
    const oc = tier ? tc : '#80deea';
    g.add(mesh(sphere(0.13 + tier * 0.018, 0), M(oc, { emissive: tier ? tc : '#4dd0e1', emissiveIntensity: 0.8 }), 0, 1.07, 0.08));
    g.add(mesh(cone(0.09, 0.2, 4), M('#ffd54f'), 0, 0.92, 0.08));
  } else if (kind === 'bow') {
    const arc = new THREE.Mesh(geo('bowarc', () => new THREE.TorusGeometry(0.55, 0.035, 4, 10, Math.PI)), M(tier ? tc : '#8d6e63', glow ? { emissive: tc, emissiveIntensity: 0.4 } : {}));
    arc.rotation.set(Math.PI, Math.PI / 2, 0);
    g.add(arc);
    g.add(mesh(box(0.012, 0.012, 1.1), M('#eeeeee'), 0, 0, 0));
  }
  return g;
}

// ---------------- 휴머노이드 ----------------
export function buildHumanoid(o) {
  const { M, list } = makeMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = o.thin ? 0.75 : 1;
  const skin = M(o.skin || '#f1c27d');
  const cloth = M(o.body || '#1e88e5');
  const legM = M(o.legs || '#37474f');
  const boot = M(o.boot || '#3e2723');

  const torso = mesh(box(0.62 * s, 0.7, 0.36 * s), cloth, 0, 1.25, 0);
  body.add(torso);
  body.add(mesh(box(0.64 * s, 0.1, 0.38 * s), M(o.belt || '#5d4037'), 0, 0.95, 0));
  if (o.chest) body.add(mesh(box(0.5 * s, 0.4, 0.06), M(o.chest, { emissive: o.chest, emissiveIntensity: 0.12 }), 0, 1.32, 0.19 * s));

  const head = pivot(body, 0, 1.62, 0);
  head.add(mesh(box(0.46, 0.46, 0.44), skin, 0, 0.24, 0));
  const eyeM = M(o.eyes || '#1a1a1a', o.eyes ? { emissive: o.eyes, emissiveIntensity: 1 } : {});
  head.add(mesh(box(0.08, 0.08, 0.02), eyeM, -0.11, 0.27, 0.225));
  head.add(mesh(box(0.08, 0.08, 0.02), eyeM, 0.11, 0.27, 0.225));
  if (o.ears) {
    const ear = cone(0.08, 0.34, 4);
    const l = mesh(ear, skin, -0.3, 0.3, 0); l.rotation.z = Math.PI / 2.4; head.add(l);
    const r = mesh(ear, skin, 0.3, 0.3, 0); r.rotation.z = -Math.PI / 2.4; head.add(r);
  }
  if (o.beard) head.add(mesh(box(0.4, 0.28, 0.1), M('#eeeeee'), 0, 0.06, 0.24));
  if (o.hair) head.add(mesh(box(0.5, 0.14, 0.48), M(o.hair), 0, 0.48, -0.01));

  const hw = o.headwear;
  if (hw === 'helmet') {
    const hm = M(o.helmColor || '#b0bec5');
    head.add(mesh(box(0.54, 0.3, 0.52), hm, 0, 0.42, 0));
    head.add(mesh(box(0.08, 0.2, 0.08), M(o.accent || '#e53935'), 0, 0.66, 0));
    head.add(mesh(box(0.54, 0.08, 0.06), hm, 0, 0.36, 0.25));
  } else if (hw === 'hat') {
    head.add(mesh(cyl(0.42, 0.42, 0.05, 8), M(o.hatColor || o.body), 0, 0.48, 0));
    const c = mesh(cone(0.27, 0.62, 8), M(o.hatColor || o.body), 0, 0.8, -0.04);
    c.rotation.x = -0.18;
    head.add(c);
  } else if (hw === 'hood') {
    head.add(mesh(box(0.52, 0.22, 0.5), M(o.hoodColor || shade(o.body, 0.7)), 0, 0.46, -0.02));
    head.add(mesh(box(0.52, 0.34, 0.1), M(o.hoodColor || shade(o.body, 0.7)), 0, 0.26, -0.24));
  } else if (hw === 'horns') {
    const hc = M('#3e2723');
    const l = mesh(cone(0.07, 0.3, 4), hc, -0.16, 0.56, 0); l.rotation.z = 0.4; head.add(l);
    const r = mesh(cone(0.07, 0.3, 4), hc, 0.16, 0.56, 0); r.rotation.z = -0.4; head.add(r);
  } else if (hw === 'cap') {
    head.add(mesh(box(0.5, 0.12, 0.5), M(o.hatColor || '#795548'), 0, 0.5, 0));
    head.add(mesh(box(0.5, 0.04, 0.2), M(o.hatColor || '#795548'), 0, 0.45, 0.3));
  } else if (hw === 'halo') {
    const halo = new THREE.Mesh(geo('halo', () => new THREE.TorusGeometry(0.22, 0.03, 4, 14)), M('#ffe082', { emissive: '#ffd54f', emissiveIntensity: 1 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.66;
    head.add(halo);
  }

  // 팔
  const armL = pivot(body, -0.42 * s, 1.55, 0);
  const armR = pivot(body, 0.42 * s, 1.55, 0);
  for (const a of [armL, armR]) {
    a.add(mesh(box(0.2 * s, 0.6, 0.22 * s), cloth, 0, -0.28, 0));
    a.add(mesh(box(0.18 * s, 0.14, 0.2 * s), skin, 0, -0.62, 0));
  }
  if (o.pads) {
    const pm = M(o.pads);
    armL.add(mesh(box(0.3, 0.14, 0.32), pm, -0.03, 0.02, 0));
    armR.add(mesh(box(0.3, 0.14, 0.32), pm, 0.03, 0.02, 0));
  }
  // 다리
  const legL = pivot(body, -0.16 * s, 0.92, 0);
  const legR = pivot(body, 0.16 * s, 0.92, 0);
  for (const l of [legL, legR]) {
    l.add(mesh(box(0.24 * s, 0.7, 0.26 * s), legM, 0, -0.35, 0));
    l.add(mesh(box(0.26 * s, 0.2, 0.32 * s), boot, 0, -0.82, 0.03));
  }
  if (o.robe) body.add(mesh(cyl(0.33, 0.48, 0.78, 8), M(o.robe), 0, 0.55, 0));
  if (o.cape) {
    const cape = pivot(body, 0, 1.55, -0.2);
    cape.add(mesh(box(0.56, 1.0, 0.04), M(o.cape), 0, -0.5, 0));
    cape.rotation.x = 0.12;
  }
  if (o.quiver) {
    const q = mesh(cyl(0.09, 0.09, 0.6, 6), M('#6d4c41'), 0.12, 1.3, -0.24);
    q.rotation.z = 0.5;
    body.add(q);
  }
  if (o.bag) body.add(mesh(box(0.4, 0.45, 0.25), M('#8d6e63'), 0, 1.25, -0.3));
  if (o.shield) {
    const sh = mesh(box(0.08, 0.6, 0.5), M(o.shield), -0.14, -0.45, 0.06);
    armL.add(sh);
  }

  let weapon = null;
  if (o.weapon) {
    weapon = buildWeapon(o.weapon, o.weaponTier || 0, M);
    (o.weapon === 'bow' ? armL : armR).add(weapon);
  }

  root.scale.setScalar(o.scale || 1);
  return {
    root, body, mats: list, kind: 'humanoid', weaponKind: o.weapon, height: 2.3 * (o.scale || 1),
    parts: { head, armL, armR, legL, legR, torso },
  };
}

export function animateHumanoid(m, st) {
  const { armL, armR, legL, legR, head } = m.parts;
  const mv = st.move;
  const w = Math.sin(st.t * 11) * mv;
  legL.rotation.x = w * 0.75;
  legR.rotation.x = -w * 0.75;
  armL.rotation.x = -w * 0.6;
  armR.rotation.x = w * 0.6;
  armL.rotation.z = 0.05; armR.rotation.z = -0.05;
  m.body.position.y = Math.abs(Math.sin(st.t * 11)) * 0.07 * mv + Math.sin(st.t * 2) * 0.015 * (1 - mv);
  head.rotation.y = 0;

  if (st.cast > 0) {
    // 스킬 시전: 양팔을 들어올림
    const k = Math.sin(Math.min(1, st.cast) * Math.PI);
    armL.rotation.x = -2.6 * k; armR.rotation.x = -2.6 * k;
    armL.rotation.z = 0.4 * k; armR.rotation.z = -0.4 * k;
  }
  if (st.atk >= 0 && st.atk < 1) {
    const p = st.atk;
    if (m.weaponKind === 'bow') {
      armL.rotation.x = -1.55; armL.rotation.z = 0;
      armR.rotation.x = -1.45 + (p < 0.6 ? 0 : (p - 0.6) * 2);
      armR.rotation.z = p < 0.6 ? -0.5 * (p / 0.6) : -0.5;
    } else if (m.weaponKind === 'staff') {
      const k = Math.sin(p * Math.PI);
      armR.rotation.x = -1.9 * k;
    } else {
      armR.rotation.x = p < 0.35 ? -2.7 * (p / 0.35) : -2.7 + 3.4 * Math.min(1, (p - 0.35) / 0.3);
      armR.rotation.z = -0.3 * Math.sin(p * Math.PI);
      m.body.rotation.y = Math.sin(p * Math.PI) * -0.3;
    }
  } else {
    m.body.rotation.y = 0;
  }
}

// ---------------- 플레이어 ----------------
export function buildPlayerModel(info) {
  return optimizeModel(buildPlayerModelRaw(info));
}

function buildPlayerModelRaw(info) {
  const w = info.weapon ? ITEMS[info.weapon] : null;
  const a = info.armor ? ITEMS[info.armor] : null;
  const at = a ? a.tier : 0;
  const color = info.color || '#1e88e5';
  const armorTint = at ? TIER_COLORS[at] : null;
  const base = {
    body: color, legs: shade(color, 0.45).getStyle(), weaponTier: w ? w.tier : 0,
    pads: at >= 2 ? armorTint : null, chest: at >= 1 ? armorTint : null,
  };
  if (info.cls === 'warrior') {
    return buildHumanoid({ ...base, headwear: 'helmet', helmColor: at >= 3 ? armorTint : '#b0bec5', accent: color, weapon: 'sword', cape: at >= 3 ? shade(color, 0.6).getStyle() : null });
  }
  if (info.cls === 'mage') {
    return buildHumanoid({ ...base, headwear: 'hat', hatColor: shade(color, 0.8).getStyle(), robe: shade(color, 0.85).getStyle(), weapon: 'staff', hair: '#5d4037' });
  }
  return buildHumanoid({ ...base, headwear: 'hood', weapon: 'bow', quiver: true, hair: '#3e2723' });
}

export function buildNpcModel(npc) {
  return optimizeModel(buildNpcModelRaw(npc));
}

function buildNpcModelRaw(npc) {
  if (npc.role === 'quest') return buildHumanoid({ body: '#5e35b1', robe: '#4527a0', beard: true, hair: '#e0e0e0', headwear: 'none', weapon: 'staff', weaponTier: 2, cape: '#311b92' });
  if (npc.role === 'shop') return buildHumanoid({ body: '#ef6c00', legs: '#4e342e', headwear: 'cap', hatColor: '#6d4c41', bag: true, hair: '#4e342e' });
  return buildHumanoid({ body: '#eceff1', robe: '#f5f5f5', belt: '#ffca28', headwear: 'halo', hair: '#ffe082', chest: '#ffd54f' });
}

// ---------------- 몬스터 ----------------
export function buildMonsterModel(type) {
  return optimizeModel(buildMonsterModelRaw(type));
}

function buildMonsterModelRaw(type) {
  switch (type) {
    case 'slime': return buildSlime();
    case 'wolf': return buildWolf();
    case 'goblin': {
      const m = buildHumanoid({ skin: '#7cb342', body: '#6d4c41', legs: '#4e342e', ears: true, eyes: '#ffeb3b', weapon: 'club', scale: 0.78, headwear: 'none' });
      m.kind = 'humanoid';
      return m;
    }
    case 'skeleton': {
      const m = buildHumanoid({ skin: '#e8e2d0', body: '#d7ccc8', legs: '#d7ccc8', boot: '#bcaaa4', belt: '#5d4037', eyes: '#ff1744', weapon: 'rusty', thin: true, shield: '#6d4c41', headwear: 'none' });
      return m;
    }
    case 'imp': return buildImp();
    case 'golem': return buildGolem();
  }
  return buildSlime();
}

function buildSlime() {
  const { M, list } = makeMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const jelly = mesh(sphere(0.62, 1), M('#66d17a', { transparent: true, opacity: 0.88, emissive: '#1b5e20', emissiveIntensity: 0.25 }), 0, 0.55, 0);
  jelly.scale.set(1, 0.82, 1);
  body.add(jelly);
  body.add(mesh(sphere(0.25, 0), M('#a5f2b3', { transparent: true, opacity: 0.6 }), -0.2, 0.85, 0.2));
  const eye = M('#102010');
  body.add(mesh(sphere(0.08, 0), eye, -0.18, 0.66, 0.52));
  body.add(mesh(sphere(0.08, 0), eye, 0.18, 0.66, 0.52));
  return { root, body, mats: list, kind: 'slime', height: 1.4, parts: { jelly } };
}

function buildWolf() {
  const { M, list } = makeMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fur = M('#8d9096'), dark = M('#5f6368'), light = M('#c5c7cc');
  body.add(mesh(box(0.55, 0.5, 1.15), fur, 0, 0.78, 0));
  body.add(mesh(box(0.5, 0.18, 1.0), dark, 0, 1.06, -0.03));
  const head = pivot(body, 0, 0.98, 0.62);
  head.add(mesh(box(0.42, 0.4, 0.42), fur, 0, 0.02, 0.12));
  head.add(mesh(box(0.24, 0.2, 0.32), light, 0, -0.06, 0.44));
  head.add(mesh(box(0.1, 0.08, 0.06), M('#222'), 0, 0.0, 0.6));
  const eye = M('#ffd54f', { emissive: '#ffb300', emissiveIntensity: 0.9 });
  head.add(mesh(box(0.07, 0.06, 0.02), eye, -0.11, 0.1, 0.34));
  head.add(mesh(box(0.07, 0.06, 0.02), eye, 0.11, 0.1, 0.34));
  head.add(mesh(cone(0.08, 0.2, 4), dark, -0.13, 0.3, 0.05));
  head.add(mesh(cone(0.08, 0.2, 4), dark, 0.13, 0.3, 0.05));
  const tail = pivot(body, 0, 0.95, -0.58);
  const tm = mesh(box(0.14, 0.14, 0.55), dark, 0, 0, -0.25);
  tail.add(tm);
  tail.rotation.x = 0.5;
  const legs = [];
  for (const [x, z] of [[-0.18, 0.4], [0.18, 0.4], [-0.18, -0.4], [0.18, -0.4]]) {
    const l = pivot(body, x, 0.6, z);
    l.add(mesh(box(0.15, 0.6, 0.16), fur, 0, -0.28, 0));
    legs.push(l);
  }
  return { root, body, mats: list, kind: 'wolf', height: 1.5, parts: { head, tail, legs } };
}

function buildImp() {
  const { M, list } = makeMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const red = M('#d84315', { emissive: '#bf360c', emissiveIntensity: 0.3 });
  const dark = M('#4e1a0a');
  body.add(mesh(sphere(0.38, 0), red, 0, 1.2, 0));
  const head = pivot(body, 0, 1.65, 0.05);
  head.add(mesh(sphere(0.28, 0), red, 0, 0, 0));
  const eye = M('#ffee58', { emissive: '#ffee58', emissiveIntensity: 1 });
  head.add(mesh(box(0.08, 0.05, 0.02), eye, -0.1, 0.03, 0.25));
  head.add(mesh(box(0.08, 0.05, 0.02), eye, 0.1, 0.03, 0.25));
  const hl = mesh(cone(0.06, 0.28, 4), dark, -0.14, 0.28, 0); hl.rotation.z = 0.35; head.add(hl);
  const hr = mesh(cone(0.06, 0.28, 4), dark, 0.14, 0.28, 0); hr.rotation.z = -0.35; head.add(hr);
  const wingM = M('#6d1b0a', { side: THREE.DoubleSide });
  const wl = pivot(body, -0.25, 1.35, -0.22);
  wl.add(mesh(box(0.7, 0.45, 0.03), wingM, -0.35, 0.1, 0));
  const wr = pivot(body, 0.25, 1.35, -0.22);
  wr.add(mesh(box(0.7, 0.45, 0.03), wingM, 0.35, 0.1, 0));
  const orb = mesh(sphere(0.16, 0), M('#ffca28', { emissive: '#ff9100', emissiveIntensity: 1.2 }), 0.42, 1.15, 0.25);
  orb.userData.keep = true;
  body.add(orb);
  const tail = mesh(cone(0.06, 0.6, 4), dark, 0, 0.85, -0.3);
  tail.rotation.x = -2.4;
  body.add(tail);
  return { root, body, mats: list, kind: 'imp', height: 2.2, parts: { head, wl, wr, orb } };
}

function buildGolem() {
  const { M, list } = makeMats();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rock = M('#6d6875'), rock2 = M('#4a4552'), moss = M('#5b7553');
  const core = M('#4dd0e1', { emissive: '#00e5ff', emissiveIntensity: 1.2 });
  const torso = mesh(sphere(0.62, 0), rock, 0, 1.35, 0);
  torso.scale.set(1.2, 1, 0.9);
  body.add(torso);
  body.add(mesh(sphere(0.3, 0), moss, 0.2, 1.85, -0.1));
  body.add(mesh(box(0.22, 0.22, 0.1), core, 0, 1.4, 0.55));
  const head = pivot(body, 0, 2.0, 0.1);
  head.add(mesh(box(0.42, 0.34, 0.4), rock2, 0, 0.1, 0));
  head.add(mesh(box(0.28, 0.06, 0.02), core, 0, 0.12, 0.21));
  const armL = pivot(body, -0.85, 1.7, 0);
  const armR = pivot(body, 0.85, 1.7, 0);
  for (const a of [armL, armR]) {
    a.add(mesh(sphere(0.3, 0), rock2, 0, 0, 0));
    a.add(mesh(box(0.38, 0.7, 0.38), rock, 0, -0.5, 0));
    a.add(mesh(sphere(0.32, 0), rock2, 0, -1.0, 0.05));
  }
  const legL = pivot(body, -0.35, 0.75, 0);
  const legR = pivot(body, 0.35, 0.75, 0);
  for (const l of [legL, legR]) l.add(mesh(box(0.42, 0.75, 0.45), rock2, 0, -0.38, 0));
  for (let i = 0; i < 5; i++) {
    const c = mesh(cone(0.08, 0.35, 4), core, (Math.random() - 0.5) * 0.8, 1.75 + Math.random() * 0.2, -0.35 - Math.random() * 0.1);
    c.rotation.x = -0.5;
    body.add(c);
  }
  root.scale.setScalar(1.75);
  return { root, body, mats: list, kind: 'golem', height: 4.6, parts: { head, armL, armR, legL, legR } };
}

export function animateModel(m, st) {
  if (m.kind === 'humanoid') return animateHumanoid(m, st);
  const t = st.t;
  if (m.kind === 'slime') {
    const hop = st.move > 0.1 ? Math.abs(Math.sin(t * 7)) : 0;
    const sq = Math.sin(t * (st.move > 0.1 ? 14 : 4)) * 0.08;
    m.body.position.y = hop * 0.45;
    m.body.scale.set(1 + sq, 1 - sq, 1 + sq);
    if (st.atk >= 0 && st.atk < 1) {
      const k = Math.sin(st.atk * Math.PI);
      m.body.scale.set(1 + k * 0.25, 1 - k * 0.3, 1 + k * 0.25);
      m.body.position.z = k * 0.4;
    } else m.body.position.z = 0;
  } else if (m.kind === 'wolf') {
    const w = Math.sin(t * 13) * st.move;
    const [fl, fr, bl, br] = m.parts.legs;
    fl.rotation.x = w * 0.8; br.rotation.x = w * 0.8;
    fr.rotation.x = -w * 0.8; bl.rotation.x = -w * 0.8;
    m.parts.tail.rotation.y = Math.sin(t * 6) * 0.4;
    m.body.position.y = Math.abs(Math.sin(t * 13)) * 0.06 * st.move;
    if (st.atk >= 0 && st.atk < 1) {
      const k = Math.sin(st.atk * Math.PI);
      m.parts.head.rotation.x = -0.4 * k;
      m.body.position.z = k * 0.45;
    } else { m.parts.head.rotation.x = 0; m.body.position.z = 0; }
  } else if (m.kind === 'imp') {
    m.body.position.y = 0.4 + Math.sin(t * 3) * 0.15;
    m.parts.wl.rotation.y = Math.sin(t * 16) * 0.5;
    m.parts.wr.rotation.y = -Math.sin(t * 16) * 0.5;
    if (st.atk >= 0 && st.atk < 1) m.parts.orb.scale.setScalar(1 + Math.sin(st.atk * Math.PI) * 0.8);
    else m.parts.orb.scale.setScalar(1);
  } else if (m.kind === 'golem') {
    const w = Math.sin(t * 5) * st.move;
    const { armL, armR, legL, legR } = m.parts;
    legL.rotation.x = w * 0.5; legR.rotation.x = -w * 0.5;
    armL.rotation.x = -w * 0.35; armR.rotation.x = w * 0.35;
    m.body.position.y = Math.abs(Math.sin(t * 5)) * 0.06 * st.move;
    if (st.atk >= 0 && st.atk < 1) {
      const p = st.atk;
      const k = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;
      armL.rotation.x = -2.8 * k; armR.rotation.x = -2.8 * k;
    }
  }
}
