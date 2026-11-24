import { MAP_H, MAP_W, TILE, WORLD_H, WORLD_W } from '../config';
import { hash2, makeCanvas, outlineRegion } from './pixel';
import { col, rampOf, RAMPS, Raster, type Ramp } from './raster';
import { textWidth } from './font';
import { Tile, type ShipMap } from '../world/ShipMap';
import { PROP_DEFS, type FloorStyle } from '../data/rooms';
import type { RoomId } from '../types';

/**
 * NAVE BIOMECÁNICA: costillas húmedas de cromo negro, vértebras y tendones color hueso,
 * rejillas profundas con calor debajo, venas bioluminiscentes… y pegatinas corporativas absurdas.
 * Todo se rasteriza a densidad nativa (Raster.SCALE) para que tenga mucho más detalle.
 */

/** 32 unidades de diseño por casilla de 16 píxeles de mundo. */
const T = 32;

export interface Lamp { x: number; y: number; wx: number; wy: number; room: RoomId; color: number }
export interface NavLight { x: number; y: number; color: number; phase: number }
interface Sign { tx: number; ty: number; w: number; text: string; color: string }
interface Poster { tx: number; ty: number; w: number; kind: string; text?: string }

export interface Decor {
  lamps: Lamp[];
  nav: NavLight[];
  runway: { x: number; y: number }[];
  signs: Sign[];
  posters: Poster[];
  lampTiles: Set<number>;
}

/** color de las lámparas por sala (luz de sodio, fósforo verde, quirófano…) */
export const ROOM_LIGHT: Record<RoomId, number> = {
  puente: 0x8fd8ff, comedor: 0xffbf72, banos: 0xaaffe0, laboratorio: 0xa8ff8a, ingenieria: 0xff9446, dormitorios: 0xc49cff,
  enfermeria: 0xffc0b4, hidroponico: 0xc8ff72, pasillo: 0xffc878,
};
/** tinte de la penumbra de cada sala */
export const ROOM_TINT: Record<RoomId, number> = {
  puente: 0x010814, comedor: 0x110602, banos: 0x01100c, laboratorio: 0x031203, ingenieria: 0x150501, dormitorios: 0x0a0314,
  enfermeria: 0x120305, hidroponico: 0x030f04, pasillo: 0x030508,
};

const SIGN_TEXT: Record<RoomId, string> = {
  puente: 'PUENTE', comedor: 'COMEDOR', banos: 'BAÑOS', laboratorio: 'LABORATORIO', ingenieria: 'INGENIERIA', dormitorios: 'DORMITORIOS',
  enfermeria: 'ENFERMERIA', hidroponico: 'HIDROPONICO', pasillo: '',
};
const POSTER_TEXT = ['SONRIA', 'NO LAMER', 'FREGAR', 'NO CORRER', 'CALMA', 'TODO OK'];

const G: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'], G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'], 'Ñ': ['111', '000', '110', '101', '101'], O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'], Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'], Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'], '>': ['100', '010', '001', '010', '100'],
  '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'], '!': ['010', '010', '010', '000', '010'], '?': ['110', '001', '010', '000', '010'],
  '.': ['000', '000', '000', '000', '010'], '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '3': ['110', '001', '010', '001', '110'],
};
function text(r: Raster, x: number, y: number, s: string, c: string, scale = 1) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = G[ch] ?? G[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j][i] === '1') r.rect(cx + i * scale, y + j * scale, scale, scale, c);
    cx += 4 * scale;
  }
}

function isFace(m: ShipMap, tx: number, ty: number) {
  return m.tile(tx, ty) === Tile.Wall && m.isFloorish(tx, ty + 1);
}

export function layoutDecor(map: ShipMap, seed: number): Decor {
  const used = new Set<number>();
  for (const f of map.fixtures) used.add(map.idx(f.tx, f.ty));
  const decor: Decor = { lamps: [], nav: [], runway: [], signs: [], posters: [], lampTiles: new Set() };
  const tallBelow = (tx: number, ty: number) => { const p = map.propAt[map.idx(tx, ty + 1)]; return !!p && PROP_DEFS[p.kind].up > 5; };
  const free = (tx: number, ty: number) => isFace(map, tx, ty) && !used.has(map.idx(tx, ty)) && !map.doorAt[map.idx(tx, ty)] && !tallBelow(tx, ty);
  for (const room of map.rooms) {
    if (room.id === 'pasillo') continue;
    const door = room.doors.find((d) => d.orient === 'h');
    if (!door) continue;
    const label = SIGN_TEXT[room.id];
    const wt = Math.ceil((textWidth(label) + 6) / 16);
    const dx = door.tiles[0].tx, ty = door.tiles[0].ty;
    for (const sx of [dx + 2, dx - wt, dx + 3, dx - wt - 1, dx + 4, dx - wt - 2]) {
      let ok = true;
      for (let i = 0; i < wt; i++) if (!free(sx + i, ty)) ok = false;
      if (!ok) continue;
      for (let i = 0; i < wt; i++) used.add(map.idx(sx + i, ty));
      decor.signs.push({ tx: sx, ty, w: wt, text: label, color: room.accent });
      break;
    }
  }
  for (const room of map.rooms) {
    const fy = room.y - 1;
    const step = room.id === 'pasillo' ? 5 : 4;
    for (let x = room.x + 1; x < room.x + room.w; x += step) {
      let tx = x;
      if (!free(tx, fy)) tx = x + 1;
      if (!free(tx, fy)) continue;
      used.add(map.idx(tx, fy));
      decor.lampTiles.add(map.idx(tx, fy));
      decor.lamps.push({ x: tx * TILE + 8, y: (fy + 1) * TILE + 14, wx: tx * TILE + 8, wy: fy * TILE + 4, room: room.id, color: ROOM_LIGHT[room.id] });
    }
  }
  for (const room of map.rooms) {
    if (room.id === 'pasillo') continue;
    const fy = room.y - 1;
    let n = 0;
    for (let x = room.x; x < room.x + room.w && n < 3; x++) {
      if (!free(x, fy)) continue;
      const rr = hash2(x, fy, seed + 7);
      if (rr > 0.42) continue;
      if (rr < 0.12 && free(x + 1, fy)) {
        used.add(map.idx(x, fy)); used.add(map.idx(x + 1, fy));
        decor.posters.push({ tx: x, ty: fy, w: 2, kind: 'text', text: POSTER_TEXT[Math.floor(hash2(x, 3, seed) * POSTER_TEXT.length)] });
        x++;
      } else {
        used.add(map.idx(x, fy));
        const kinds = ['smile', 'warn', 'screen', 'clock', 'extinguisher', 'mop', 'egg'];
        decor.posters.push({ tx: x, ty: fy, w: 1, kind: kinds[Math.floor(hash2(x, fy, seed + 3) * kinds.length)] });
      }
      n++;
    }
  }
  for (const y of [5, 13, 21]) {
    decor.nav.push({ x: 8, y: y * TILE + 8, color: 0xff3040, phase: y * 0.3 });
    decor.nav.push({ x: WORLD_W - 8, y: y * TILE + 8, color: 0x40ff70, phase: y * 0.3 + 1 });
  }
  for (const x of [8, 24, 40, 56]) {
    decor.nav.push({ x: x * TILE + 8, y: 8, color: 0xffb040, phase: x * 0.2 });
    decor.nav.push({ x: x * TILE + 8, y: WORLD_H - 8, color: 0xffb040, phase: x * 0.2 + 2 });
  }
  const corr = map.room('pasillo');
  const cy = corr.y + 1;
  for (let x = corr.x + 1; x < corr.x + corr.w - 1; x += 3) if (map.isWalkable(x, cy)) decor.runway.push({ x: x * TILE + 8, y: cy * TILE + 8 });
  return decor;
}

