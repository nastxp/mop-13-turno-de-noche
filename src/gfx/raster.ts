/**
 * Rasterizador de pixel art "HD" (2 texeles por píxel de mundo):
 * rampas de color con desplazamiento de tono, tramado ordenado, formas sombreadas
 * con una luz coherente (arriba-izquierda) y contorno selectivo coloreado.
 */
export type Ramp = string[];

const cache = new Map<string, number>();

export function col(hex: string, a = 255): number {
  const k = hex + '|' + a;
  let v = cache.get(k);
  if (v !== undefined) return v;
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  cache.set(k, v);
  return v;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// luz principal (arriba-izquierda, hacia el espectador)
const LX = -0.5, LY = -0.62, LZ = 0.6;
const LN = Math.hypot(LX, LY, LZ);
const L = [LX / LN, LY / LN, LZ / LN];

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s); l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const t = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

/** Rampa de n tonos con desplazamiento de tono: sombras hacia el violeta, luces hacia el amarillo. */
export function rampOf(base: string, n = 6, spread = 0.62): Ramp {
  const [h, s, l] = hexToHsl(base);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1); // 0 oscuro → 1 claro
    const k = t - 0.5;
    const nl = clamp01(l + k * spread * (k < 0 ? 1.15 : 0.9));
    const toward = k < 0 ? 250 : 55;
    let dh = toward - h;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const nh = h + dh * Math.abs(k) * 0.32;
    const ns = clamp01(s * (k < 0 ? 1 + Math.abs(k) * 0.25 : 1 - k * 0.45));
    out.push(hslToHex(nh, ns, nl));
  }
  return out;
}

export const RAMPS: Record<string, Ramp> = {
  metal: ['#050607', '#0b0e10', '#13181b', '#1c2326', '#283134', '#374244', '#4d5958', '#6d776f', '#9ca08e'],
  steel: ['#191e21', '#262e31', '#364043', '#4b5655', '#647069', '#828c82', '#a9ad9c', '#d8d6c4'],
  dark: ['#07060e', '#0e0d1a', '#161627', '#202238', '#2c3049', '#3a405c'],
  white: ['#4e586e', '#6d7a94', '#8f9db6', '#b3c0d4', '#d2dcea', '#eaf0f8', '#ffffff'],
  yellow: ['#3a1e06', '#6e3c0a', '#a8640e', '#d8901a', '#f8b828', '#ffd65a', '#fff09a', '#fffbe0'],
  red: ['#22040c', '#4a0a18', '#7c1424', '#b4202e', '#e43a44', '#ff6e6e', '#ffb0a8'],
  cyan: ['#031a24', '#073444', '#0c5a6c', '#13889a', '#22bccc', '#5ae8f0', '#b8fbff'],
  green: ['#041a0c', '#0a3418', '#125a28', '#1e8a3c', '#34bc5a', '#6ae68a', '#bfffd2'],
  purple: ['#12061e', '#24103e', '#3c1a66', '#5e2a98', '#8646cc', '#b07cf0', '#ddc2ff'],
  orange: ['#260c04', '#521c06', '#86340a', '#be5612', '#ee8222', '#ffb05a', '#ffe0b0'],
  wood: ['#1a0c06', '#33190c', '#522a14', '#764024', '#9c5c34', '#c4844e', '#e8b47e'],
  glass: ['#0a2030', '#123a50', '#1c5a74', '#2c8098', '#56b0c4', '#9edcea', '#e4fbff'],
  hologram: ['#06303a', '#0b5664', '#13889a', '#2cc0d0', '#7cf0f8', '#d8ffff'],
  slime: ['#04241a', '#0a4a30', '#127448', '#20a464', '#3ad688', '#86f4b8', '#d8fff0'],
  ceramic: ['#5e6a80', '#7f8ca4', '#a2afc4', '#c4d0e0', '#e0e8f2', '#f4f8fc', '#ffffff'],
  soil: ['#120904', '#22120a', '#361e10', '#4c2c18', '#664024', '#865834'],
  leaf: ['#04180a', '#0a3014', '#124e20', '#1e7430', '#2e9c42', '#52c860', '#9cf090'],
};

