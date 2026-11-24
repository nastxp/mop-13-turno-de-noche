import { esc } from '../core/util';

interface Item {
  el: HTMLElement;
  x: number;
  y: number;
  until: number | null;
  follow?: () => { x: number; y: number } | null;
  rise?: number;
  born: number;
}

/** Textos anclados al mundo (bocadillos, indicaciones, números flotantes) dibujados en DOM nítido. */
export class WorldLabels {
  private items = new Map<string, Item>();
  private seq = 0;
  private promptKey = '';

  constructor(private root: HTMLElement) {}

  private make(id: string, cls: string, html: string): HTMLElement {
    let it = this.items.get(id);
    if (it) { it.el.className = `wl ${cls}`; it.el.innerHTML = html; return it.el; }
    const el = document.createElement('div');
    el.className = `wl ${cls}`;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.items.set(id, { el, x: 0, y: 0, until: null, born: performance.now() });
    return el;
  }

  bubble(id: string, who: string, text: string, follow: () => { x: number; y: number } | null, isPlayer = false, ttl = 3) {
    const bubbles = [...this.items.entries()].filter(([k]) => k.startsWith('b:'));
    if (bubbles.length >= 4 && !this.items.has(id)) {
      const oldest = bubbles.sort((a, b) => a[1].born - b[1].born)[0];
      this.hide(oldest[0]);
    }
    this.make(id, `bubble${isPlayer ? ' player' : ''}`, `<span class="who">${esc(who)}</span>${esc(text)}`);
    const it = this.items.get(id)!;
    it.follow = follow;
    it.until = performance.now() + Math.max(2200, Math.min(5000, ttl * 1000 + text.length * 35));
    it.born = performance.now();
  }

  float(text: string, x: number, y: number, cls = 'info') {
    const id = `f:${this.seq++}`;
    this.make(id, `float ${cls}`, esc(text));
    const it = this.items.get(id)!;
    it.x = x; it.y = y; it.until = performance.now() + 1300; it.rise = 0;
  }

  place(id: string, html: string, x: number, y: number, cls: string) {
    this.make(id, cls, html);
    const it = this.items.get(id)!;
    it.x = x; it.y = y;
  }

  prompt(x: number, y: number, label: string, progress: number) {
    const key = label;
    if (key !== this.promptKey || !this.items.has('prompt')) {
      this.promptKey = key;
      this.make('prompt', 'prompt', `<kbd>E</kbd>${esc(label)}<div class="pbar"><i></i></div>`);
    }
    const it = this.items.get('prompt')!;
    it.x = x; it.y = y;
    const bar = it.el.querySelector('.pbar i') as HTMLElement | null;
    if (bar) bar.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
  }

  hide(id: string) {
    const it = this.items.get(id);
    if (!it) return;
    it.el.remove();
    this.items.delete(id);
  }

  clear() {
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
  }

  /** proyección mundo → pantalla (vista isométrica); null = vista clásica */
  project: ((x: number, y: number) => { x: number; y: number }) | null = null;

  update(view: { x: number; y: number }, zoom: number) {
    const now = performance.now();
    for (const [id, it] of this.items) {
      if (it.until !== null && now > it.until) { this.hide(id); continue; }
      if (it.follow) {
        const p = it.follow();
        if (!p) { this.hide(id); continue; }
        it.x = p.x; it.y = p.y;
      }
      let y = it.y;
      if (it.rise !== undefined) {
        const age = (now - it.born) / 1000;
        y -= age * 14;
        it.el.style.opacity = `${Math.max(0, 1 - age / 1.3)}`;
      }
      let sx: number, sy: number;
      if (this.project) {
        // los textos se anclan «por encima» de un punto del suelo: se proyecta el suelo y se sube en pantalla
        const up = id.startsWith('b:') ? 19 : id === 'prompt' ? 18 : id.startsWith('f:') ? 16 : 0;
        const p = this.project(it.x, y + up);
        sx = Math.round(p.x);
        sy = Math.round(p.y - up * zoom);
      } else {
        sx = Math.round((it.x - view.x) * zoom);
        sy = Math.round((y - view.y) * zoom);
      }
      it.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
  }
}
