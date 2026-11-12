// 3D 월드 생성: 지형, 하늘, 물, 마을, 자연물
import * as THREE from 'three';
import { WORLD, NPCS } from '../shared/data.js';
import { heightAt, zoneAt, isRoad, generateDecorations, BUILDINGS, ARCHES, fbm, SEED } from '../shared/terrain.js';
import { mergeStatic } from './merge.js';

export const ZONE_GROUND = {
  town: '#86b956', meadow: '#74b84a', forest: '#3d7a45', highland: '#b08a55', graveyard: '#5d5a6e', volcano: '#4a3734',
};

const AMBIENCE = {
  town: { fog: '#c4dcf2', top: '#4f8fe0', horizon: '#cfe5ff', hs: '#d6ebff', hg: '#6b7a45', sun: '#fff2dc', si: 1.7 },
  meadow: { fog: '#c4dcf2', top: '#4f8fe0', horizon: '#cfe5ff', hs: '#d6ebff', hg: '#6b7a45', sun: '#fff2dc', si: 1.7 },
  forest: { fog: '#a9c7bb', top: '#4a7fb0', horizon: '#bcd9cf', hs: '#c8e6d8', hg: '#35502f', sun: '#f0f5dc', si: 1.4 },
  highland: { fog: '#e6cfa6', top: '#5f8fd0', horizon: '#f2dcb4', hs: '#ffeacc', hg: '#7a5a35', sun: '#ffe2b0', si: 1.8 },
  graveyard: { fog: '#5f5a80', top: '#2b2850', horizon: '#6e6894', hs: '#9a92c8', hg: '#2a2838', sun: '#b8b0ee', si: 0.9 },
  volcano: { fog: '#7d4636', top: '#3a1c18', horizon: '#a8553a', hs: '#ffb48a', hg: '#3a1a10', sun: '#ffb27a', si: 1.3 },
};

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
export { isMobile };

function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

