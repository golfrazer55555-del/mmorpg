// 드로우콜 최적화: 같은 부모 아래 정적 메시들을 정점 색상 메시 하나로 병합
import * as THREE from 'three';

function matKey(m) {
  return [m.type, m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity ?? 0, m.transparent ? m.opacity : 1, m.side].join('|');
}

function bakeGeometry(mesh, matrix) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(matrix);
  const pos = g.attributes.position;
  const color = new Float32Array(pos.count * 3);
  const c = mesh.material.color;
  for (let i = 0; i < pos.count; i++) { color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.dispose();
  return out;
}

function concat(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

function mergedMaterial(m) {
  const opts = { vertexColors: true, flatShading: true, side: m.side };
  if (m.emissive) { opts.emissive = m.emissive.clone(); opts.emissiveIntensity = m.emissiveIntensity; }
  if (m.transparent) { opts.transparent = true; opts.opacity = m.opacity; }
  return new THREE.MeshLambertMaterial(opts);
}

// parent의 "직계" 메시 자식들을 병합 (애니메이션 피벗 구조는 유지)
export function mergeChildren(parent, mats) {
  const buckets = new Map();
  for (const child of [...parent.children]) {
    if (!child.isMesh || child.isInstancedMesh || child.userData.keep) continue;
    const m = child.material;
    if (m.type !== 'MeshLambertMaterial') continue;
    const key = matKey(m);
    if (!buckets.has(key)) buckets.set(key, { mat: m, geos: [], cast: false });
    const b = buckets.get(key);
    child.updateMatrix();
    b.geos.push(bakeGeometry(child, child.matrix));
    b.cast ||= child.castShadow;
    parent.remove(child);
  }
  for (const b of buckets.values()) {
    const mat = mergedMaterial(b.mat);
    if (mats) mats.push(mat);
    const mesh = new THREE.Mesh(concat(b.geos), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

// 모델 전체를 재귀적으로 병합
export function optimizeModel(model) {
  const mats = [];
  const visit = (obj) => {
    for (const c of [...obj.children]) if (!c.isMesh) visit(c);
    mergeChildren(obj, mats);
  };
  visit(model.root);
  const used = new Set();
  model.root.traverse((o) => { if (o.isMesh) used.add(o.material); });
  for (const m of model.mats) if (!used.has(m)) m.dispose();
  // 병합되지 않고 남은 개별 메시 재질도 피격 플래시 대상에 포함
  for (const m of used) if (!mats.includes(m) && m.emissive) mats.push(m);
  model.mats = mats;
  return model;
}

// 정적 월드 오브젝트 전체를 하나로 병합 (월드 좌표로 굽기)
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep) return;
    const m = o.material;
    if (m.type !== 'MeshLambertMaterial' || m.transparent) return;
    const key = matKey(m);
    if (!buckets.has(key)) buckets.set(key, { mat: m, geos: [] });
    buckets.get(key).geos.push(bakeGeometry(o, o.matrixWorld));
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(concat(b.geos), mergedMaterial(b.mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
