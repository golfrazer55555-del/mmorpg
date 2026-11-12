// 터치 조이스틱 / 카메라 드래그 / 핀치 줌 / 키보드
export class Input {
  constructor(canvas, joyZone, joyBase, joyKnob) {
    this.joy = { x: 0, y: 0, id: null, cx: 0, cy: 0 };
    this.keys = new Set();
    this.cam = { dx: 0, dy: 0, zoom: 0 };
    this.taps = [];
    this.pointers = new Map();
    this.pinchDist = 0;
    this.joyBase = joyBase;
    this.joyKnob = joyKnob;
    this.radius = 52;
    this.enabled = true;

    // ---- 조이스틱 ----
    joyZone.addEventListener('pointerdown', (e) => {
      if (this.joy.id !== null || !this.enabled) return;
      e.preventDefault();
      joyZone.setPointerCapture(e.pointerId);
      this.joy.id = e.pointerId;
      this.joy.cx = e.clientX; this.joy.cy = e.clientY;
      const r = joyZone.getBoundingClientRect();
      joyBase.style.left = (e.clientX - r.left) + 'px';
      joyBase.style.top = (e.clientY - r.top) + 'px';
      joyBase.style.bottom = 'auto';
      joyBase.style.margin = '-62px 0 0 -62px';
      joyBase.classList.add('active');
      this.updateJoy(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joy.id) return;
      e.preventDefault();
      this.updateJoy(e.clientX, e.clientY);
    });
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
      joyKnob.style.transform = '';
      joyBase.classList.remove('active');
      joyBase.style.left = ''; joyBase.style.top = ''; joyBase.style.bottom = ''; joyBase.style.margin = '';
    };
    joyZone.addEventListener('pointerup', endJoy);
    joyZone.addEventListener('pointercancel', endJoy);

    // ---- 카메라 (캔버스) ----
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, button: e.button });
      if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size === 1) {
        this.cam.dx += dx; this.cam.dy += dy;
      } else if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        this.cam.zoom += (this.pinchDist - d) * 0.04;
        this.pinchDist = d;
      }
    });
    const endCam = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.moved < 12 && performance.now() - p.t < 350 && e.type === 'pointerup') this.taps.push({ x: e.clientX, y: e.clientY });
    };
    canvas.addEventListener('pointerup', endCam);
    canvas.addEventListener('pointercancel', endCam);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.zoom += e.deltaY * 0.01; }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- 키보드 ----
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); });
  }

  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  updateJoy(x, y) {
    let dx = x - this.joy.cx, dy = y - this.joy.cy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) { dx = (dx / d) * this.radius; dy = (dy / d) * this.radius; }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / this.radius);
    const dead = 0.12;
    const s = m < dead ? 0 : (m - dead) / (1 - dead) / Math.max(m, 1e-6);
    this.joy.x = (dx / this.radius) * s;
    this.joy.y = (-dy / this.radius) * s;
  }

  moveVector() {
    let x = this.joy.x, y = this.joy.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  consumeCam() {
    const c = { ...this.cam };
    this.cam.dx = 0; this.cam.dy = 0; this.cam.zoom = 0;
    return c;
  }

  consumeTaps() {
    const t = this.taps;
    this.taps = [];
    return t;
  }

  reset() {
    this.keys.clear();
    this.pointers.clear();
    this.joy.x = this.joy.y = 0;
  }
}