export function createWorld(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high' || (!isMobile && quality !== 'low'), powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 480);

  const amb = AMBIENCE.town;
  scene.fog = new THREE.Fog(amb.fog, 55, 175);
  const hemi = new THREE.HemisphereLight(amb.hs, amb.hg, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(amb.sun, amb.si);
  sun.position.set(40, 70, 25);
  scene.add(sun);
  scene.add(sun.target);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;

  // ---- 하늘 ----
  const skyUniforms = { top: { value: new THREE.Color(amb.top) }, horizon: { value: new THREE.Color(amb.horizon) } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(440, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // 거대한 달 (엘더문)
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(26, 2), new THREE.MeshBasicMaterial({ color: '#f4f1ff', fog: false, transparent: true, opacity: 0.9 }));
  moon.position.set(-160, 170, -300);
  scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bcc8ff', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  moonHalo.scale.setScalar(120);
  moonHalo.position.copy(moon.position);
  scene.add(moonHalo);

  // ---- 지형 ----
  const terrain = buildTerrain();
  scene.add(terrain);

  // ---- 호수 ----
  const L = WORLD.lake;
  const waterGeo = new THREE.CircleGeometry(L.r + 12, 48, 0, Math.PI * 2);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({ color: '#2f86c9', transparent: true, opacity: 0.8, shininess: 110, specular: '#bfe3ff', flatShading: true }));
  water.position.set(L.x, WORLD.waterLevel, L.z);
  scene.add(water);
  const waterBase = waterGeo.attributes.position.array.slice();

  // ---- 장식물 / 마을 ----
  const anim = { lava: null, flames: [], crystal: null, clouds: null };
  buildDecorations(scene, anim);
  const townRoot = new THREE.Group();
  buildTown(townRoot, anim);
  scene.add(townRoot);
  scene.add(mergeStatic(townRoot));
  buildClouds(scene, anim);

  const ambCur = {
    fog: new THREE.Color(amb.fog), top: new THREE.Color(amb.top), horizon: new THREE.Color(amb.horizon),
    hs: new THREE.Color(amb.hs), hg: new THREE.Color(amb.hg), sun: new THREE.Color(amb.sun), si: amb.si,
  };
  const tmpC = new THREE.Color();
  let occT = 0;

  function setQuality(q) {
    const pr = q === 'low' ? 1 : q === 'medium' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const shadows = q === 'high';
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = shadows;
    if (shadows) sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    scene.fog.far = q === 'low' ? 120 : 175;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  setQuality(quality);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function update(dt, t, focus, zone) {
    // 분위기 보간
    const a = AMBIENCE[zone] || AMBIENCE.town;
    const k = 1 - Math.exp(-dt * 1.2);
    ambCur.fog.lerp(tmpC.set(a.fog), k);
    ambCur.top.lerp(tmpC.set(a.top), k);
    ambCur.horizon.lerp(tmpC.set(a.horizon), k);
    ambCur.hs.lerp(tmpC.set(a.hs), k);
    ambCur.hg.lerp(tmpC.set(a.hg), k);
    ambCur.sun.lerp(tmpC.set(a.sun), k);
    ambCur.si += (a.si - ambCur.si) * k;
    scene.fog.color.copy(ambCur.fog);
    skyUniforms.top.value.copy(ambCur.top);
    skyUniforms.horizon.value.copy(ambCur.horizon);
    hemi.color.copy(ambCur.hs);
    hemi.groundColor.copy(ambCur.hg);
    sun.color.copy(ambCur.sun);
    sun.intensity = ambCur.si;

    occT += dt;
    if (occT > 0.08) { occT = 0; updateOcclusion(camera.position, focus); }
    sky.position.copy(camera.position);
    moon.position.set(camera.position.x - 160, 170, camera.position.z - 300);
    moonHalo.position.copy(moon.position);
    sun.position.set(focus.x + 40, focus.y + 70, focus.z + 25);
    sun.target.position.copy(focus);

    // 물결
    const pos = waterGeo.attributes.position;
    if (Math.hypot(focus.x - L.x, focus.z - L.z) < 110) {
      for (let i = 0; i < pos.count; i++) {
        const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
        pos.array[i * 3 + 1] = Math.sin(x * 0.6 + t * 1.6) * 0.07 + Math.cos(z * 0.5 + t * 1.3) * 0.07;
      }
      pos.needsUpdate = true;
    }
    if (anim.lava) anim.lava.material.emissiveIntensity = 0.85 + Math.sin(t * 2.2) * 0.25;
    for (const f of anim.flames) { f.scale.y = 1 + Math.sin(t * 13 + f.position.x) * 0.25; f.rotation.y = t * 2; }
    if (anim.crystal) { anim.crystal.rotation.y = t * 0.6; anim.crystal.position.y = 4.4 + Math.sin(t * 1.4) * 0.25; }
    if (anim.clouds) anim.clouds.position.x = ((t * 1.2) % 120) - 60;
  }

  return { renderer, scene, camera, sun, setQuality, resize, update };
}

export function glowTexture() {
  if (glowTexture.tex) return glowTexture.tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTexture.tex = new THREE.CanvasTexture(c);
  return glowTexture.tex;
}

function buildTerrain() {
  const SEG = 176;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  const sand = new THREE.Color('#d9c68f'), road = new THREE.Color('#a68a5f'), stone = new THREE.Color('#b9b3a6');
  const rock = new THREE.Color('#7c7470'), snow = new THREE.Color('#f2f4fa');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const r = Math.hypot(x, z);
    const zone = zoneAt(x, z);
    c.set(ZONE_GROUND[zone]);
    const n = fbm(x * 0.08, z * 0.08, SEED + 11, 2);
    c.multiplyScalar(0.86 + n * 0.28);
    if (zone === 'graveyard' && n > 0.62) c.lerp(tmp.set('#3e3b4d'), 0.5);
    if (zone === 'volcano' && n > 0.66) c.lerp(tmp.set('#8a3a1c'), 0.45);
    if (zone === 'highland' && n < 0.35) c.lerp(tmp.set('#8a7a4a'), 0.4);
    if (r < 11.5) c.copy(stone).multiplyScalar(0.92 + n * 0.16);
    else if (isRoad(x, z) && r > 3) c.lerp(road, zone === 'town' ? 0.9 : 0.7);
    if (h < WORLD.waterLevel + 0.6 && Math.hypot(x - WORLD.lake.x, z - WORLD.lake.z) < WORLD.lake.r + 12) c.lerp(sand, 0.8);
    if (r > 182) c.lerp(rock, Math.min(1, (r - 182) / 10));
    if (h > 26) c.lerp(snow, Math.min(1, (h - 26) / 6));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// 인스턴스 메시 헬퍼: items 각각의 변환 * local 변환
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function instanced(scene, geometry, material, items, local, opts = {}) {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geometry, material, items.length);
  const color = new THREE.Color();
  items.forEach((d, i) => {
    const y = d.y !== undefined ? d.y : heightAt(d.x, d.z) - (opts.sink ?? 0.1);
    const sy = opts.sy ? opts.sy(d) : 1;
    _p.set(d.x, y, d.z);
    _q.setFromEuler(_e.set(opts.tilt ? (d.c - 0.5) * 0.25 : 0, d.ry, 0));
    _s.set(d.s, d.s * sy, d.s);
    _m.compose(_p, _q, _s);
    if (local) _m.multiply(local);
    im.setMatrixAt(i, _m);
    if (opts.colors) {
      color.set(opts.colors[Math.floor(d.c * opts.colors.length) % opts.colors.length]);
      if (opts.vary) color.multiplyScalar(1 - opts.vary / 2 + d.c * opts.vary);
      im.setColorAt(i, color);
    }
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  if (opts.occlude) occluders.push({ im, items, orig: im.instanceMatrix.array.slice(), hidden: new Uint8Array(items.length), h: opts.occlude });
  im.castShadow = opts.shadow !== false;
  im.receiveShadow = false;
  scene.add(im);
  return im;
}

// 카메라와 캐릭터 사이를 가리는 나무는 숨긴다
const occluders = [];
const ZERO = new Float32Array(16);
function updateOcclusion(cam, focus) {
  const ax = cam.x, az = cam.z, bx = focus.x, bz = focus.z;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  for (const o of occluders) {
    let changed = false;
    const arr = o.im.instanceMatrix.array;
    for (let i = 0; i < o.items.length; i++) {
      const d = o.items[i];
      let hide = false;
      if (Math.abs(d.x - ax) < 30 && Math.abs(d.z - az) < 30) {
        const t = ((d.x - ax) * dx + (d.z - az) * dz) / len2;
        if (t > -0.15 && t < 0.96) {
          const px = ax + dx * Math.max(0, t), pz = az + dz * Math.max(0, t);
          const dist = Math.hypot(d.x - px, d.z - pz);
          const rayY = cam.y + (focus.y - cam.y) * Math.max(0, t);
          hide = dist < 1.6 * d.s + 0.6 && rayY < heightAt(d.x, d.z) + o.h * d.s;
        }
      }
      if (hide !== !!o.hidden[i]) {
        o.hidden[i] = hide ? 1 : 0;
        if (hide) arr.set(ZERO, i * 16); else arr.set(o.orig.subarray(i * 16, i * 16 + 16), i * 16);
        changed = true;
      }
    }
    if (changed) o.im.instanceMatrix.needsUpdate = true;
  }
}

const L = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function buildDecorations(scene, anim) {
  const D = generateDecorations();
  const white = lambert('#ffffff');
  const trunkM = lambert('#6d4c41');
  // 활엽수
  instanced(scene, new THREE.CylinderGeometry(0.17, 0.26, 1.8, 5), trunkM, D.tree, L(0, 0.9, 0), { occlude: 4.4 });
  instanced(scene, new THREE.IcosahedronGeometry(1.35, 0), white, D.tree, L(0, 2.6, 0), { colors: ['#4caf50', '#43a047', '#66bb6a', '#7cb342', '#9ccc65'], vary: 0.2, occlude: 4.4 });
  instanced(scene, new THREE.IcosahedronGeometry(0.95, 0), white, D.tree, L(0.35, 3.45, 0.1), { colors: ['#66bb6a', '#7cb342', '#8bc34a'], vary: 0.2, occlude: 4.4 });
  // 침엽수
  const pines = D.pine.filter((d) => d.solid);
  const farPines = D.pine.filter((d) => !d.solid);
  for (const [list, occ] of [[pines, 4.6], [farPines, 0]]) {
    const o = occ ? { occlude: occ } : {};
    instanced(scene, new THREE.CylinderGeometry(0.15, 0.22, 1.4, 5), trunkM, list, L(0, 0.7, 0), o);
    instanced(scene, new THREE.ConeGeometry(1.5, 2.4, 6), white, list, L(0, 2.2, 0), { colors: ['#2e7d32', '#1b5e20', '#33691e', '#2f6b3a'], vary: 0.25, ...o });
    instanced(scene, new THREE.ConeGeometry(1.05, 1.9, 6), white, list, L(0, 3.5, 0), { colors: ['#388e3c', '#2e7d32', '#3a7d44'], vary: 0.25, ...o });
  }
  // 고목
  const deadM = lambert('#4e3b36');
  instanced(scene, new THREE.CylinderGeometry(0.12, 0.24, 2.8, 5), deadM, D.deadtree, L(0, 1.4, 0), { occlude: 3.2 });
  instanced(scene, new THREE.CylinderGeometry(0.05, 0.09, 1.3, 4), deadM, D.deadtree, L(0.45, 2.1, 0, 0, 0, -0.9), { occlude: 3.2 });
  instanced(scene, new THREE.CylinderGeometry(0.05, 0.08, 1.0, 4), deadM, D.deadtree, L(-0.35, 2.5, 0.1, 0.2, 0, 0.8), { occlude: 3.2 });
  // 바위
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  instanced(scene, rockGeo, white, D.rock, L(0, 0.35, 0, 0, 0, 0, 1, 0.7, 1), { colors: ['#9e9e9e', '#8d8d8d', '#a1a1a1', '#8a8178'], vary: 0.25, tilt: true });
  instanced(scene, rockGeo, white, D.darkrock, L(0, 0.5, 0), { colors: ['#3a3333', '#4a3f3c', '#2f2a2a'], vary: 0.3, tilt: true, sy: (d) => (d.pillar ? 2.4 : 0.75) });
  // 덤불, 꽃
  instanced(scene, new THREE.IcosahedronGeometry(0.6, 0), white, D.bush, L(0, 0.35, 0, 0, 0, 0, 1.2, 0.8, 1.2), { colors: ['#558b2f', '#689f38', '#4b7f2a'], vary: 0.25 });
  instanced(scene, new THREE.IcosahedronGeometry(0.14, 0), white, D.flower, L(0, 0.22, 0), { colors: ['#ff5c8a', '#ffd54f', '#ffffff', '#b388ff', '#ff8a65'], shadow: false });
  instanced(scene, new THREE.IcosahedronGeometry(0.12, 0), white, D.flower, L(0.3, 0.18, 0.2), { colors: ['#ffffff', '#ff5c8a', '#ffd54f'], shadow: false });
  // 묘비
  instanced(scene, new THREE.BoxGeometry(0.7, 1.0, 0.22), white, D.tomb, L(0, 0.45, 0), { colors: ['#8e8aa0', '#7d7990', '#a09cb0'], vary: 0.2, tilt: true });
  instanced(scene, new THREE.BoxGeometry(0.22, 0.6, 0.18), white, D.tomb, L(0, 1.15, 0), { colors: ['#8e8aa0', '#7d7990'], vary: 0.2, tilt: true });
  // 천막
  instanced(scene, new THREE.ConeGeometry(2.2, 2.8, 5), white, D.tent, L(0, 1.4, 0), { colors: ['#8d5a2b', '#a0522d', '#7b4a2a'], vary: 0.2 });
  // 수정
  const crystal = instanced(scene, new THREE.OctahedronGeometry(0.55, 0), lambert('#ffffff', { emissive: '#ff6a3a', emissiveIntensity: 0.6 }), D.crystal, L(0, 0.75, 0, 0, 0, 0, 0.7, 1.8, 0.7), { colors: ['#ff7043', '#ff8a65', '#e64a19'] });
  if (crystal) crystal.castShadow = false;
  // 용암 웅덩이
  const lavaGeo = new THREE.CircleGeometry(1.2, 9);
  lavaGeo.rotateX(-Math.PI / 2);
  anim.lava = instanced(scene, lavaGeo, lambert('#ff5722', { emissive: '#ff3d00', emissiveIntensity: 0.9 }), D.lava.map((d) => ({ ...d, y: heightAt(d.x, d.z) + 0.12 })), null, { shadow: false });

  // 고블린 야영지 모닥불
  const fireAt = (x, z) => {
    const y = heightAt(x, z);
    const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 5), lambert('#5d4037'));
    logs.rotation.z = Math.PI / 2; logs.position.set(x, y + 0.15, z); scene.add(logs);
    const logs2 = logs.clone(); logs2.rotation.y = Math.PI / 2; scene.add(logs2);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 5), new THREE.MeshBasicMaterial({ color: '#ffab40', transparent: true, opacity: 0.9 }));
    f.position.set(x, y + 0.8, z);
    scene.add(f);
    anim.flames.push(f);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9100', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(5); glow.position.set(x, y + 1, z);
    scene.add(glow);
  };
  fireAt(138, -8);
}

