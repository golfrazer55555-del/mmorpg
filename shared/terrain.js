// 결정론적 지형/지역/장식물 생성 (서버/클라이언트 공용)
import { WORLD, ZONES, NPCS } from './data.js';

export const SEED = 20261112;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed, oct = 4) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f, z * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function zoneAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < WORLD.townRadius) return 'town';
  const n = fbm(x * 0.012, z * 0.012, SEED + 5, 2) - 0.5;
  if (r + n * 30 < 96) return 'meadow';
  const a = Math.atan2(z, x) + n * 0.8;
  const q = Math.PI / 4;
  const an = Math.atan2(Math.sin(a), Math.cos(a));
  if (an > -q && an <= q) return 'highland';      // 동쪽 (+x)
  if (an > q && an <= 3 * q) return 'graveyard';  // 남쪽 (+z)
  if (an > -3 * q && an <= -q) return 'forest';   // 북쪽 (-z)
  return 'volcano';                               // 서쪽 (-x)
}

export function zoneInfo(x, z) {
  const id = zoneAt(x, z);
  return { id, ...ZONES[id] };
}

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const rough = 0.3 + 0.9 * smoothstep(40, 150, r);
  let b = (fbm(x * 0.016, z * 0.016, SEED, 4) - 0.5) * 16 * rough;
  b += (fbm(x * 0.07, z * 0.07, SEED + 31, 2) - 0.5) * 1.6 * rough;
  let h = (b > 0 ? b : b * 0.12) + 0.3;

  // 마을 평탄화
  const t = smoothstep(WORLD.townRadius + 14, WORLD.townRadius - 6, r);
  h = h * (1 - t) + 0.25 * t;

  // 호수
  const L = WORLD.lake;
  const ld = Math.hypot(x - L.x, z - L.z);
  if (ld < L.r + 10) {
    const k = smoothstep(L.r + 10, L.r - 6, ld);
    h = h * (1 - k) + -3.6 * k;
  }

  // 보스 투기장
  const B = WORLD.boss;
  const bd = Math.hypot(x - B.x, z - B.z);
  if (bd < B.r + 10) {
    const k = smoothstep(B.r + 10, B.r - 3, bd);
    h = h * (1 - k) + 1.0 * k;
  }

  // 길 (도로 주변 살짝 평탄화)
  const roadD = Math.min(Math.abs(x), Math.abs(z));
  if (roadD < 5 && r < 150) {
    const k = smoothstep(5, 1.5, roadD) * 0.6;
    h = h * (1 - k) + Math.min(h, 1.2) * k;
  }

  // 외곽 산맥
  if (r > 176) {
    const e = Math.min(1.8, (r - 176) / 22);
    h += e * e * 14 + fbm(x * 0.05, z * 0.05, SEED + 9, 2) * e * 8;
  }
  return h;
}

export function isRoad(x, z) {
  const r = Math.hypot(x, z);
  if (r > 150) return false;
  const w = 2.6 + (fbm(x * 0.1, z * 0.1, SEED + 3, 1) - 0.5) * 1.2;
  return Math.abs(x) < w || Math.abs(z) < w;
}

export function isWalkable(x, z) {
  const r = Math.hypot(x, z);
  if (r > WORLD.playRadius) return false;
  return heightAt(x, z) > WORLD.waterLevel - 0.7;
}

export function inTown(x, z, pad = 0) {
  return Math.hypot(x, z) < WORLD.townRadius + pad;
}