// ───────────────────────── utilidades de textura nativa ─────────────────────────

const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
type RN = number[];
const rn = (r: Ramp): RN => r.map((c) => col(c));

/** color de una rampa con tramado ordenado a resolución nativa */
function pick(r: RN, v: number, X: number, Y: number, d = 0.85): number {
  const n = r.length;
  const f = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
  const i = Math.floor(f);
  const thr = 0.5 + (BAY[((Y & 3) << 2) | (X & 3)] - 0.5) * d;
  return r[Math.min(n - 1, i + (f - i > thr ? 1 : 0))];
}

/** mezcla dos colores ABGR */
function mix(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return (b | 0xff000000) >>> 0;
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  return ((255 << 24) | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** ruido de valor suave */
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x: number, y: number, s: number) => vnoise(x, y, s) * 0.62 + vnoise(x * 2.3, y * 2.3, s + 7) * 0.38;

/** cromo negro biomecánico → hueso (las luces de la carne de la nave) */
const BIO = rn(['#020303', '#060809', '#0c0f10', '#141819', '#1d2324', '#283031', '#363f3e', '#4b5450', '#6a705f', '#949178', '#c4bc9c', '#ece4c8']);
const BONE = rn(RAMPS.bone);
const OIL = rn(['#020304', '#05080a', '#0a0e12', '#10161b', '#182027', '#222c35', '#2f3c47', '#41525f']);
const GUN = rn(['#040506', '#090b0e', '#0f1318', '#161c22', '#1f272e', '#2a343c', '#38444d', '#4d5c66', '#6e808b', '#a3b4bd']);
const WHITE = col('#ffffff');
const WET = col('#9fc4d4');
const SHADOW = col('#020203');

const FL = {
  bridge: rn(['#03060c', '#060c16', '#0b1422', '#111d30', '#18283f', '#22364f', '#304864', '#47637e']),
  creamDirty: rn(['#1a140c', '#2e2416', '#4a3c26', '#66573a', '#837452', '#a0906a', '#b9aa82', '#d0c39c']),
  oxblood: rn(['#0e0406', '#1c080a', '#2e0e10', '#421618', '#561f20', '#6c2a28', '#84392f']),
  celadon: rn(['#0c1412', '#18241f', '#28382f', '#3c4f43', '#536656', '#6c7f6b', '#879a83', '#a6b69d', '#c6d2b8']),
  resin: rn(['#0e110f', '#1a1f1b', '#282e29', '#383f39', '#4b534c', '#5f6860', '#768077', '#919a90']),
  plum: rn(['#08030a', '#110612', '#1a0a1c', '#240f27', '#301533', '#3e1d41', '#4f2751']),
  boneTile: rn(['#1c1a14', '#2f2c22', '#47432f', '#625c42', '#7f7756', '#9c936d', '#b6ad86', '#cdc5a0', '#e2dbba']),
  soil: rn(['#060402', '#0d0904', '#150f07', '#1e160b', '#281e10', '#342816', '#40321c']),
  moss: rn(['#050a03', '#0b1606', '#13240a', '#1c340e', '#284812', '#365e18', '#477a20']),
  heat: rn(['#100302', '#2a0703', '#4a1004', '#721c06', '#a03008', '#d0500c', '#f07a18', '#ffb040', '#ffe08a']),
};

// ───────────────────────── suelos ─────────────────────────

function drawFloor(r: Raster, style: FloorStyle, tx: number, ty: number, seed: number) {
  const x = tx * T, y = ty * T;
  const hz = (k: number) => hash2(tx * 7 + k, ty * 13 - k, seed);
  switch (style) {
    case 'metal': {
      // chapa estriada de cañón oscuro, remaches y brillo húmedo
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        let v = 0.3 + (vnoise(dx * 0.09, dy * 0.09, seed) - 0.5) * 0.14;
        const a = (((lx + ly) / 5) % 1 + 1) % 1, b = (((lx - ly) / 5) % 1 + 1) % 1;
        if (Math.abs(a - 0.5) < 0.12 && Math.abs(b - 0.5) < 0.3) v += a < 0.5 ? 0.17 : 0.04;
        if (lx < 0.5 || ly < 0.5 || lx > 31.5 || ly > 31.5) v = 0.06;
        else if (lx < 1.1 || ly < 1.1) v += 0.16;
        else if (lx > 30.6 || ly > 30.6) v -= 0.12;
        for (const [cx, cy] of [[3.5, 3.5], [28.5, 3.5], [3.5, 28.5], [28.5, 28.5]]) {
          const d = Math.hypot(lx - cx, ly - cy);
          if (d < 1.4) v = 0.62 - (lx - cx + ly - cy) * 0.18;
          else if (d < 1.9) v -= 0.08;
        }
        let c = pick(GUN, v, X, Y);
        const w = vnoise(dx * 0.012 + 9, dy * 0.16, seed + 5) * 0.7 + vnoise(dx * 0.05, dy * 0.3, seed + 6) * 0.3;
        if (w > 0.64) c = mix(c, WET, Math.min(0.2, (w - 0.64) * 1.4));
        return c;
      });
      if (hz(1) < 0.1) { r.lineN(x + 7, y + 22, x + 14, y + 19, '#05070a'); r.lineN(x + 14, y + 19, x + 17, y + 21, '#05070a'); }
      break;
    }
    case 'bridge': {
      // paneles pulidos de cromo azulado con circuitería que respira
      const glow = col('#3fe0ff'), soft = col('#0f4a60');
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        let v = 0.3 + (1 - ly / 32) * 0.1 + (vnoise(dx * 0.05, dy * 0.05, seed) - 0.5) * 0.1;
        if (Math.abs(lx - 16) < 0.4 || lx < 0.5 || ly < 0.5) v = 0.08;
        else if (lx < 1 || Math.abs(lx - 16.9) < 0.5) v += 0.2;
        const k = ((lx * 0.6 + ly) % 22 + 22) % 22;
        if (k < 2.2) v += 0.1;
        let c = pick(FL.bridge, v, X, Y);
        const cx = Math.floor(dx / 4), cy = Math.floor(dy / 4), fx = dx - cx * 4, fy = dy - cy * 4;
        const hzc = hash2(cx, cy, 31), vzc = hash2(cx, cy, 37);
        let d = 9;
        if (hzc < 0.15) d = Math.min(d, Math.abs(fy - 2));
        if (vzc < 0.1) d = Math.min(d, Math.abs(fx - 2));
        if (hzc < 0.15 && vzc < 0.1) d = Math.min(d, Math.hypot(fx - 2, fy - 2) - 0.4);
        if (d < 0.28) c = mix(c, glow, 0.7);
        else if (d < 1.1) c = mix(c, soft, 0.45 * (1 - d / 1.1));
        return c;
      });
      break;
    }
    case 'checker': {
      // baldosa de cafetería retro… con décadas de grasa
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        const i = Math.floor(lx / 16), j = Math.floor(ly / 16);
        const light = (i + j + tx * 2 + ty * 2) % 2 === 0;
        const gx = lx - i * 16, gy = ly - j * 16;
        const grime = vnoise(dx * 0.12, dy * 0.12, seed + 2);
        if (gx < 0.6 || gy < 0.6) return pick(BIO, 0.12 + grime * 0.08, X, Y);
        let v = (light ? 0.58 : 0.5) - grime * 0.22 + (1 - gx / 16 - gy / 16) * 0.06;
        if (gx < 1.2 || gy < 1.2) v += 0.1;
        return pick(light ? FL.creamDirty : FL.oxblood, v, X, Y);
      });
      if (hz(4) < 0.12) { r.lineN(x + 4, y + 9, x + 11, y + 13, '#1a0f08'); r.lineN(x + 11, y + 13, x + 13, y + 20, '#1a0f08'); }
      break;
    }
    case 'tiles': {
      // azulejo de baño color celadón, junta podrida
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        const i = Math.floor(lx / 8), j = Math.floor(ly / 8);
        const gx = lx - i * 8, gy = ly - j * 8;
        const dirt = vnoise(dx * 0.15, dy * 0.15, seed + 3);
        if (gx < 0.7 || gy < 0.7) return pick(FL.celadon, 0.12 + (1 - dirt) * 0.1, X, Y);
        const tone = hash2(tx * 4 + i, ty * 4 + j, seed) < 0.14 ? 0.5 : 0.66;
        let v = tone - dirt * 0.18 + (1 - gx / 8 - gy / 8) * 0.08;
        if (gx < 1.3 && gy < 1.3) v += 0.25;
        return pick(FL.celadon, v, X, Y);
      });
      if (hz(9) < 0.06) {
        r.forN(x + 9, y + 9, 14, 14, (X, Y, u, v) => {
          const d = Math.hypot(u - 0.5, v - 0.5);
          if (d > 0.5) return 0;
          const slot = Math.abs(((v * 5) % 1) - 0.5) < 0.18 && d < 0.4;
          return slot ? SHADOW : pick(GUN, 0.55 - u * 0.2 - v * 0.2, X, Y);
        });
      }
      break;
    }
    case 'lab': {
      // resina de laboratorio con marcas de riesgo biológico
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        let v = 0.52 + (vnoise(dx * 0.04, dy * 0.04, seed + 4) - 0.5) * 0.2 - vnoise(dx * 0.3, dy * 0.3, seed) * 0.08;
        if (lx < 0.4 || ly < 0.4) v -= 0.25;
        return pick(FL.resin, v, X, Y);
      });
      if (hz(3) < 0.07) {
        const yl = col('#d8b020'), bk = col('#141008');
        r.forN(x + 6, y + 6, 20, 20, (_X, _Y, u, v) => {
          const d = Math.hypot(u - 0.5, v - 0.5);
          if (d > 0.5) return 0;
          if (d > 0.42) return yl;
          const a = Math.atan2(v - 0.5, u - 0.5);
          return d > 0.12 && Math.cos(a * 3) > 0.35 ? bk : d < 0.07 ? bk : 0;
        });
      }
      break;
    }
    case 'grate': {
      // rejilla pesada de ingeniería: debajo arde el reactor
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        const bar = ((ly % 4.5) + 4.5) % 4.5;
        const support = Math.abs(lx - 16) < 1.3 || lx < 1.3;
        if (bar < 2.4 || support) {
          const n = support ? (lx < 1.3 ? lx / 1.3 : (lx - 14.7) / 2.6) : bar / 2.4;
          const v = 0.22 + (1 - Math.abs(n - 0.35) * 1.6) * 0.32 + (vnoise(dx * 0.2, dy * 0.2, seed) - 0.5) * 0.1;
          return pick(GUN, v, X, Y);
        }
        const heat = vnoise(dx * 0.06, dy * 0.06 + 3, seed + 8);
        const depth = (bar - 2.4) / 2.1;
        return pick(FL.heat, heat * 0.55 - depth * 0.25 + 0.05, X, Y, 0.6);
      });
      break;
    }
    case 'carpet': {
      // moqueta ciruela con un dibujo orgánico que nadie pidió
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const f = vnoise(dx * 0.07, dy * 0.07, seed + 6);
        const contour = Math.abs(((f * 9) % 1) - 0.5) < 0.07;
        const fiber = hash2(X, Y, 77) * 0.12;
        const v = 0.42 + fiber - (contour ? 0.14 : 0) + (vnoise(dx * 0.02, dy * 0.02, seed) - 0.5) * 0.15;
        return pick(FL.plum, v, X, Y, 0.5);
      });
      break;
    }
    case 'medical': {
      // baldosa color hueso, ligeramente amarillenta
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const lx = dx - x, ly = dy - y;
        const gx = lx % 16, gy = ly % 16;
        if (gx < 0.6 || gy < 0.6) return pick(FL.boneTile, 0.2, X, Y);
        let v = 0.72 - vnoise(dx * 0.08, dy * 0.08, seed + 1) * 0.18 + (1 - gx / 16 - gy / 16) * 0.06;
        if (gx < 1.2 || gy < 1.2) v += 0.1;
        return pick(FL.boneTile, v, X, Y);
      });
      if ((tx + ty) % 4 === 0) { r.rect(x + 14.5, y + 10, 3, 12, '#9a2a2a'); r.rect(x + 10, y + 14.5, 12, 3, '#9a2a2a'); r.rect(x + 14.5, y + 10, 3, 0.5, '#c85a50'); }
      break;
    }
    case 'garden': {
      // tierra húmeda, musgo y raíces con esporas que brillan
      const spore = col('#b8ff7a'), root = col('#6a5a3a');
      r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
        const m = vnoise(dx * 0.08, dy * 0.08, seed + 12);
        const rt = Math.abs(vnoise(dx * 0.11, dy * 0.11, seed + 19) - 0.5);
        if (rt < 0.025) return mix(root, WHITE, 0.08);
        if (hash2(X, Y, seed + 3) > 0.9985) return spore;
        if (m > 0.55) return pick(FL.moss, 0.25 + (m - 0.55) * 1.4 + hash2(X, Y, 5) * 0.15, X, Y, 0.6);
        return pick(FL.soil, 0.35 + m * 0.4 + hash2(X, Y, 9) * 0.12, X, Y, 0.6);
      });
      break;
    }
  }
}