function buildTown(scene, anim) {
  const wallM = lambert('#efe3c8'), woodM = lambert('#7a5236'), darkWood = lambert('#4e342e');
  const stoneM = lambert('#b0a999'), stoneDark = lambert('#8a8478');
  const windowM = lambert('#ffd97a', { emissive: '#ffb300', emissiveIntensity: 0.6 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(11.3, 32), lambert('#b9b3a6'));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.27; plaza.receiveShadow = true;
  scene.add(plaza);
  const ring = new THREE.Mesh(new THREE.RingGeometry(11.3, 12, 32), lambert('#8a8478'));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.28;
  scene.add(ring);

  const add = (g, m, x, y, z, parent = scene) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true; o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  for (const b of BUILDINGS) {
    const grp = new THREE.Group();
    grp.position.set(b.x, heightAt(b.x, b.z), b.z);
    grp.rotation.y = b.ry || 0;
    scene.add(grp);
    if (b.kind === 'house') {
      add(new THREE.BoxGeometry(b.w, b.h, b.d), wallM, 0, b.h / 2, 0, grp);
      add(new THREE.BoxGeometry(b.w + 0.1, 0.25, b.d + 0.1), woodM, 0, 0.12, 0, grp);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.28, b.h, 0.28), woodM, sx * (b.w / 2), b.h / 2, sz * (b.d / 2), grp);
      const roof = add(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.78, 2.6, 4), lambert(b.roof), 0, b.h + 1.3, 0, grp);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, b.d / b.w);
      add(new THREE.BoxGeometry(1.3, 2.1, 0.12), darkWood, 0, 1.05, b.d / 2 + 0.02, grp);
      add(new THREE.BoxGeometry(0.9, 0.8, 0.1), windowM, -b.w / 2 + 1.2, 2.2, b.d / 2 + 0.03, grp);
      add(new THREE.BoxGeometry(0.9, 0.8, 0.1), windowM, b.w / 2 - 1.2, 2.2, b.d / 2 + 0.03, grp);
      add(new THREE.BoxGeometry(0.1, 0.8, 0.9), windowM, b.w / 2 + 0.03, 2.2, 0, grp);
      add(new THREE.BoxGeometry(0.7, 1.6, 0.7), stoneDark, b.w / 4, b.h + 1.7, -b.d / 4, grp);
    } else if (b.kind === 'fountain') {
      add(new THREE.CylinderGeometry(3.3, 3.5, 0.7, 12), stoneM, 0, 0.35, 0, grp);
      const wm = new THREE.MeshPhongMaterial({ color: '#4fa8e8', shininess: 100, transparent: true, opacity: 0.85, flatShading: true });
      add(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 12), wm, 0, 0.66, 0, grp);
      add(new THREE.CylinderGeometry(0.45, 0.6, 2.2, 8), stoneM, 0, 1.4, 0, grp);
      add(new THREE.CylinderGeometry(1.2, 0.6, 0.4, 10), stoneM, 0, 2.5, 0, grp);
      add(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 10), wm, 0, 2.72, 0, grp);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), new THREE.MeshLambertMaterial({ color: '#d6e4ff', emissive: '#9fb8ff', emissiveIntensity: 0.9, flatShading: true }));
      crystal.position.y = 4.4;
      crystal.userData.keep = true;
      crystal.scale.set(1, 1.5, 1);
      grp.add(crystal);
      anim.crystal = crystal;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#a8c0ff', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(6); glow.position.y = 4.4;
      grp.add(glow);
    } else if (b.kind === 'stall') {
      add(new THREE.BoxGeometry(1.2, 1.0, 3.2), woodM, 0, 0.5, 0, grp);
      for (const sz of [-1.5, 1.5]) for (const sx of [-0.5, 0.9]) add(new THREE.BoxGeometry(0.15, 2.6, 0.15), darkWood, sx, 1.3, sz, grp);
      const canopy = add(new THREE.BoxGeometry(2.0, 0.12, 3.6), lambert('#e53935'), 0.2, 2.7, 0, grp);
      canopy.rotation.z = 0.18;
      add(new THREE.BoxGeometry(0.6, 0.5, 0.6), lambert('#a1887f'), 0, 1.25, -0.8, grp);
      add(new THREE.IcosahedronGeometry(0.22, 0), lambert('#e53935'), 0, 1.15, 0.5, grp);
      add(new THREE.IcosahedronGeometry(0.22, 0), lambert('#ffca28'), 0.1, 1.15, 0.9, grp);
    } else if (b.kind === 'altar') {
      add(new THREE.BoxGeometry(1.4, 1.1, 2.2), lambert('#eceff1'), 0, 0.55, 0, grp);
      add(new THREE.BoxGeometry(1.6, 0.15, 2.4), lambert('#ffd54f'), 0, 1.15, 0, grp);
      const orb = add(new THREE.IcosahedronGeometry(0.35, 1), lambert('#fff8e1', { emissive: '#ffd54f', emissiveIntensity: 1 }), 0, 1.6, 0, grp);
      orb.castShadow = false;
    } else if (b.kind === 'board') {
      for (const sx of [-0.8, 0.8]) add(new THREE.BoxGeometry(0.15, 2.2, 0.15), darkWood, sx, 1.1, 0, grp);
      add(new THREE.BoxGeometry(2.0, 1.2, 0.1), woodM, 0, 1.6, 0, grp);
      add(new THREE.BoxGeometry(0.5, 0.6, 0.02), lambert('#fff8e1'), -0.4, 1.65, 0.07, grp);
      add(new THREE.BoxGeometry(0.5, 0.4, 0.02), lambert('#fff8e1'), 0.4, 1.55, 0.07, grp);
    } else if (b.kind === 'lamp') {
      add(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 6), darkWood, 0, 1.6, 0, grp);
      const lamp = add(new THREE.BoxGeometry(0.42, 0.5, 0.42), lambert('#fff3c4', { emissive: '#ffc107', emissiveIntensity: 1 }), 0, 3.4, 0, grp);
      lamp.castShadow = false;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffc46b', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(2.6); glow.position.y = 3.4;
      grp.add(glow);
    }
  }

  // 마을 입구 아치
  for (const a of ARCHES) {
    const grp = new THREE.Group();
    grp.position.set(a.x, heightAt(a.x, a.z), a.z);
    grp.rotation.y = a.ry;
    scene.add(grp);
    for (const sx of [-3.2, 3.2]) add(new THREE.BoxGeometry(0.6, 4.6, 0.6), woodM, sx, 2.3, 0, grp);
    add(new THREE.BoxGeometry(7.8, 0.5, 0.8), darkWood, 0, 4.7, 0, grp);
    add(new THREE.BoxGeometry(3.2, 0.9, 0.15), lambert('#d7b98a'), 0, 4.0, 0.3, grp);
    add(new THREE.BoxGeometry(3.2, 0.9, 0.15), lambert('#d7b98a'), 0, 4.0, -0.3, grp);
  }

  // NPC 발밑 표식
  for (const n of NPCS) {
    const disk = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 24), new THREE.MeshBasicMaterial({ color: n.role === 'quest' ? '#ffd54f' : n.role === 'shop' ? '#ffab40' : '#b2ff59', transparent: true, opacity: 0.6 }));
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(n.x, heightAt(n.x, n.z) + 0.06, n.z);
    scene.add(disk);
  }
}

function buildClouds(scene, anim) {
  const items = [];
  const rng = (i) => (Math.sin(i * 91.7) * 43758.5453) % 1;
  for (let i = 0; i < 18; i++) {
    const cx = (Math.abs(rng(i + 1)) * 2 - 1) * 200, cz = (Math.abs(rng(i + 7)) * 2 - 1) * 200;
    for (let j = 0; j < 4; j++) {
      items.push({ x: cx + j * 4 - 6, z: cz + (Math.abs(rng(i * 4 + j)) - 0.5) * 5, y: 62 + Math.abs(rng(i * 3 + j)) * 4, s: 3 + Math.abs(rng(i * 5 + j)) * 3, ry: 0, c: 0.5 });
    }
  }
  const im = instanced(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c8d8ff', emissiveIntensity: 0.4, flatShading: true }), items, null, { shadow: false });
  if (im) {
    const g = new THREE.Group();
    scene.remove(im);
    g.add(im);
    scene.add(g);
    anim.clouds = g;
  }
}