// paletas biomecánicas (ambientación de terror industrial, con humor)
Object.assign(RAMPS, {
  bone: ['#1c1810', '#3a3224', '#5c513c', '#82765c', '#a89c80', '#cbc0a2', '#e8dfc6', '#fffaea'],
  chrome: ['#030406', '#080b10', '#10151c', '#1a212a', '#28323e', '#3c4a58', '#5e7284', '#9db4c6', '#e6f4ff'],
  oil: ['#020305', '#06090c', '#0c1218', '#141c24', '#1e2a34', '#2c3c48', '#40566a'],
  flesh: ['#1a0a0c', '#341418', '#542228', '#7a363a', '#9c5450', '#c07a6e', '#e2aa98'],
  amber: ['#1e0e02', '#3e1e04', '#6a3606', '#9e560a', '#d07e14', '#f4a62a', '#ffd06a', '#fff0c0'],
  acid: ['#06140a', '#0c2812', '#12401c', '#1c6228', '#2a8a36', '#46b84a', '#86e86a', '#d4ffb0'],
  sinew: ['#120c10', '#24161c', '#3a2228', '#523236', '#6c4846', '#8c6458', '#b08a76'],
});

/**
 * Ráster con densidad nativa configurable: se dibuja en «coordenadas de diseño»
 * (32 por casilla) y se rasteriza a Raster.SCALE texeles por unidad, de modo que las curvas,
 * los degradados, el tramado y los contornos ganan resolución sin cambiar los diseños.
 */
export class Raster {
  /** texeles nativos por unidad de diseño */
  static SCALE = 2;
  data: Uint32Array;
  readonly S: number;
  /** tamaño nativo en texeles */
  readonly W: number;
  readonly H: number;

  constructor(public w: number, public h: number, s = Raster.SCALE) {
    this.S = s;
    this.W = Math.round(w * s);
    this.H = Math.round(h * s);
    this.data = new Uint32Array(this.W * this.H);
  }

  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  // ───── acceso nativo ─────
  setN(X: number, Y: number, c: number) {
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return;
    this.data[Y * this.W + X] = c;
  }

  getN(X: number, Y: number): number {
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return 0;
    return this.data[Y * this.W + X];
  }