// ---- 마을 건물 ----
export const BUILDINGS = (() => {
  const list = [];
  const houses = [
    [18, -19], [-18, -19], [20, 18], [-20, 18], [9, -26], [-25, -6], [26, -6], [-8, 26],
  ];
  const roofColors = ['#b23a3a', '#3a6ab2', '#3a8f5a', '#8a5a2b', '#7a3ab2', '#b2733a', '#2f8f8f', '#a33a6a'];
  houses.forEach(([x, z], i) => {
    list.push({ kind: 'house', x, z, w: 6.5, d: 5.5, h: 3.6, ry: Math.atan2(-x, -z), roof: roofColors[i % roofColors.length], r: 3.9 });
  });
  list.push({ kind: 'fountain', x: 0, z: 0, r: 3.4 });
  list.push({ kind: 'stall', x: 15.5, z: 5, ry: -Math.PI / 2, r: 1.8 });
  list.push({ kind: 'altar', x: -15.5, z: 5, ry: Math.PI / 2, r: 1.6 });
  list.push({ kind: 'board', x: 0, z: -15.5, ry: 0, r: 1.2 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    list.push({ kind: 'lamp', x: Math.cos(a) * 8.5, z: Math.sin(a) * 8.5, r: 0.35 });
  }
  return list;
})();

export const ARCHES = [
  { x: WORLD.townRadius, z: 0, ry: Math.PI / 2 },
  { x: -WORLD.townRadius, z: 0, ry: Math.PI / 2 },
  { x: 0, z: WORLD.townRadius, ry: 0 },
  { x: 0, z: -WORLD.townRadius, ry: 0 },
];

// ---- 자연 장식물 ----
let _decoCache = null;
export function generateDecorations() {
  if (_decoCache) return _decoCache;
  const rng = mulberry32(SEED * 7 + 3);
  const out = { tree: [], pine: [], deadtree: [], rock: [], tomb: [], tent: [], crystal: [], bush: [], flower: [], lava: [], darkrock: [] };
  const B = WORLD.boss;
  const nearNpcOrBuilding = (x, z) => BUILDINGS.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 2.5) ||
    NPCS.some((n) => Math.hypot(n.x - x, n.z - z) < 3);

  for (let i = 0; i < 5200; i++) {
    const x = (rng() * 2 - 1) * 208, z = (rng() * 2 - 1) * 208;
    const r = Math.hypot(x, z);
    const roll = rng();
    const s = 0.75 + rng() * 0.6;
    const ry = rng() * Math.PI * 2;
    const c = rng();
    if (r > 215) continue;
    const h = heightAt(x, z);
    if (h < WORLD.waterLevel + 0.4) continue;

    // 외곽 산
    if (r > WORLD.playRadius - 4) {
      if (roll < 0.45) out.pine.push({ x, z, s: s * 1.3, ry, c, solid: false });
      else if (roll < 0.6) out.rock.push({ x, z, s: s * 2.2, ry, c, solid: false });
      continue;
    }
    if (r < WORLD.townRadius + 3) {
      if (r > 12 && roll < 0.04 && !nearNpcOrBuilding(x, z) && !isRoad(x, z)) out.flower.push({ x, z, s, ry, c });
      continue;
    }
    if (isRoad(x, z)) continue;
    if (Math.hypot(x - B.x, z - B.z) < B.r + 3) continue;

    const zone = zoneAt(x, z);
    const n = fbm(x * 0.03, z * 0.03, SEED + 77, 2);
    switch (zone) {
      case 'meadow':
        if (n > 0.56 && roll < 0.55) out.tree.push({ x, z, s, ry, c, solid: true });
        else if (roll < 0.06) out.bush.push({ x, z, s, ry, c });
        else if (roll < 0.14) out.flower.push({ x, z, s, ry, c });
        else if (roll < 0.165) out.rock.push({ x, z, s: s * 0.8, ry, c, solid: true });
        break;
      case 'forest':
        if (roll < (n > 0.45 ? 0.62 : 0.22)) out.pine.push({ x, z, s: s * 1.1, ry, c, solid: true });
        else if (roll < 0.7) out.bush.push({ x, z, s, ry, c });
        else if (roll < 0.74) out.rock.push({ x, z, s, ry, c, solid: true });
        break;
      case 'highland':
        if (roll < 0.11) out.rock.push({ x, z, s: s * 1.4, ry, c, solid: true });
        else if (roll < 0.15 && n > 0.5) out.tree.push({ x, z, s: s * 0.9, ry, c, solid: true });
        else if (roll < 0.18) out.bush.push({ x, z, s, ry, c });
        break;
      case 'graveyard':
        if (roll < 0.1) out.tomb.push({ x, z, s, ry: Math.round(ry / 1.57) * 1.57 + (rng() - 0.5) * 0.3, c, solid: true });
        else if (roll < 0.17) out.deadtree.push({ x, z, s, ry, c, solid: true });
        else if (roll < 0.2) out.rock.push({ x, z, s, ry, c, solid: true });
        break;
      case 'volcano':
        if (roll < 0.09) out.darkrock.push({ x, z, s: s * 1.4, ry, c, solid: true });
        else if (roll < 0.12) out.crystal.push({ x, z, s, ry, c, solid: true });
        else if (roll < 0.135 && n < 0.45) out.lava.push({ x, z, s: s * 2.2, ry, c });
        else if (roll < 0.15) out.deadtree.push({ x, z, s: s * 0.8, ry, c, solid: true });
        break;
    }
  }

  // 고블린 야영지 천막
  const camp = { x: 138, z: -8 };
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = camp.x + Math.cos(a) * 11, z = camp.z + Math.sin(a) * 11;
    out.tent.push({ x, z, s: 1, ry: -a + Math.PI / 2, c: rng(), solid: true });
  }
  // 보스 투기장 돌기둥
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.darkrock.push({ x: B.x + Math.cos(a) * (B.r + 1.5), z: B.z + Math.sin(a) * (B.r + 1.5), s: 2.0, ry: a, c: 0.5, solid: true, pillar: true });
  }
  _decoCache = out;
  return out;
}