// ───────────────────────── paredes biomecánicas ─────────────────────────

/** frontal de pared: costillas vertebradas de cromo negro, tendón de hueso y vena luminosa */
function drawWallFace(r: Raster, accent: string, outer: boolean, tx: number, ty: number, seed: number, plain: boolean) {
  const x = tx * T, y = ty * T;
  const acc = col(accent);
  const dark = col('#050606');
  r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
    const ly = dy - y;
    if (ly < 4) {
      // cornisa
      const v = 0.36 - ly * 0.05 + (ly < 0.6 ? 0.4 : 0) + (vnoise(dx * 0.4, 0, seed) - 0.5) * 0.08;
      return pick(BIO, v, X, Y);
    }
    if (ly >= 28.5) {
      // zócalo de nudillos
      const k = ((dx % 6) + 6) % 6 / 6;
      return pick(BIO, 0.1 + Math.sin(k * Math.PI) * 0.16 - (ly - 28.5) * 0.04, X, Y);
    }
    if (ly >= 26.5) {
      // vena bioluminiscente con el color de la sala
      const g = 0.55 + 0.45 * Math.sin(dx * 0.45 + Math.sin(dx * 0.13) * 2);
      const core = 1 - Math.abs(ly - 27.5);
      return mix(dark, acc, Math.max(0, 0.25 + 0.6 * g * core));
    }
    // panel de costillas (continuo entre casillas)
    const P = 8;
    const rx = (((dx + 4) % P) + P) % P / P - 0.5;
    const seg = ((ly - 4) % 7.5) / 7.5;
    const joint = Math.exp(-(seg * seg) / 0.006) + Math.exp(-((seg - 1) ** 2) / 0.006);
    const half = 0.36 - 0.1 * joint;
    const ar = Math.abs(rx);
    let v: number;
    if (ar < half) {
      const n = rx / half;
      const h = Math.sqrt(1 - n * n);
      const lit = Math.max(0, Math.min(1, -n * 0.55 + h * 0.62));
      v = 0.1 + lit * 0.78 - (ly - 4) / 22 * 0.1 - joint * 0.24;
    } else {
      const gx = (ar - half) / (0.5 - half);
      v = 0.03 + (1 - gx) * 0.07 + (Math.abs(((ly * 0.9) % 3) - 1.5) < 0.3 ? 0.04 : 0);
    }
    v += (vnoise(dx * 0.35, dy * 0.35, seed) - 0.5) * 0.07;
    let c = pick(BIO, v, X, Y);
    // brillo húmedo en las crestas
    if (ar < half * 0.3 && rx < 0 && hash2(Math.floor((dx + 4) / P), Math.floor(dy / 4), seed + 9) < 0.4) c = mix(c, WET, 0.4);
    return c;
  });
  // tendón vertebral que recorre toda la pared
  r.capsule(x - 1, y + 9.5, x + T + 1, y + 9.5, 2.1, RAMPS.bone);
  for (let k = Math.ceil(x / 6) * 6; k < x + T; k += 6) {
    r.blendRect(k, y + 7.5, 0.5, 4, '#0c0906', 0.75);
    r.blendRect(k + 0.5, y + 7.5, 0.5, 2, '#fff8e0', 0.25);
  }
  r.blendRect(x, y + 11.5, T, 0.5, '#000000', 0.5);
  if (plain) return;
  if ((tx * 5 + ty * 3) % 4 === 0) {
    // columna vertebral incrustada en la pared
    r.capsule(x + 16, y + 3, x + 16, y + 29, 2.2, RAMPS.sinew);
    for (let k = 0; k < 5; k++) {
      const vy = y + 6 + k * 5;
      r.capsule(x + 9, vy + 1, x + 23, vy + 1, 1.1, RAMPS.bone);
      r.blob(x + 16, vy, 4.6, 2.5, RAMPS.bone, { spec: true });
      r.blendRect(x + 12, vy + 2.2, 8, 0.5, '#000000', 0.55);
    }
    return;
  }
  const n = hash2(tx, ty, seed);
  if (outer && n < 0.45) {
    // ojo de buey ovalado con marco de hueso
    r.forN(x + 5, y + 5, 22, 18, (X, Y, u, v) => {
      const d = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
      if (d > 1) return 0;
      if (d > 0.78) return pick(BONE, 0.75 - (u + v) * 0.35 + (d - 0.78) * 0.5, X, Y);
      if (d > 0.7) return SHADOW;
      const st = hash2(X, Y, seed + 41);
      return st > 0.993 ? WHITE : st > 0.985 ? col('#7a94c8') : mix(col('#010205'), col('#0a1426'), v);
    });
    r.forN(x + 9, y + 8, 6, 6, (_X, _Y, u, v) => (u + v < 0.9 && u + v > 0.6 ? mix(col('#0a1426'), WHITE, 0.35) : 0));
  } else if (n < 0.14) {
    // rejilla de ventilación que babea
    r.forN(x + 7, y + 13, 18, 9, (X, Y, u, v) => {
      const d = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
      if (d > 1) return 0;
      if (d > 0.82) return pick(BONE, 0.55 - v * 0.3, X, Y);
      return Math.abs(((v * 4) % 1) - 0.5) < 0.22 ? SHADOW : pick(BIO, 0.2, X, Y);
    });
    for (const [ox, len] of [[10, 6], [15, 9], [21, 4]]) {
      r.capsule(x + ox, y + 20, x + ox, y + 20 + len, 0.7, RAMPS.acid);
      r.blob(x + ox, y + 20 + len, 1.1, 1.4, RAMPS.acid, { spec: true });
    }
  } else if (n < 0.26) {
    // manguera orgánica que cuelga
    let px = x + 1, py = y + 13;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, nx = x + 1 + t * 30, ny = y + 13 + Math.sin(t * Math.PI) * 9;
      r.capsule(px, py, nx, ny, 1.6, RAMPS.sinew);
      px = nx; py = ny;
    }
    for (let i = 2; i < 16; i += 3) { const t = i / 16; r.blendRect(x + 1 + t * 30, y + 11.5 + Math.sin(t * Math.PI) * 9, 0.5, 3, '#0a0405', 0.6); }
  } else if (n < 0.34) {
    // caja de control con pilotos
    r.box3d(x + 19, y + 14, 9, 2, 9, RAMPS.chrome, RAMPS.chrome, { r: 1 });
    r.blob(x + 21.5, y + 18.5, 1.1, 1.1, (n * 100) % 2 < 1 ? RAMPS.acid : RAMPS.amber, { spec: true });
    r.blob(x + 25.5, y + 18.5, 1.1, 1.1, RAMPS.red, { spec: true });
    r.rect(x + 20.5, y + 21.5, 6, 0.5, '#3a4a40');
  } else if (n < 0.4) {
    // pegatina corporativa
    r.shadeRect(x + 6, y + 15, 20, 8, rampOf('#e8c020', 5), (u, v) => 0.8 - u * 0.2 - v * 0.2, 1);
    text(r, x + 8, y + 16.5, 'NO LAMER', '#1a1206', 0.5);
    text(r, x + 8, y + 19.5, 'LA PARED', '#1a1206', 0.5);
  } else if (n < 0.45) {
    // franjas de peligro gastadas
    r.forN(x, y + 14, T, 4, (X, Y, _u, _v, dx, dy) => {
      const s = Math.floor((dx + dy) / 3) % 2 === 0;
      const wear = vnoise(dx * 0.4, dy * 0.4, seed + 5) > 0.68;
      return wear ? pick(BIO, 0.18, X, Y) : s ? pick(rn(RAMPS.amber), 0.62, X, Y) : pick(BIO, 0.08, X, Y);
    });
  } else if (n < 0.49) {
    // huevo incrustado en la pared (nadie sabe de quién es)
    r.blob(x + 16, y + 19, 4.2, 5, RAMPS.flesh, { spec: true });
    r.lineN(x + 14, y + 16, x + 18, y + 16, '#2a0a0c');
    r.lineN(x + 16, y + 14.5, x + 16, y + 17, '#2a0a0c');
  }
}

