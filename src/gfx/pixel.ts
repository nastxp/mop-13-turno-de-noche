export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Lápiz de píxeles con origen desplazable. */
export class Pen {
  constructor(public ctx: Ctx, public ox = 0, public oy = 0) {}
  at(ox: number, oy: number): this {
    this.ox = ox;
    this.oy = oy;
    return this;
  }
  p(x: number, y: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + x, this.oy + y, 1, 1);
  }
  r(x: number, y: number, w: number, h: number, c: string) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + x, this.oy + y, w, h);
  }
  clear(x: number, y: number, w = 1, h = 1) {
    this.ctx.clearRect(this.ox + x, this.oy + y, w, h);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.p(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.3) + (y * y) / (ry * ry + 0.3) <= 1) this.p(cx + x, cy + y, c);
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: string) {
    this.ellipse(cx, cy, r, r, c);
  }
  /** caja 3/4: cara superior + cara frontal con contorno */
  box(x: number, y: number, w: number, topH: number, frontH: number, top: string, front: string, ol = '#141022') {
    this.r(x, y, w, topH + frontH, ol);
    this.r(x + 1, y + 1, w - 2, topH - 1, top);
    this.r(x + 1, y + topH, w - 2, frontH - 1, front);
  }
}

/** Añade contorno de 1 px alrededor de los píxeles opacos de una región. */
export function outlineRegion(ctx: Ctx, x0: number, y0: number, w: number, h: number, color = '#141022') {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const mark: number[] = [];
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a(x, y) > 0) continue;
      if (a(x - 1, y) > 40 || a(x + 1, y) > 40 || a(x, y - 1) > 40 || a(x, y + 1) > 40) mark.push(y * w + x);
    }
  }
  const [r, g, b] = hexRgb(color);
  for (const i of mark) {
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** amt > 0 aclara, amt < 0 oscurece */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexRgb(hex);
  if (amt >= 0) return rgbHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Ruido determinista barato para variaciones de baldosas. */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
