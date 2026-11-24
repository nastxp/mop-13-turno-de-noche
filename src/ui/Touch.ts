import type { GameScene } from '../scenes/GameScene';

interface Stick { el: HTMLElement; knob: HTMLElement; id: number | null; cx: number; cy: number }

/**
 * Controles táctiles: joystick de movimiento (izquierda), joystick de apuntar/usar (derecha)
 * y botones de interacción, cambio de herramienta, correr, mapa y pausa.
 */
export class TouchControls {
  el: HTMLElement;
  enabled = false;
  private left: Stick;
  private right: Stick;
  private R = 48;

  constructor(root: HTMLElement, private scene: () => GameScene | null, private actions: { map: () => void; pause: () => void }) {
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <div class="stick l"><div class="ring"></div><div class="knob"></div><span>MOVER</span></div>
      <div class="stick r"><div class="ring"></div><div class="knob"></div><span>APUNTAR · USAR</span></div>
      <button class="tb e" data-t="e">E</button>
      <button class="tb q" data-t="q">⟳</button>
      <button class="tb run" data-t="run">CORRER</button>
      <button class="tb map" data-t="map">MAPA</button>
      <button class="tb pause" data-t="pause">II</button>`;
    root.appendChild(this.el);
    const mk = (sel: string): Stick => {
      const el = this.el.querySelector<HTMLElement>(sel)!;
      return { el, knob: el.querySelector<HTMLElement>('.knob')!, id: null, cx: 0, cy: 0 };
    };
    this.left = mk('.stick.l');
    this.right = mk('.stick.r');
    this.bindStick(this.left, (dx, dy, held) => {
      const t = this.scene()?.touch;
      if (!t) return;
      t.dx = held ? dx : 0;
      t.dy = held ? dy : 0;
    });
    this.bindStick(this.right, (dx, dy, held) => {
      const t = this.scene()?.touch;
      if (!t) return;
      const len = Math.hypot(dx, dy);
      t.aimActive = held && len > 0.15;
      if (len > 0.15) { t.ax = dx / len; t.ay = dy / len; }
      t.use = held && len > 0.4;
    });
    const hold = (sel: string, set: (v: boolean) => void) => {
      const b = this.el.querySelector<HTMLElement>(sel)!;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ } b.classList.add('on'); set(true); });
      const off = () => { b.classList.remove('on'); set(false); };
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
    };
    hold('[data-t="e"]', (v) => { const t = this.scene()?.touch; if (t) t.interact = v; });
    hold('[data-t="run"]', (v) => { const t = this.scene()?.touch; if (t) t.run = v; });
    const tap = (sel: string, fn: () => void) => this.el.querySelector<HTMLElement>(sel)!.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    tap('[data-t="q"]', () => { const s = this.scene(); if (s && s.started && !s.over) s.player.cycleTool(); });
    tap('[data-t="map"]', () => this.actions.map());
    tap('[data-t="pause"]', () => this.actions.pause());
  }

  private bindStick(s: Stick, cb: (dx: number, dy: number, held: boolean) => void) {
    const move = (e: PointerEvent) => {
      let dx = (e.clientX - s.cx) / this.R, dy = (e.clientY - s.cy) / this.R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      s.knob.style.transform = `translate(${dx * this.R}px, ${dy * this.R}px)`;
      cb(dx, dy, true);
    };
    s.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (s.id !== null) return;
      s.id = e.pointerId;
      try { s.el.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
      const r = s.el.getBoundingClientRect();
      s.cx = r.left + r.width / 2;
      s.cy = r.top + r.height / 2;
      s.el.classList.add('on');
      move(e);
    });
    s.el.addEventListener('pointermove', (e) => { if (e.pointerId === s.id) move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== s.id) return;
      s.id = null;
      s.el.classList.remove('on');
      s.knob.style.transform = '';
      cb(0, 0, false);
    };
    s.el.addEventListener('pointerup', end);
    s.el.addEventListener('pointercancel', end);
    s.el.addEventListener('lostpointercapture', end);
  }

  /** Activa o desactiva el modo táctil (y lo comunica a la escena). */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.el.classList.toggle('hidden', !on);
    const t = this.scene()?.touch;
    if (t) { t.active = on; t.dx = 0; t.dy = 0; t.use = false; t.aimActive = false; t.interact = false; t.run = false; }
  }

  setVisible(v: boolean) { this.el.classList.toggle('hidden', !(v && this.enabled)); }
}