/** parte superior de los muros: espinazo de vértebras sobre carne de aceite */
function drawWallTop(r: Raster, m: ShipMap, tx: number, ty: number, seed: number) {
  const x = tx * T, y = ty * T;
  const W = (a: number, b: number) => m.tile(a, b) === Tile.Wall;
  const f = (a: number, b: number) => m.isFloorish(a, b);
  const horiz = W(tx - 1, ty) || W(tx + 1, ty);
  const vert = W(tx, ty - 1) || W(tx, ty + 1);
  r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
    const lx = dx - x, ly = dy - y;
    let v = 0.22 + (vnoise(dx * 0.12, dy * 0.12, seed + 21) - 0.5) * 0.16;
    // costillas perpendiculares al espinazo
    if (horiz) { const k = ((dx % 6) + 6) % 6; v += Math.abs(ly - 16) > 5 && k < 2 ? 0.08 - k * 0.03 : 0; }
    if (vert) { const k = ((dy % 6) + 6) % 6; v += Math.abs(lx - 16) > 5 && k < 2 ? 0.08 - k * 0.03 : 0; }
    return pick(OIL, v, X, Y);
  });
  if (horiz) {
    r.capsule(x - 1, y + 16, x + T + 1, y + 16, 3.4, RAMPS.sinew);
    for (let k = Math.ceil(x / 8) * 8; k < x + T; k += 8) r.blob(k + 4, y + 16, 3, 4.2, RAMPS.bone, { spec: true });
  }
  if (vert) {
    r.capsule(x + 16, y - 1, x + 16, y + T + 1, 3.4, RAMPS.sinew);
    for (let k = Math.ceil(y / 8) * 8; k < y + T; k += 8) r.blob(x + 16, k + 4, 4.2, 3, RAMPS.bone, { spec: true });
  }
  if (!horiz && !vert) r.blob(x + 16, y + 16, 5, 5, RAMPS.bone, { spec: true });
  if ((tx * 7 + ty * 3) % 11 === 0) r.blob(x + 8, y + 8, 2, 2, RAMPS.acid, { spec: true });
  const lip = (bx: number, by: number, bw: number, bh: number, hi: string) => { r.rect(bx, by, bw, bh, hi); };
  if (f(tx - 1, ty)) { lip(x, y, 2.5, T, '#4b5450'); r.rect(x + 2.5, y, 0.5, T, '#000000'); }
  if (f(tx + 1, ty)) { lip(x + T - 2.5, y, 2.5, T, '#283031'); r.rect(x + T - 3, y, 0.5, T, '#000000'); }
  if (f(tx, ty - 1)) { lip(x, y, T, 2.5, '#6a705f'); r.rect(x, y + 2.5, T, 0.5, '#000000'); }
  if (m.tile(tx, ty + 1) === Tile.Void) {
    r.shadeRect(x, y + T - 6, T, 6, RAMPS.chrome, (u, v) => 0.5 - v * 0.3);
    r.rect(x, y + T - 6, T, 0.5, '#9db4c6');
  }
}

