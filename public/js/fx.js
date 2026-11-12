// 시각 효과: 파티클, 투사체, 범위 링, 데미지 숫자
import * as THREE from 'three';
import { glowTexture } from './scene.js';

const tmpV = new THREE.Vector3();

export class FX {
  constructor(scene, camera, labelsEl) {
    this.scene = scene;
    this.camera = camera;
    this.labelsEl = labelsEl;
    this.particles = [];
    this.pool = [];
    this.projectiles = [];
    this.rings = [];
    this.numbers = [];
    this.delayed = [];
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
    this.arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.9);
    this.ballGeo = new THREE.IcosahedronGeometry(0.28, 1);
  }

  later(delay, fn) { this.delayed.push({ t: delay, fn }); }

  // ---- 파티클 ----
  spawnParticle(pos, vel, color, size, life, gravity = 0) {
    let sp = this.pool.pop();
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.renderOrder = 30;
    }
    sp.material.color.set(color);
    sp.material.opacity = 1;
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    this.scene.add(sp);
    if (this.particles.length > 450) this.killParticle(0);
    this.particles.push({ sp, vel: vel.clone(), life, max: life, size, gravity });
  }

  killParticle(i) {
    const p = this.particles[i];
    this.scene.remove(p.sp);
    this.pool.push(p.sp);
    this.particles.splice(i, 1);
  }

  burst(pos, color, n = 12, speed = 4, size = 0.5, life = 0.6, gravity = -6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      tmpV.set(Math.cos(a) * Math.cos(b), Math.abs(Math.sin(b)) + 0.3, Math.sin(a) * Math.cos(b)).multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.spawnParticle(pos, tmpV, color, size * (0.6 + Math.random() * 0.6), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  rise(pos, color, n = 14, radius = 1, size = 0.4, life = 1.0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      const p = tmpV.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.8, pos.z + Math.sin(a) * r).clone();
      this.spawnParticle(p, new THREE.Vector3(0, 1.5 + Math.random() * 2, 0), color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), 0);
    }
  }

  // ---- 링 ----
  ring(pos, color, radius, life = 0.6, opts = {}) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.copy(pos);
    m.position.y += opts.y ?? 0.15;
    m.renderOrder = 25;
    this.scene.add(m);
    this.rings.push({ m, life, max: life, radius, from: opts.from ?? 0.2, spin: opts.spin || 0, follow: opts.follow || null });
  }

  // ---- 투사체 ----
  projectile(from, getTarget, kind, onHit) {
    let obj;
    let color = '#ffffff', speed = 34, trail = null;
    if (kind === 'arrow' || kind === 'big_arrow') {
      obj = new THREE.Mesh(this.arrowGeo, new THREE.MeshBasicMaterial({ color: kind === 'big_arrow' ? '#ffe082' : '#f5f5f5' }));
      if (kind === 'big_arrow') { obj.scale.set(2, 2, 1.6); trail = '#ffd54f'; }
      speed = 42;
    } else {
      const c = kind === 'fireball' ? '#ff7a1a' : kind === 'm_fire' ? '#ff5722' : '#7fd3ff';
      color = c;
      obj = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: kind === 'bolt' ? '#d8f3ff' : '#ffe0b2' }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(kind === 'fireball' ? 2.6 : 1.5);
      obj.add(glow);
      if (kind === 'fireball') obj.scale.setScalar(1.5);
      if (kind === 'bolt') obj.scale.setScalar(0.7);
      trail = c;
      speed = kind === 'fireball' ? 26 : 30;
    }
    obj.position.copy(from);
    this.scene.add(obj);
    this.projectiles.push({ obj, getTarget, speed, onHit, trail, trailT: 0, life: 3 });
  }

  // ---- 숫자 ----
  number(pos, text, cls = '') {
    if (this.numbers.length > 40) this.removeNumber(0);
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.labelsEl.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  removeNumber(i) {
    this.numbers[i].el.remove();
    this.numbers.splice(i, 1);
  }

  update(dt) {
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      d.t -= dt;
      if (d.t <= 0) { this.delayed.splice(i, 1); d.fn(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.killParticle(i); continue; }
      p.vel.y += p.gravity * dt;
      p.sp.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.sp.material.opacity = Math.min(1, k * 1.5);
      p.sp.scale.setScalar(p.size * (0.4 + 0.6 * k));
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(r.radius * (r.from + (1 - r.from) * e));
      r.m.material.opacity = 0.9 * (1 - k);
      if (r.spin) r.m.rotation.y += r.spin * dt;
      if (r.follow) { const p = r.follow(); if (p) { r.m.position.x = p.x; r.m.position.z = p.z; } }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const target = p.getTarget();
      if (!target || p.life <= 0) {
        this.scene.remove(p.obj);
        this.projectiles.splice(i, 1);
        if (p.onHit) p.onHit();
        continue;
      }
      const dir = tmpV.copy(target).sub(p.obj.position);
      const d = dir.length();
      const step = p.speed * dt;
      if (d <= step + 0.2) {
        this.scene.remove(p.obj);
        this.projectiles.splice(i, 1);
        if (p.onHit) p.onHit();
        continue;
      }
      dir.multiplyScalar(1 / d);
      p.obj.position.addScaledVector(dir, step);
      p.obj.lookAt(target);
      if (p.trail) {
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.02;
          this.spawnParticle(p.obj.position, new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5) + 0.5, (Math.random() - 0.5)), p.trail, 0.5, 0.3, 0);
        }
      }
    }
    // 데미지 숫자 (화면 투영)
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      if (n.t > 1.0) { this.removeNumber(i); continue; }
      tmpV.copy(n.pos);
      tmpV.y += n.t * 1.4;
      tmpV.project(this.camera);
      if (tmpV.z > 1) { n.el.style.opacity = 0; continue; }
      const x = (tmpV.x * 0.5 + 0.5) * w + n.dx * n.t;
      const y = (-tmpV.y * 0.5 + 0.5) * h;
      const pop = n.t < 0.12 ? 1 + (0.12 - n.t) * 5 : 1;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      n.el.style.opacity = n.t > 0.7 ? (1 - (n.t - 0.7) / 0.3) : 1;
    }
  }
}