  blendN(X: number, Y: number, s: number, a: number) {
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H || a <= 0) return;
    const i = Y * this.W + X;
    const d = this.data[i];
    const da = d >>> 24;
    if (da === 0) { this.data[i] = ((Math.round(Math.min(1, a) * 255) << 24) | (s & 0xffffff)) >>> 0; return; }
    if (a >= 1) { this.data[i] = ((Math.max(da, 255) << 24) | (s & 0xffffff)) >>> 0; return; }
    const mix = (sh: number) => Math.round(((s >> sh) & 255) * a + ((d >> sh) & 255) * (1 - a));
    this.data[i] = ((Math.max(da, Math.round(a * 255)) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
  }

  /** recorre los texeles nativos de un rectángulo de diseño: fn(X, Y, u, v, x, y) devuelve color o 0 */
  forN(x: number, y: number, w: number, h: number, fn: (X: number, Y: number, u: number, v: number, dx: number, dy: number) => number) {
    const S = this.S;
    const X0 = Math.round(x * S), Y0 = Math.round(y * S), X1 = Math.round((x + w) * S), Y1 = Math.round((y + h) * S);
    const iw = Math.max(1, X1 - X0), ih = Math.max(1, Y1 - Y0);
    for (let Y = Math.max(0, Y0); Y < Math.min(this.H, Y1); Y++) for (let X = Math.max(0, X0); X < Math.min(this.W, X1); X++) {
      const c = fn(X, Y, (X - X0 + 0.5) / iw, (Y - Y0 + 0.5) / ih, (X + 0.5) / S, (Y + 0.5) / S);
      if (c) this.data[Y * this.W + X] = c;
    }
  }

  // ───── acceso en coordenadas de diseño ─────
  set(x: number, y: number, c: number) {
    const S = this.S;
    const X = Math.floor(x * S), Y = Math.floor(y * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) this.setN(X + i, Y + j, c);
  }

  get(x: number, y: number): number { return this.getN(Math.floor(x * this.S), Math.floor(y * this.S)); }

  alpha(x: number, y: number) { return this.get(x, y) >>> 24; }

  p(x: number, y: number, hex: string) { this.set(x, y, col(hex)); }

  /** punto de 1 texel nativo (detalle fino) */
  pn(x: number, y: number, hex: string) { this.setN(Math.floor(x * this.S), Math.floor(y * this.S), col(hex)); }

  /** píxel semitransparente mezclado sobre lo existente */
  blend(x: number, y: number, hex: string, a: number) {
    const S = this.S, s = col(hex);
    const X = Math.floor(x * S), Y = Math.floor(y * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) this.blendN(X + i, Y + j, s, a);
  }

  rect(x: number, y: number, w: number, h: number, hex: string) {
    const c = col(hex), S = this.S;
    const X0 = Math.max(0, Math.round(x * S)), Y0 = Math.max(0, Math.round(y * S));
    const X1 = Math.min(this.W, Math.round((x + w) * S)), Y1 = Math.min(this.H, Math.round((y + h) * S));
    for (let j = Y0; j < Y1; j++) for (let i = X0; i < X1; i++) this.data[j * this.W + i] = c;
  }

  blendRect(x: number, y: number, w: number, h: number, hex: string, a: number) {
    const c = col(hex), S = this.S;
    const X0 = Math.round(x * S), Y0 = Math.round(y * S), X1 = Math.round((x + w) * S), Y1 = Math.round((y + h) * S);
    for (let j = Y0; j < Y1; j++) for (let i = X0; i < X1; i++) this.blendN(i, j, c, a);
  }

  clear(x = 0, y = 0, w = this.w, h = this.h) {
    const S = this.S;
    const X0 = Math.max(0, Math.round(x * S)), Y0 = Math.max(0, Math.round(y * S));
    const X1 = Math.min(this.W, Math.round((x + w) * S)), Y1 = Math.min(this.H, Math.round((y + h) * S));
    for (let j = Y0; j < Y1; j++) for (let i = X0; i < X1; i++) this.data[j * this.W + i] = 0;
  }

  /** línea con el grosor de un píxel de diseño (por defecto) o más fina (thick en texeles nativos) */
  line(x0: number, y0: number, x1: number, y1: number, hex: string, thick = this.S) {
    const S = this.S, c = col(hex);
    let X0 = Math.round(x0 * S), Y0 = Math.round(y0 * S);
    const X1 = Math.round(x1 * S), Y1 = Math.round(y1 * S);
    const dx = Math.abs(X1 - X0), dy = -Math.abs(Y1 - Y0);
    const sx = X0 < X1 ? 1 : -1, sy = Y0 < Y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let j = 0; j < thick; j++) for (let i = 0; i < thick; i++) this.setN(X0 + i, Y0 + j, c);
      if (X0 === X1 && Y0 === Y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; X0 += sx; }
      if (e2 <= dx) { err += dx; Y0 += sy; }
    }
  }

  /** línea fina de 1 texel nativo */
  lineN(x0: number, y0: number, x1: number, y1: number, hex: string) { this.line(x0 + 0.25, y0 + 0.25, x1 + 0.25, y1 + 0.25, hex, 1); }

  ellipse(cx: number, cy: number, rx: number, ry: number, hex: string) {
    const c = col(hex), S = this.S;
    for (let Y = Math.floor((cy - ry) * S); Y <= Math.ceil((cy + ry) * S); Y++)
      for (let X = Math.floor((cx - rx) * S); X <= Math.ceil((cx + rx) * S); X++) {
        const nx = ((X + 0.5) / S - cx) / rx, ny = ((Y + 0.5) / S - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.setN(X, Y, c);
      }
  }

  /** color de una rampa para un valor 0..1 con tramado ordenado */
  rc(ramp: Ramp, v: number, x: number, y: number, dither = 0.9): number {
    const n = ramp.length;
    const f = clamp01(v) * (n - 1);
    const i = Math.floor(f);
    const fr = f - i;
    const thr = 0.5 + (BAYER[((y & 3) << 2) | (x & 3)] - 0.5) * dither;
    return col(ramp[Math.min(n - 1, i + (fr > thr ? 1 : 0))]);
  }

  /** elipsoide sombreado (cabezas, burbujas, gotas) */
  blob(cx: number, cy: number, rx: number, ry: number, ramp: Ramp, opts: { bias?: number; spec?: boolean; dither?: number; clipY?: [number, number] } = {}) {
    const bias = opts.bias ?? 0, S = this.S;
    const specC = col(ramp[ramp.length - 1]);
    for (let Y = Math.floor((cy - ry) * S); Y <= Math.ceil((cy + ry) * S); Y++) {
      const yd = Math.floor(Y / S);
      if (opts.clipY && (yd < opts.clipY[0] || yd > opts.clipY[1])) continue;
      for (let X = Math.floor((cx - rx) * S); X <= Math.ceil((cx + rx) * S); X++) {
        const nx = ((X + 0.5) / S - cx) / rx, ny = ((Y + 0.5) / S - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        let v = 0.08 + 0.92 * clamp01(nx * L[0] + ny * L[1] + nz * L[2]) + bias;
        if (d2 > 0.84) v -= 0.08; // borde
        if (opts.spec && nx < -0.25 && nx > -0.6 && ny < -0.3 && ny > -0.65 && (nx + 0.42) ** 2 * 3 + (ny + 0.47) ** 2 * 4 < 0.12) this.setN(X, Y, specC);
        else this.setN(X, Y, this.rc(ramp, v, X, Y, opts.dither));
      }
    }
  }

  /** rectángulo con esquinas redondeadas sombreado mediante una función (u,v en 0..1) */
  shadeRect(x: number, y: number, w: number, h: number, ramp: Ramp, fn: (u: number, v: number) => number, r = 0, dither = 0.9) {
    const S = this.S;
    const X0 = Math.round(x * S), Y0 = Math.round(y * S), NW = Math.round(w * S), NH = Math.round(h * S);
    for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
      const px = (i + 0.5) / S, py = (j + 0.5) / S;
      if (r > 0) {
        const cx = px < r ? r - px : px > w - r ? px - (w - r) : 0;
        const cy = py < r ? r - py : py > h - r ? py - (h - r) : 0;
        if (cx > 0 && cy > 0 && cx * cx + cy * cy > r * r) continue;
      }
      const u = w > 1 ? clamp01((px - 0.5) / (w - 1)) : 0.5;
      const v = h > 1 ? clamp01((py - 0.5) / (h - 1)) : 0.5;
      this.setN(X0 + i, Y0 + j, this.rc(ramp, fn(u, v), X0 + i, Y0 + j, dither));
    }
  }

  /** cilindro iluminado de lado (brazos, piernas, tuberías) entre dos puntos */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, ramp: Ramp, bias = 0) {
    const S = this.S;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const len = Math.sqrt(len2);
    const px = -dy / len, py = dx / len; // normal
    const minX = Math.floor((Math.min(x0, x1) - r - 1) * S), maxX = Math.ceil((Math.max(x0, x1) + r + 1) * S);
    const minY = Math.floor((Math.min(y0, y1) - r - 1) * S), maxY = Math.ceil((Math.max(y0, y1) + r + 1) * S);
    for (let Y = minY; Y <= maxY; Y++) for (let X = minX; X <= maxX; X++) {
      const qx = (X + 0.5) / S - x0, qy = (Y + 0.5) / S - y0;
      let t = (qx * dx + qy * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = qx - dx * t, ey = qy - dy * t;
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const side = (ex * px + ey * py) / r; // -1..1 a través del cilindro
      const nx = px * side, ny = py * side, nz = Math.sqrt(Math.max(0, 1 - side * side));
      const v = 0.1 + 0.9 * clamp01(nx * L[0] + ny * L[1] + nz * L[2]) + bias;
      this.setN(X, Y, this.rc(ramp, v, X, Y));
    }
  }

  /** caja en perspectiva 3/4: tapa superior + frontal, con bisel iluminado y oclusión abajo */
  box3d(x: number, y: number, w: number, topH: number, frontH: number, top: Ramp, front: Ramp, opts: { r?: number; bevel?: boolean } = {}) {
    const r = opts.r ?? 1;
    this.shadeRect(x, y, w, topH, top, (u, v) => 0.82 - u * 0.18 - v * 0.08, r);
    this.shadeRect(x, y + topH, w, frontH, front, (u, v) => 0.62 - v * 0.36 - u * 0.12, r > 0 ? 1 : 0);
    if (opts.bevel !== false) {
      const t = 1 / this.S;
      this.rect(x + 1, y + topH, w - 2, t, top[top.length - 1]);
      this.rect(x, y + 1, t, topH - 2, top[Math.max(0, top.length - 2)]);
      this.blendRect(x + 1, y + topH + t, w - 2, t, top[top.length - 1], 0.35);
    }
  }

  /** cilindro vertical con tapa elíptica (barriles, tanques, reactores) */
  cylinder(cx: number, yTop: number, rx: number, ry: number, h: number, ramp: Ramp, capRamp?: Ramp) {
    const S = this.S;
    for (let Y = Math.floor(yTop * S); Y <= Math.ceil((yTop + h + ry) * S); Y++) {
      const y = (Y + 0.5) / S;
      for (let X = Math.floor((cx - rx) * S); X <= Math.ceil((cx + rx) * S); X++) {
        const nx = ((X + 0.5) / S - cx) / rx;
        if (Math.abs(nx) > 1) continue;
        const yb = yTop + h + ry * Math.sqrt(1 - nx * nx);
        if (y > yb || y < yTop) continue;
        const nz = Math.sqrt(1 - nx * nx);
        const v = 0.12 + 0.88 * clamp01(nx * -0.62 + nz * 0.78) - ((y - yTop) / (h + ry)) * 0.12;
        this.setN(X, Y, this.rc(ramp, v, X, Y));
      }
    }
    const cr = capRamp ?? ramp;
    for (let Y = Math.floor((yTop - ry) * S); Y <= Math.ceil((yTop + ry) * S); Y++) for (let X = Math.floor((cx - rx) * S); X <= Math.ceil((cx + rx) * S); X++) {
      const nx = ((X + 0.5) / S - cx) / rx, ny = ((Y + 0.5) / S - yTop) / ry;
      if (nx * nx + ny * ny > 1) continue;
      this.setN(X, Y, this.rc(cr, 0.72 - nx * 0.2 - ny * 0.12, X, Y));
    }
  }

  /** pantalla con líneas de escaneo finas y brillo de cristal */
  screen(x: number, y: number, w: number, h: number, ramp: Ramp, seed = 0) {
    this.shadeRect(x, y, w, h, ramp, (u, v) => 0.35 + (1 - v) * 0.2 - u * 0.1);
    const S = this.S, blk = col('#000000');
    const X0 = Math.round(x * S), Y0 = Math.round(y * S), X1 = Math.round((x + w) * S), Y1 = Math.round((y + h) * S);
    for (let Y = Y0 + 1; Y < Y1; Y += 2) for (let X = X0; X < X1; X++) this.blendN(X, Y, blk, 0.2);
    for (let k = 0; k < 3; k++) {
      const ly = y + 2 + k * Math.max(2, Math.floor((h - 3) / 3));
      const lw = Math.max(2, Math.floor(w * (0.3 + (((seed + k * 7) * 37) % 50) / 100)));
      if (ly < y + h - 1) this.rect(x + 2, ly, Math.min(lw, w - 4), 0.5, ramp[ramp.length - 1]);
    }
    this.blendRect(x, y, w, 0.5, '#ffffff', 0.3);
    // reflejo diagonal del cristal
    const gl = col('#ffffff');
    for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
      const k = (X - X0) - (Y - Y0) * 0.6;
      if (k > (X1 - X0) * 0.55 && k < (X1 - X0) * 0.62) this.blendN(X, Y, gl, 0.08);
    }
  }

  /** contorno selectivo de 1 texel nativo: color oscurecido del vecino en lugar de negro puro */
  outline(dark = '#08060f', strength = 0.72) {
    const w = this.W, h = this.H;
    const src = this.data.slice();
    const dk = col(dark);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x] >>> 24);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (a(x, y) > 0) continue;
      let n = 0;
      if (a(x - 1, y) > 40) n = src[y * w + x - 1];
      else if (a(x + 1, y) > 40) n = src[y * w + x + 1];
      else if (a(x, y - 1) > 40) n = src[(y - 1) * w + x];
      else if (a(x, y + 1) > 40) n = src[(y + 1) * w + x];
      if (!n) continue;
      const k = 1 - strength;
      const r = Math.round((n & 255) * k + (dk & 255) * strength);
      const g = Math.round(((n >> 8) & 255) * k + ((dk >> 8) & 255) * strength);
      const b = Math.round(((n >> 16) & 255) * k + ((dk >> 16) & 255) * strength);
      this.data[y * w + x] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }

  /** brillo especular de borde (luz de contorno) en los texeles superiores-izquierdos de la silueta */
  rimLight(hex = '#ffffff', a = 0.35) {
    const w = this.W, h = this.H, src = this.data.slice(), c = col(hex);
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if ((src[i] >>> 24) < 200) continue;
      if ((src[i - w] >>> 24) < 40 || (src[i - 1] >>> 24) < 40) this.blendN(x, y, c, a);
    }
  }

  /**
   * Etalonaje biomecánico: desatura, empuja las sombras hacia el verde azulado,
   * añade mugre, escurridos verticales y suciedad acumulada en la base.
   */
  grade(opts: { sat?: number; dark?: number; grime?: number; tint?: string; seed?: number } = {}) {
    const sat = opts.sat ?? 0.6, dark = opts.dark ?? 0.82, grime = opts.grime ?? 0.35, seed = opts.seed ?? 7;
    const t = col(opts.tint ?? '#0c2422');
    const tr = t & 255, tg = (t >> 8) & 255, tb = (t >> 16) & 255;
    const W = this.W, H = this.H;
    const hsh = (x: number, y: number) => {
      let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    // altura de cada columna opaca (para la mugre acumulada abajo)
    for (let X = 0; X < W; X++) {
      let top = -1, bot = -1;
      for (let Y = 0; Y < H; Y++) if ((this.data[Y * W + X] >>> 24) > 0) { if (top < 0) top = Y; bot = Y; }
      if (top < 0) continue;
      const drip = hsh(X >> 1, 3) > 0.84 ? hsh(X >> 1, 5) : -1;
      for (let Y = top; Y <= bot; Y++) {
        const i = Y * W + X;
        const c = this.data[i];
        if ((c >>> 24) === 0) continue;
        let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        const l = r * 0.3 + g * 0.59 + b * 0.11;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        const sh = 1 - l / 255;
        r = r * dark + tr * sh * 0.3; g = g * dark + tg * sh * 0.3; b = b * dark + tb * sh * 0.3;
        let k = 1;
        const v = (Y - top) / Math.max(1, bot - top);
        if (v > 0.7) k -= (v - 0.7) * grime * 0.9;
        if (drip >= 0 && v > drip * 0.5 && v < drip * 0.5 + 0.35) k -= grime * 0.35 * (1 - (v - drip * 0.5) / 0.35);
        const sp = hsh(X, Y);
        if (sp > 0.965) k -= grime * 0.5;
        else if (sp < 0.02) k += 0.06;
        r = Math.max(0, Math.min(255, r * k)); g = Math.max(0, Math.min(255, g * k)); b = Math.max(0, Math.min(255, b * k));
        this.data[i] = ((c & 0xff000000) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
      }
    }
  }

  /** copia otro ráster (con transparencia por píxel) */
  blit(src: Raster, dx: number, dy: number, flipX = false) {
    const S = this.S;
    const ox = Math.round(dx * S), oy = Math.round(dy * S);
    if (src.S === S) {
      for (let y = 0; y < src.H; y++) for (let x = 0; x < src.W; x++) {
        const c = src.data[y * src.W + (flipX ? src.W - 1 - x : x)];
        if (c >>> 24 === 0) continue;
        this.setN(ox + x, oy + y, c);
      }
      return;
    }
    const k = src.S / S;
    for (let y = 0; y < Math.round(src.h * S); y++) for (let x = 0; x < Math.round(src.w * S); x++) {
      const sx = Math.floor(x * k), sy = Math.floor(y * k);
      const c = src.data[sy * src.W + (flipX ? src.W - 1 - sx : sx)];
      if (c >>> 24 === 0) continue;
      this.setN(ox + x, oy + y, c);
    }
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.W;
    c.height = this.H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(this.W, this.H);
    new Uint32Array(img.data.buffer).set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