function nearWall(m: ShipMap, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.tile(tx + dx, ty + dy) === Tile.Wall) return true;
  return false;
}

/** casco exterior: blindaje acanalado, espinas y luces de posición */
function drawHull(r: Raster, m: ShipMap, tx: number, ty: number, seed: number) {
  const x = tx * T, y = ty * T;
  const v = (a: number, b: number) => m.tile(a, b) === Tile.Void && !nearWall(m, a, b);
  r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
    const lx = dx - x, ly = dy - y;
    const rib = ((dy + 1) % 6 + 6) % 6 / 6;
    let vv = 0.2 + Math.sin(rib * Math.PI) * 0.16 + (vnoise(dx * 0.1, dy * 0.1, seed + 11) - 0.5) * 0.12;
    if (rib < 0.08) vv = 0.05;
    if (lx < 0.5 || ly < 0.5) vv -= 0.12;
    return pick(GUN, vv, X, Y);
  });
  const n = hash2(tx, ty, seed + 11);
  if (n < 0.12) {
    r.capsule(x + 16, y + 26, x + 16, y + 6, 1.4, RAMPS.bone);
    r.capsule(x + 16, y + 6, x + 18, y + 2, 0.9, RAMPS.bone);
  } else if (n < 0.2) {
    r.blob(x + 16, y + 16, 3.2, 3.2, RAMPS.amber, { spec: true });
    for (let i = 0; i < 6; i++) r.blendRect(x + 10 + i * 2, y + 21, 1, 0.5, '#ffb040', 0.25);
  } else if (n < 0.27) {
    r.forN(x + 6, y + 10, 20, 12, (X, Y, u, vv) => (Math.abs(((u * 6) % 1) - 0.5) < 0.2 ? SHADOW : pick(GUN, 0.35 - vv * 0.2, X, Y)));
  }
  if (v(tx, ty - 1)) { r.rect(x, y, T, 1, '#4d5c66'); r.rect(x, y + 1, T, 0.5, '#a3b4bd'); }
  if (v(tx - 1, ty)) r.rect(x, y, 1, T, '#38444d');
  if (v(tx, ty + 1)) r.rect(x, y + T - 1.5, T, 1.5, '#020203');
  if (v(tx + 1, ty)) r.rect(x + T - 1.5, y, 1.5, T, '#020203');
}