const COLLIDER_R = { tree: 0.55, pine: 0.55, deadtree: 0.45, rock: 0.9, darkrock: 1.0, tomb: 0.55, tent: 2.0, crystal: 0.6 };

// ---- 충돌 그리드 ----
let _grid = null;
const CELL = 8;
export function getColliderGrid() {
  if (_grid) return _grid;
  const grid = new Map();
  const add = (x, z, r) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const key = cx + ',' + cz;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ x, z, r });
  };
  const deco = generateDecorations();
  for (const kind of Object.keys(COLLIDER_R)) {
    for (const d of deco[kind]) if (d.solid) add(d.x, d.z, COLLIDER_R[kind] * (d.pillar ? 1.6 : d.s));
  }
  for (const b of BUILDINGS) add(b.x, b.z, b.r);
  for (const a of ARCHES) {
    const ox = a.ry === 0 ? 3.2 : 0, oz = a.ry === 0 ? 0 : 3.2;
    add(a.x + ox, a.z + oz, 0.5); add(a.x - ox, a.z - oz, 0.5);
  }
  _grid = grid;
  return grid;
}

export function resolveCollision(x, z, radius = 0.45) {
  const grid = getColliderGrid();
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const cell = grid.get((cx + i) + ',' + (cz + j));
      if (!cell) continue;
      for (const c of cell) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-5) {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
    }
  }
  return { x, z };
}

// ---- 몬스터 스폰 지점 ----
export function generateSpawns() {
  const rng = mulberry32(SEED + 4242);
  const spawns = [];
  for (const [zoneId, z] of Object.entries(ZONES)) {
    if (!z.monster) continue;
    let placed = 0, tries = 0;
    while (placed < z.count && tries < 20000) {
      tries++;
      const x = (rng() * 2 - 1) * 185, zz = (rng() * 2 - 1) * 185;
      if (zoneAt(x, zz) !== zoneId) continue;
      if (Math.hypot(x, zz) < WORLD.townRadius + 14) continue;
      if (Math.hypot(x, zz) > WORLD.playRadius - 12) continue;
      if (!isWalkable(x, zz)) continue;
      if (Math.hypot(x - WORLD.boss.x, zz - WORLD.boss.z) < WORLD.boss.r + 12) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.z - zz) < 7)) continue;
      spawns.push({ type: z.monster, x, z: zz });
      placed++;
    }
  }
  spawns.push({ type: 'golem', x: WORLD.boss.x, z: WORLD.boss.z });
  return spawns;
}