// ───────────────────────── carteles, pósteres y lámparas ─────────────────────────

function drawPoster(r: Raster, x: number, y: number, kind: string, w: number, label?: string) {
  const W = w * T;
  switch (kind) {
    case 'text': {
      const tw = textWidth(label ?? '') * 2;
      const x0 = x + Math.floor((W - tw - 10) / 2);
      r.shadeRect(x0 - 1, y + 13, tw + 12, 13, RAMPS.chrome, () => 0.3, 1);
      r.shadeRect(x0, y + 14, tw + 10, 11, rampOf('#d8cfb0', 6), (u, v) => 0.82 - u * 0.15 - v * 0.25 - (hash2(Math.floor(u * 40), Math.floor(v * 20), 3) > 0.92 ? 0.15 : 0), 0.5);
      text(r, x0 + 5, y + 17, label ?? '', '#7a1a1a', 2);
      r.blendRect(x0, y + 14, tw + 10, 0.5, '#ffffff', 0.4);
      break;
    }
    case 'smile':
      // «EMPLEADO DEL MES»: un MOP sonriente, siempre el mismo
      r.shadeRect(x + 5, y + 13, 22, 14, RAMPS.chrome, () => 0.3, 1);
      r.shadeRect(x + 6, y + 14, 20, 12, rampOf('#d8cfb0', 5), (u, v) => 0.8 - v * 0.2, 0.5);
      r.blob(x + 16, y + 21, 4, 3.5, rampOf('#f0b98d', 5));
      r.shadeRect(x + 12, y + 15.5, 8, 2.5, RAMPS.amber, (u) => 0.75 - u * 0.2, 1);
      r.rect(x + 14.5, y + 20.5, 1, 1, '#141022'); r.rect(x + 17, y + 20.5, 1, 1, '#141022');
      r.rect(x + 14.5, y + 23, 3, 0.5, '#141022');
      text(r, x + 7, y + 14.5, '1', '#7a1a1a', 0.5);
      break;
    case 'warn':
      for (let i = 0; i < 12; i++) r.rect(x + 16 - i, y + 13 + i, 1 + i * 2, 1, '#d8a820');
      r.blob(x + 16, y + 20, 2.2, 2.2, RAMPS.dark);
      for (const a of [0, 2.09, 4.19]) r.blob(x + 16 + Math.cos(a - 1.57) * 3.2, y + 20 + Math.sin(a - 1.57) * 3.2, 1.4, 1.4, RAMPS.dark);
      r.blob(x + 16, y + 20, 0.9, 0.9, RAMPS.amber);
      break;
    case 'screen':
      r.shadeRect(x + 4, y + 12, 24, 15, RAMPS.chrome, () => 0.25, 1);
      r.screen(x + 6, y + 14, 20, 11, RAMPS.acid, Math.floor(x / T));
      text(r, x + 7.5, y + 15.5, 'MU-13', '#b8ff9a', 0.5);
      break;
    case 'clock':
      r.blob(x + 16, y + 19, 7.5, 7.5, RAMPS.bone, { spec: true });
      r.blob(x + 16, y + 19, 6, 6, rampOf('#d8d2bc', 5));
      r.lineN(x + 16, y + 19, x + 16, y + 14, '#141022'); r.lineN(x + 16, y + 19, x + 19.5, y + 19, '#a01a1a');
      break;
    case 'extinguisher':
      r.shadeRect(x + 8, y + 11, 16, 17, RAMPS.chrome, (u, v) => 0.3 - v * 0.1, 2);
      r.cylinder(x + 16, y + 14, 3.5, 1.2, 11, RAMPS.red);
      r.rect(x + 14, y + 12, 4, 2, '#2a2a30');
      break;
    case 'mop':
      r.shadeRect(x + 5, y + 12, 22, 15, rampOf('#1a2a4a', 6), (u, v) => 0.6 - u * 0.25 - v * 0.2, 1);
      r.capsule(x + 21, y + 14, x + 12, y + 22, 0.8, RAMPS.bone);
      r.blob(x + 11, y + 23.5, 4, 2, RAMPS.white);
      text(r, x + 6.5, y + 13, 'FREGAR', '#e8d8a0', 0.5);
      text(r, x + 6.5, y + 15.5, 'ES AMOR', '#e8d8a0', 0.5);
      break;
    case 'egg':
      // aviso corporativo: «NO TOCAR LOS HUEVOS»
      r.shadeRect(x + 5, y + 12, 22, 15, rampOf('#d8cfb0', 5), (u, v) => 0.8 - u * 0.2 - v * 0.25, 1);
      r.blob(x + 12, y + 21, 3, 3.8, RAMPS.flesh, { spec: true });
      r.blob(x + 19, y + 21.5, 3, 3.6, RAMPS.flesh, { spec: true });
      r.line(x + 8, y + 26, x + 24, y + 16, '#b01a1a', 1);
      text(r, x + 6.5, y + 13, 'NO TOCAR', '#7a1a1a', 0.5);
      break;
  }
}

function drawLamp(r: Raster, x: number, y: number, color: number) {
  const c = `#${color.toString(16).padStart(6, '0')}`;
  // aplique de hueso con ampolla luminosa y cono de luz sobre la pared
  for (let j = 0; j < 18; j++) {
    const spread = 3 + j * 0.75;
    r.blendRect(x + 16 - spread, y + 12 + j, spread * 2, 1, c, 0.13 * (1 - j / 18));
  }
  r.shadeRect(x + 9, y + 5, 14, 6, RAMPS.bone, (u, v) => 0.7 - v * 0.4 - u * 0.15, 2);
  r.blob(x + 16, y + 10, 4, 2.2, rampOf(c, 5, 0.3), { spec: true });
  r.blendRect(x + 12, y + 9.5, 8, 0.5, '#ffffff', 0.8);
}

// ───────────────────────── lienzo de la nave ─────────────────────────

export function drawShipCanvas(map: ShipMap, seed: number, decor: Decor, opts: { iso?: boolean } = {}): HTMLCanvasElement {
  const iso = !!opts.iso;
  const r = new Raster(MAP_W * T, MAP_H * T);
  const special = new Set<number>(decor.lampTiles);
  for (const s of decor.signs) for (let i = 0; i < s.w; i++) special.add(map.idx(s.tx + i, s.ty));
  for (const p of decor.posters) for (let i = 0; i < p.w; i++) special.add(map.idx(p.tx + i, p.ty));
  const reactor = map.props.find((p) => p.kind === 'reactor');
  const amber = rn(RAMPS.amber);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const t = map.tile(tx, ty);
    const x = tx * T, y = ty * T;
    if (t === Tile.Void) { if (!iso && nearWall(map, tx, ty)) drawHull(r, map, tx, ty, seed); continue; }
    if (t === Tile.Floor || t === Tile.Door) {
      const rid = map.roomAt[map.idx(tx, ty)];
      const room = rid ? map.room(rid) : null;
      const door = map.doorAt[map.idx(tx, ty)];
      drawFloor(r, door ? 'metal' : room?.floor ?? 'metal', tx, ty, seed);
      if (door) {
        if (door.orient === 'h') {
          r.rect(x, y, 2, T, '#020303'); r.rect(x + T - 2, y, 2, T, '#020303');
          r.forN(x, y + 13, T, 6, (X, Y, _u, _v, dx) => ((Math.floor(dx / 3) % 2) ? pick(amber, 0.6, X, Y) : pick(BIO, 0.08, X, Y)));
        } else {
          r.rect(x, y, T, 2, '#020303'); r.rect(x, y + T - 2, T, 2, '#020303');
          r.forN(x + 13, y, 6, T, (X, Y, _u, _v, _dx, dy) => ((Math.floor(dy / 3) % 2) ? pick(amber, 0.6, X, Y) : pick(BIO, 0.08, X, Y)));
        }
      }
      if (rid === 'pasillo' && !door) {
        const hazard = (yy: number) => r.forN(x, yy, T, 3.5, (X, Y, _u, _v, dx, dy) => {
          const s = Math.floor((dx + dy) / 4) % 2 === 0;
          if (vnoise(dx * 0.3, dy * 0.3, seed + 31) > 0.7) return pick(GUN, 0.22, X, Y);
          return s ? pick(amber, 0.55, X, Y) : pick(BIO, 0.06, X, Y);
        });
        if (map.tile(tx, ty - 1) === Tile.Wall) hazard(y);
        if (map.tile(tx, ty + 1) === Tile.Wall) hazard(y + T - 3.5);
        const corr = map.room('pasillo');
        if (ty === corr.y + 1 && tx % 9 === 4) text(r, x + 10, y + 11, '>', '#8a6a20', 2);
        // canaleta central con líquido de refrigeración
        if (ty === corr.y + Math.floor(corr.h / 2)) {
          r.forN(x, y + 14, T, 4, (X, Y, _u, v) => (v < 0.2 || v > 0.8 ? pick(BIO, 0.12, X, Y) : mix(col('#03140f'), col('#1f8a6a'), 0.35 + 0.25 * Math.sin((X + Y * 0.3) * 0.15))));
        }
      }
      if (room && room.floor === 'carpet' && !door) {
        const lx = tx - room.x, ly = ty - room.y;
        if (lx >= 4 && lx <= 9 && ly >= 3 && ly <= 5) {
          const rug = rn(rampOf('#5a1a2a', 7, 0.5));
          r.forN(x, y, T, T, (X, Y, _u, _v, dx, dy) => {
            const p = Math.abs(((dx + dy) % 8) - 4) + Math.abs(((dx - dy + 800) % 8) - 4);
            return pick(rug, 0.38 + (p < 2 ? 0.14 : 0) + hash2(X, Y, 3) * 0.08, X, Y, 0.5);
          });
          const border = '#a89c80';
          if (lx === 4) r.rect(x, y, 3, T, border);
          if (lx === 9) r.rect(x + T - 3, y, 3, T, border);
          if (ly === 3) r.rect(x, y, T, 3, border);
          if (ly === 5) r.rect(x, y + T - 3, T, 3, border);
        }
      }
      if (reactor && !door) {
        const inX = tx >= reactor.tx - 1 && tx <= reactor.tx + reactor.w;
        const inY = ty >= reactor.ty - 1 && ty <= reactor.ty + reactor.h;
        const inside = tx >= reactor.tx && tx < reactor.tx + reactor.w && ty >= reactor.ty && ty < reactor.ty + reactor.h;
        if (inX && inY && !inside && !map.propAt[map.idx(tx, ty)]) {
          const stripe = (bx: number, by: number, bw: number, bh: number) => r.forN(bx, by, bw, bh, (X, Y, _u, _v, dx, dy) => (Math.floor((dx + dy) / 4) % 2 ? pick(amber, 0.62, X, Y) : pick(BIO, 0.06, X, Y)));
          if (ty === reactor.ty - 1) stripe(x, y + T - 5, T, 5);
          if (ty === reactor.ty + reactor.h) stripe(x, y, T, 5);
          if (tx === reactor.tx - 1) stripe(x + T - 5, y, 5, T);
          if (tx === reactor.tx + reactor.w) stripe(x, y, 5, T);
        }
      }
      // oclusión ambiental bajo y junto a los muros
      if (map.tile(tx, ty - 1) === Tile.Wall) r.forN(x, y, T, 14, (X, Y, _u, v) => { r.blendN(X, Y, SHADOW, 0.62 * (1 - v) ** 1.7); return 0; });
      if (map.tile(tx - 1, ty) === Tile.Wall) r.forN(x, y, 8, T, (X, Y, u) => { r.blendN(X, Y, SHADOW, 0.4 * (1 - u) ** 1.5); return 0; });
      if (map.tile(tx + 1, ty) === Tile.Wall) r.forN(x + T - 4, y, 4, T, (X, Y, u) => { r.blendN(X, Y, SHADOW, 0.25 * u); return 0; });
      if (iso) {
        // bisel de bloque: cada casilla se lee como la cara superior de un bloque
        r.blendRect(x, y, T, 0.5, '#ffffff', 0.12);
        r.blendRect(x, y + 0.5, 0.5, T - 0.5, '#ffffff', 0.08);
        r.blendRect(x, y + T - 0.5, T, 0.5, '#000000', 0.5);
        r.blendRect(x + T - 0.5, y, 0.5, T, '#000000', 0.38);
      }
    } else if (t === Tile.Wall) {
      if (iso) { r.rect(x, y, T, T, '#05080a'); continue; }
      if (map.isFloorish(tx, ty + 1)) {
        const rid = map.roomAt[map.idx(tx, ty + 1)];
        drawWallFace(r, rid ? map.room(rid).accent : '#ffb040', map.tile(tx, ty - 1) === Tile.Void, tx, ty, seed, special.has(map.idx(tx, ty)));
      } else drawWallTop(r, map, tx, ty, seed);
    }
  }
  if (!iso) for (const l of decor.lamps) drawLamp(r, (l.wx - 8) * 2, (l.wy - 4) * 2, l.color);
  if (!iso) for (const s of decor.signs) {
    const W = s.w * T;
    const tw = textWidth(s.text) * 2;
    const x0 = s.tx * T + Math.floor((W - tw - 10) / 2), y0 = s.ty * T + 13;
    r.shadeRect(x0 - 1, y0 - 1, tw + 12, 13, RAMPS.chrome, (u, v) => 0.35 - v * 0.2, 1.5);
    r.rect(x0, y0 - 1, tw + 10, 0.5, '#9db4c6');
    const glow = s.color;
    for (let k = 0; k < 3; k++) r.blendRect(x0 - 1 - k, y0 - 1 - k, tw + 12 + k * 2, 13 + k * 2, glow, 0.05);
    text(r, x0 + 5, y0 + 2.5, s.text, rampOf(glow, 6)[5], 2);
    for (const bx of [x0 + 1.5, x0 + tw + 7.5]) r.blob(bx, y0 + 5.5, 1, 1, RAMPS.bone, { spec: true });
  }
  if (!iso) for (const p of decor.posters) drawPoster(r, p.tx * T, p.ty * T, p.kind, p.w, p.text);
  // sombras de contacto del mobiliario
  for (const p of map.props) {
    if (!p.blocks) continue;
    const cx = (p.tx * TILE + p.w * 8) * 2 + 2, cy = ((p.ty + p.h) * TILE - 1) * 2;
    const rx = Math.max(8, p.w * 16 - 2), ry = 4.5;
    r.forN(cx - rx, cy - ry, rx * 2, ry * 2, (X, Y, u, v) => {
      const d = (u - 0.5) ** 2 * 4 + (v - 0.5) ** 2 * 4;
      if (d < 1) r.blendN(X, Y, SHADOW, 0.34 * (1 - d));
      return 0;
    });
  }
  return r.toCanvas();
}

// ───────────────────────── fondo espacial ─────────────────────────

export function makeSpaceBackground(seed: number): HTMLCanvasElement {
  // nebulosa fría y polvorienta, estrellas escasas: el espacio profundo da miedo
  const LW = 160, LH = 120, S = 8;
  const low = new Raster(LW, LH, 1);
  const neb = [col('#020305'), col('#04080b'), col('#071012'), col('#0b1716'), col('#141f1a'), col('#2a2a1c'), col('#3e3420')];
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    const f = fbm(x * 0.045, y * 0.06, seed) * 0.7 + fbm(x * 0.13, y * 0.11, seed + 4) * 0.3;
    const k = Math.max(0, Math.min(neb.length - 1, Math.floor((f - 0.32) * 11)));
    low.setN(x, y, neb[k]);
  }
  const c = document.createElement('canvas');
  c.width = LW * S; c.height = LH * S;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(low.toCanvas(), 0, 0, LW * S, LH * S);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const star = (x: number, y: number, rr: number, g: number, b: number, a = 1) => {
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    const i = (y * c.width + x) * 4;
    d[i] = d[i] + (rr - d[i]) * a; d[i + 1] = d[i + 1] + (g - d[i + 1]) * a; d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
  };
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(hash2(i, 1, seed + 5) * c.width), y = Math.floor(hash2(i, 2, seed + 5) * c.height);
    const b = hash2(i, 3, seed + 5);
    if (b > 0.97) { star(x, y, 255, 250, 230); star(x - 1, y, 160, 170, 190, 0.6); star(x + 1, y, 160, 170, 190, 0.6); star(x, y - 1, 160, 170, 190, 0.6); star(x, y + 1, 160, 170, 190, 0.6); }
    else if (b > 0.8) star(x, y, 200, 210, 230, 0.85);
    else star(x, y, 90, 100, 120, 0.6);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function makePlanet(): HTMLCanvasElement {
  // luna tormentosa color ocre, con un anillo de escombros
  const S = 144;
  const r = new Raster(S, S);
  const cx = 72, cy = 72, R = 52;
  const ramp = rn(['#0a0604', '#1a1008', '#2e1e0e', '#4a3216', '#684a20', '#8a662c', '#a8843e', '#c8a45a', '#e4c888']);
  r.forN(cx - R, cy - R, R * 2, R * 2, (X, Y, _u, _v, dx, dy) => {
    const x = dx - cx, y = dy - cy;
    const d2 = (x * x + y * y) / (R * R);
    if (d2 > 1) return 0;
    const nz = Math.sqrt(1 - d2);
    const light = Math.max(0, (-x * 0.62 - y * 0.48) / R + nz * 0.62);
    const band = fbm(x * 0.03 + Math.sin(y * 0.09) * 0.6, y * 0.12, 5);
    const storm = Math.exp(-(((x + 14) ** 2) / 90 + ((y - 10) ** 2) / 40));
    let v = 0.08 + light * 0.7 + (band - 0.5) * 0.35 + storm * 0.2;
    if (d2 > 0.9) v += (d2 - 0.9) * 2.5 * light;
    return pick(ramp, v, X, Y);
  });
  const ring = rn(['#2a2216', '#5a4a30', '#8a7650', '#bca880']);
  r.forN(0, 40, S, 64, (X, Y, _u, _v, dx, dy) => {
    const x = dx - cx, y = (dy - cy) / 0.28;
    const d = Math.hypot(x, y);
    if (d < R + 6 || d > R + 18) return 0;
    if (dy - cy < 0 && Math.hypot(dx - cx, dy - cy) < R) return 0;
    const g = hash2(Math.floor(d * 2), 1, 9);
    return g > 0.35 ? pick(ring, 0.2 + g * 0.7 - (x > 0 ? 0.25 : 0), X, Y) : 0;
  });
  r.outline('#020203', 0.5);
  return r.toCanvas();
}

export { col, makeCanvas, outlineRegion };
