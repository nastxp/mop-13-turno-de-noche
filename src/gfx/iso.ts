/**
 * ESTILO BLOQUES ISOMÉTRICO: generadores de texturas.
 * Personajes hechos de cajas (cabeza grande, cuerpo y extremidades en bloque), mobiliario convertido
 * en bloques «impresos» con su arte actual y muros biomecánicos en bloque. Misma paleta de terror industrial.
 *
 * Coordenadas: unidades de diseño (32 por casilla). Proyección isométrica 2:1:
 *   pantalla.x = (x − y)·A,  pantalla.y = (x + y)·B − z
 */
import { col, rampOf, RAMPS, Raster, type Ramp } from './raster';
import { drawPropHD, PROP_FRAMES } from './props';
import { CHAR_FRAMES } from './characters';
import { PROP_DEFS, type PropKind } from '../data/rooms';
import type { CharLook } from '../data/crew';
import { RESIDUES, type ResidueDef } from '../data/residues';
import { drawResidueHD } from './sprites';
import type { ToolId } from '../types';

export const ISO_A = Math.SQRT1_2;
export const ISO_B = Math.SQRT1_2 / 2;
const A = ISO_A, B = ISO_B;

type Face = ((u: number, v: number, X: number, Y: number) => number) | undefined;
export interface IsoBox { x: number; y: number; z: number; w: number; d: number; h: number; top?: Face; left?: Face; right?: Face }

// ───────────────────────── utilidades de color ─────────────────────────

const hsh = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function scaleC(c: number, k: number): number {
  const r = Math.min(255, (c & 255) * k), g = Math.min(255, ((c >> 8) & 255) * k), b = Math.min(255, ((c >> 16) & 255) * k);
  return ((c & 0xff000000) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

function mixC(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return ((255 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** color liso con grano fino (aspecto de bloque pintado) */
const solid = (hex: string, n = 0.06): Face => {
  const c = col(hex);
  return (_u, _v, X, Y) => scaleC(c, 1 - n + hsh(X >> 1, Y >> 1, 3) * n * 2);
};

// ───────────────────────── caja isométrica ─────────────────────────

/** búfer de profundidad activo (solo mientras drawBoxes lo pide) */
let ZB: Float32Array | null = null;
const ZK = 2 * B;
/** ¿gana este píxel la prueba de profundidad? (los empates los gana la caja dibujada después) */
function zTest(r: Raster, X: number, Y: number, depth: number) {
  if (!ZB) return true;
  if (X < 0 || Y < 0 || X >= r.W || Y >= r.H) return false;
  const i = Y * r.W + X;
  if (depth < ZB[i] - 0.05) return false;
  ZB[i] = depth;
  return true;
}

/** dibuja una caja: (ox, oy) = punto del ráster donde cae el origen del modelo (suelo) */
export function isoBox(r: Raster, ox: number, oy: number, b: IsoBox) {
  const S = r.S;
  const px = ox + (b.x - b.y) * A, py = oy + (b.x + b.y) * B - b.z;
  const hw = b.w / 2, hd = b.d / 2;
  const minX = px - (hw + hd) * A, maxX = px + (hw + hd) * A;
  const minY = py - (hw + hd) * B - b.h, maxY = py + (hw + hd) * B;
  const ew = 1 / Math.max(1, b.w * S * A), ed = 1 / Math.max(1, b.d * S * A), eh = 1 / Math.max(1, b.h * S);
  for (let Y = Math.floor(minY * S); Y <= Math.ceil(maxY * S); Y++) {
    for (let X = Math.floor(minX * S); X <= Math.ceil(maxX * S); X++) {
      const dx = (X + 0.5) / S - px, dy = (Y + 0.5) / S - py;
      if (b.top) {
        const p = dx / A, q = (dy + b.h) / B;
        const lx = (p + q) / 2, ly = (q - p) / 2;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) {
          const u = (lx + hw) / b.w, v = (ly + hd) / b.d;
          let c = b.top(u, v, X, Y);
          if (c && !zTest(r, X, Y, b.x + lx + b.y + ly + (b.z + b.h) * ZK)) continue;
          if (c) {
            if (u < ew * 1.5 || v < ed * 1.5) c = scaleC(c, 1.22);
            else if (u > 1 - ew * 1.5 || v > 1 - ed * 1.5) c = scaleC(c, 1.1);
            r.setN(X, Y, c);
            continue;
          }
        }
      }
      if (b.left) {
        const lx = dx / A + hd;
        const lz = (lx + hd) * B - dy;
        if (Math.abs(lx) <= hw && lz >= 0 && lz <= b.h) {
          const u = (lx + hw) / b.w, v = 1 - lz / b.h;
          let c = b.left(u, v, X, Y);
          if (c && !zTest(r, X, Y, b.x + lx + b.y + hd + (b.z + lz) * ZK)) continue;
          if (c) {
            c = scaleC(c, 0.86);
            if (v < eh * 1.5) c = scaleC(c, 1.18);
            else if (u > 1 - ew * 1.2) c = scaleC(c, 1.08);
            r.setN(X, Y, c);
            continue;
          }
        }
      }
      if (b.right) {
        const ly = hw - dx / A;
        const lz = (hw + ly) * B - dy;
        if (Math.abs(ly) <= hd && lz >= 0 && lz <= b.h) {
          const u = (hd - ly) / b.d, v = 1 - lz / b.h;
          let c = b.right(u, v, X, Y);
          if (c && !zTest(r, X, Y, b.x + hw + b.y + ly + (b.z + lz) * ZK)) continue;
          if (c) {
            c = scaleC(c, 0.64);
            if (v < eh * 1.5) c = scaleC(c, 1.2);
            r.setN(X, Y, c);
          }
        }
      }
    }
  }
}

/** pinta varias cajas de atrás adelante */
function drawBoxes(r: Raster, ox: number, oy: number, boxes: IsoBox[], zbuf = false) {
  boxes.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.z - b.z);
  ZB = zbuf ? new Float32Array(r.W * r.H).fill(-1e9) : null;
  for (const b of boxes) isoBox(r, ox, oy, b);
  ZB = null;
}

// ───────────────────────── personajes de bloques ─────────────────────────

export const ISO_CHAR_W = 36;
export const ISO_CHAR_H = 56;
/** punto de los pies dentro del fotograma (diseño) */
export const ISO_CHAR_FOOT = { x: 18, y: 42 };

/** gira un cuerpo tumbado −90° (cabeza hacia −y, a lo largo de una cama) */
function rotLying(bs: IsoBox[]): IsoBox[] {
  return bs.map((b) => {
    const oT = b.top, oL = b.left, oR = b.right;
    return {
      x: b.y, y: -b.x, z: b.z, w: b.d, d: b.w, h: b.h,
      top: oT ? (u: number, v: number, X: number, Y: number) => oT(1 - v, u, X, Y) : undefined,
      right: oL ? (u: number, v: number, X: number, Y: number) => oL(u, v, X, Y) : undefined,
      // la cara −x original no existe: se usa la +x como aproximación (pies → botas)
      left: oR ? (u: number, v: number, X: number, Y: number) => oR(1 - u, v, X, Y) : undefined,
    };
  });
}

function charBoxes(L: CharLook, view: 0 | 1, f: number, koStanding = false): IsoBox[] {
  const front = view === 0; // 0: mira hacia +y (de frente) · 1: de espaldas
  const s = front ? 1 : -1;
  const lp = f >= 10 ? [1, 2, 3][f - 10] : f;
  const walkA = lp === 1, walkB = lp === 3, pass = lp === 2 || lp === 4;
  const act = f === 5 || f === 6, up = f === 7 || f >= 10, blink = f === 8, ko = f === 9;
  const bob = pass ? 1 : 0;
  const skin = col(L.skin), top = col(L.coat ? '#e4e2d6' : L.top), pants = col(L.pants), boots = col(L.boots), hair = col(L.hair);
  const hatC = col(L.hatC ?? L.hair), glove = col(L.gloves ?? L.skin), eyeC = col(L.eye ?? '#1b1428');
  const belt = L.belt ? col(L.belt) : 0, stripe = L.stripe ? col(L.stripe) : 0, badge = L.badge ? col(L.badge) : 0, zip = L.zip ? scaleC(col(L.top), 0.6) : 0;
  const grain = (c: number, X: number, Y: number, n = 0.06) => scaleC(c, 1 - n + hsh(X >> 1, Y >> 1, 5) * n * 2);
  const out: IsoBox[] = [];

  if (ko && !L.robot && !koStanding) {
    const uni = top;
    const faceTop = (u: number, v: number, X: number, Y: number) => {
      // la coronilla apunta hacia +x (u alto); ojos en cruz y boca
      if (!alien && !bald && u > 0.78) return grain(hair, X, Y);
      const eyeU = u > 0.42 && u < 0.62, eyeA = v > 0.18 && v < 0.38, eyeB = v > 0.62 && v < 0.82;
      if (eyeU && (eyeA || eyeB)) {
        const lu = (u - 0.42) / 0.2, lv = ((eyeA ? v - 0.18 : v - 0.62)) / 0.2;
        return Math.abs(lu - lv) < 0.22 || Math.abs(lu + lv - 1) < 0.22 ? col('#2a1020') : grain(skin, X, Y);
      }
      if (u > 0.2 && u < 0.3 && v > 0.36 && v < 0.64) return col('#2a1020');
      return grain(skin, X, Y);
    };
    const alien = !!L.alien, bald = L.hat === 'bald';
    for (const sy of [-1, 1]) out.push({ x: -8.5, y: sy * 2.4, z: 0, w: 8, d: 3.8, h: 3.6, top: (u, _v, X, Y) => grain(u < 0.35 ? boots : pants, X, Y), left: (u, _v, X, Y) => grain(u < 0.35 ? boots : pants, X, Y), right: (_u, _v, X, Y) => grain(boots, X, Y) });
    for (const sy of [-1, 1]) out.push({ x: 0.5, y: sy * 6.8, z: 0, w: 8, d: 2.8, h: 2.8, top: (u, _v, X, Y) => grain(u < 0.2 ? glove : uni, X, Y), left: (_u, _v, X, Y) => grain(uni, X, Y), right: (_u, _v, X, Y) => grain(uni, X, Y) });
    out.push({ x: 0.5, y: 0, z: 0, w: 9, d: 10, h: 5, top: (u, _v, X, Y) => grain(stripe && u > 0.45 && u < 0.58 ? stripe : belt && u < 0.12 ? belt : uni, X, Y), left: (_u, _v, X, Y) => grain(uni, X, Y), right: (_u, _v, X, Y) => grain(uni, X, Y) });
    void faceTop;
    // cabeza de pie (ojos en cruz) con todo lo que lleva encima, girada: arriba → +x, cara → +z, ancho → y
    const hzS = 17, hdpS = alien ? 11 : 10, X0 = 5.1, kx = 0.9, ky = 0.91, kz = 0.8;
    // fila 1: dormido (ojos cerrados, a lo largo de la cama); filas 0 y 2: KO con ojos en cruz
    for (const b of charBoxes(L, 0, view === 1 ? 8 : 9, true).filter((q) => q.z >= 10.5)) {
      const nb: IsoBox = { x: X0 + (b.z + b.h / 2 - hzS) * kx, y: b.x * ky, z: (b.y - b.d / 2 + hdpS / 2) * kz, w: b.h * kx, d: b.w * ky, h: b.d * kz };
      if (nb.z < 0) { nb.h += nb.z; nb.z = 0; }
      if (nb.h <= 0.2) continue;
      const oL = b.left, oT = b.top, oR = b.right;
      nb.top = oL ? (u, v, X, Y) => oL(v, 1 - u, X, Y) : undefined;
      nb.right = oT ? (u, v, X, Y) => oT(1 - u, 1 - v, X, Y) : undefined;
      nb.left = oR ? (u, v, X, Y) => oR(v, 1 - u, X, Y) : undefined;
      out.push(nb);
    }
    // un poco hacia atrás para que quepan sombreros altos (chef, antenas)
    for (const b of out) b.x -= 1.5;
    return view === 1 ? rotLying(out) : out;
  }

  if (L.robot) {
    const metal = col('#4d5958'), dark = col('#141a1d'), eye = col(L.eye ?? '#7dffb2');
    const treadPh = (lp & 1) ? 0.5 : 0;
    out.push({ x: 0, y: 0, z: 0, w: 13, d: 11, h: 5, top: (_u, _v, X, Y) => grain(dark, X, Y), left: (u, _v, X, Y) => (Math.floor(u * 8 + treadPh) % 2 ? grain(dark, X, Y) : grain(metal, X, Y, 0.1)), right: (u, _v, X, Y) => (Math.floor(u * 6 + treadPh) % 2 ? grain(dark, X, Y) : grain(metal, X, Y)) });
    out.push({ x: 0, y: 0, z: 5 + bob, w: 12, d: 9, h: 9, top: (_u, _v, X, Y) => grain(metal, X, Y), left: (u, v, X, Y) => (front && v > 0.25 && v < 0.6 && u > 0.3 && u < 0.7 ? mixC(dark, col('#7dffb2'), 0.35) : v > 0.8 ? col('#c88a1a') : grain(metal, X, Y)), right: (_u, _v, X, Y) => grain(metal, X, Y) });
    const armZ = up ? 14 + bob : 6 + bob, armH = up ? 9 : 8;
    for (const sx of [-1, 1]) out.push({ x: sx * 7.5, y: act ? 4 * s : 0, z: armZ, w: 2.6, d: 2.6, h: armH, top: solid('#6d776f'), left: solid('#4d5958'), right: solid('#4d5958') });
    out.push({
      x: 0, y: 0, z: 14 + bob, w: 10, d: 9, h: 7, top: (_u, _v, X, Y) => grain(metal, X, Y),
      left: (u, v, X, Y) => {
        if (front && v > 0.3 && v < 0.62) {
          if (blink) return v > 0.44 && v < 0.5 && ((u > 0.2 && u < 0.4) || (u > 0.6 && u < 0.8)) ? eye : dark;
          if (ko) return ((u > 0.2 && u < 0.4) || (u > 0.6 && u < 0.8)) && Math.abs((u * 10) % 2 - (v * 10) % 2) < 0.4 ? col('#ff4a42') : dark;
          return (u > 0.2 && u < 0.38) || (u > 0.62 && u < 0.8) ? eye : dark;
        }
        return grain(metal, X, Y);
      },
      right: (_u, _v, X, Y) => grain(metal, X, Y),
    });
    out.push({ x: 0, y: 0, z: 21 + bob, w: 1.2, d: 1.2, h: 3, left: solid('#38444d'), right: solid('#38444d') });
    out.push({ x: 0, y: 0, z: 24 + bob, w: 2, d: 2, h: 2, top: solid('#ff4a42'), left: solid('#ff4a42'), right: solid('#ff4a42') });
    return out;
  }

  // piernas
  const legY = (side: number) => (walkA ? side * 2.4 : walkB ? -side * 2.4 : 0) * s;
  for (const side of [-1, 1]) {
    const ly = legY(side);
    const lift = (walkA && side === 1) || (walkB && side === -1) ? 0.8 : 0;
    out.push({
      x: side * 2.7, y: ly, z: lift, w: 4.2, d: 4.2, h: 8 - lift,
      left: (_u, v, X, Y) => grain(v > 0.62 ? boots : pants, X, Y),
      right: (_u, v, X, Y) => grain(v > 0.62 ? boots : pants, X, Y),
    });
  }
  // torso
  const coat = !!L.coat;
  const tz = (coat ? 6 : 8) + bob, th = coat ? 11 : 9;
  const torsoFace = (isFront: boolean) => (u: number, v: number, X: number, Y: number) => {
    const vv = coat ? v : v;
    if (belt && vv > 0.8 && !coat) return grain(belt, X, Y, 0.04);
    if (stripe && vv > 0.46 && vv < 0.58) return grain(stripe, X, Y, 0.03);
    if (vv < 0.1) return scaleC(grain(top, X, Y), 1.12);
    if (isFront && zip && Math.abs(u - 0.5) < 0.05) return zip;
    if (isFront && badge && u > 0.66 && u < 0.82 && vv > 0.18 && vv < 0.34) return badge;
    return grain(top, X, Y);
  };
  out.push({ x: 0, y: 0, z: tz, w: 11, d: 6, h: th, top: (_u, _v, X, Y) => grain(top, X, Y), left: torsoFace(front), right: torsoFace(false) });
  // brazos
  for (const side of [-1, 1]) {
    let ay = (walkA ? -side * 2 : walkB ? side * 2 : 0) * s, az = 9 + bob, ah = 8;
    if (act) { ay = 4.5 * s; az = 11 + bob + (f === 6 ? 1 : 0); ah = 6; }
    if (up) { ay = 0; az = 17 + bob; ah = 10; }
    const armFace = (_u: number, v: number, X: number, Y: number) => grain((up ? v < 0.25 : v > 0.75) ? glove : top, X, Y);
    out.push({ x: side * 7, y: ay, z: az, w: 3, d: 3, h: ah, top: (_u, _v, X, Y) => grain(up ? glove : top, X, Y), left: armFace, right: armFace });
  }
  // cabeza
  const alien = !!L.alien;
  const hw = alien ? 12 : 11, hdp = alien ? 11 : 10, hh = alien ? 11 : 10;
  const hz = 17 + bob;
  const bald = L.hat === 'bald';
  const faceFront = (u: number, v: number, X: number, Y: number) => {
    if (!alien && !bald && v < 0.2) return grain(hair, X, Y);
    const eyeRow = alien ? v > 0.3 && v < 0.62 : v > 0.36 && v < 0.58;
    const eyeL = alien ? u > 0.16 && u < 0.4 : u > 0.2 && u < 0.36;
    const eyeR = alien ? u > 0.6 && u < 0.84 : u > 0.64 && u < 0.8;
    if (eyeRow && (eyeL || eyeR)) {
      if (blink) return v > 0.46 && v < 0.52 ? scaleC(skin, 0.55) : grain(skin, X, Y);
      if (ko) return Math.abs(((u * 40) % 4) - ((v * 40) % 4)) < 1.2 || Math.abs(((u * 40) % 4) + ((v * 40) % 4) - 4) < 1.2 ? col('#2a1020') : grain(skin, X, Y);
      if (alien) return v < 0.4 && (u < 0.22 || (u > 0.6 && u < 0.66)) ? col('#ffffff') : col('#0a0a14');
      const pupil = eyeL ? u > 0.27 : u > 0.64 && u < 0.73;
      if (L.glassesOn === 'eyes' && L.glasses) return pupil ? col('#e8f8ff') : col(L.glasses);
      return pupil ? eyeC : col('#f4f4f8');
    }
    if (v > 0.74 && v < 0.81 && u > 0.38 && u < 0.62) return ko ? col('#2a1020') : col('#7a2a30');
    if (!alien && v > 0.6 && v < 0.7 && (u < 0.2 || u > 0.8)) return mixC(skin, col('#ff7a8a'), 0.35);
    return grain(skin, X, Y);
  };
  const back = (_u: number, v: number, X: number, Y: number) => (alien || bald ? grain(skin, X, Y) : v < 0.82 ? grain(hair, X, Y) : grain(skin, X, Y));
  const side = (faceAtNear: boolean) => (u: number, v: number, X: number, Y: number) => {
    if (alien || bald) return grain(skin, X, Y);
    const towardFace = faceAtNear ? 1 - u : u;
    if (v < 0.24 || towardFace < 0.38) return grain(hair, X, Y);
    if (towardFace > 0.42 && towardFace < 0.56 && v > 0.42 && v < 0.62) return scaleC(skin, 0.86);
    return grain(skin, X, Y);
  };
  out.push({
    x: 0, y: 0, z: hz, w: hw, d: hdp, h: hh,
    top: (_u, _v, X, Y) => grain(alien || bald ? skin : hair, X, Y),
    left: front ? faceFront : back,
    right: side(front),
  });
  // sombreros y peinados
  const ht = hz + hh;
  const hatBox = (w: number, d: number, h: number, c: number, extra?: Partial<IsoBox>) =>
    out.push({ x: 0, y: 0, z: ht, w, d, h, top: (_u, _v, X, Y) => grain(c, X, Y), left: (_u, v, X, Y) => (v > 0.7 ? scaleC(c, 0.85) : grain(c, X, Y)), right: (_u, _v, X, Y) => grain(c, X, Y), ...extra });
  switch (L.hat) {
    case 'cap': case 'captain': {
      hatBox(11.6, 10.6, 3, hatC, L.hat === 'captain' ? { left: (_u, v, X, Y) => (v > 0.55 ? col('#d8a020') : grain(hatC, X, Y)) } : undefined);
      out.push({ x: 0, y: s * (hdp / 2 + 2), z: ht, w: 10, d: 4, h: 1.2, top: solid(L.hat === 'captain' ? '#1a1a22' : (L.hatC ?? '#ffcf33')), left: solid('#1a1a22'), right: solid('#1a1a22') });
      break;
    }
    case 'beanie': hatBox(11.4, 10.4, 4, hatC, { left: (_u, v, X, Y) => (v > 0.6 ? scaleC(hatC, 0.75) : grain(hatC, X, Y)) }); break;
    case 'hardhat': hatBox(12.6, 11.6, 3.2, hatC); out.push({ x: 0, y: 0, z: ht - 0.6, w: 14, d: 13, h: 0.8, top: solid(L.hatC ?? '#ffcf33'), left: solid('#b8941a'), right: solid('#b8941a') }); break;
    case 'helmet': hatBox(12.4, 11.4, 2, col('#9db4c6')); out.push({ x: 0, y: 0, z: hz - 0.5, w: 12.4, d: 11.4, h: 1, left: solid('#5e7284'), right: solid('#5e7284') }); break;
    case 'medic': hatBox(10, 9, 3, col('#e8eef0'), { left: (u, v, X, Y) => ((Math.abs(u - 0.5) < 0.08 || Math.abs(v - 0.5) < 0.2) && Math.abs(u - 0.5) < 0.22 ? col('#c8283a') : grain(col('#e8eef0'), X, Y)) }); break;
    case 'chef': hatBox(9, 8, 8, col('#f2f2f0'), { left: (_u, v, X, Y) => (v > 0.8 ? col('#d8d8d0') : grain(col('#f2f2f0'), X, Y)) }); break;
    case 'sunhat': out.push({ x: 0, y: 0, z: ht, w: 16, d: 15, h: 1, top: solid(L.hatC ?? '#e8c35a'), left: solid('#a88a3a'), right: solid('#a88a3a') }); hatBox(10, 9, 3.5, hatC); break;
    case 'alien':
      for (const sx of [-1, 1]) {
        out.push({ x: sx * 3, y: 0, z: ht, w: 1.2, d: 1.2, h: 5, left: solid(L.hatC ?? '#8aff7a'), right: solid(L.hatC ?? '#8aff7a') });
        out.push({ x: sx * 3, y: 0, z: ht + 5, w: 2.6, d: 2.6, h: 2.6, top: solid('#d4ffb0'), left: solid('#86e86a'), right: solid('#46b84a') });
      }
      break;
    case 'bun': hatBox(11.2, 10.2, 1.5, hair); out.push({ x: 0, y: -s * 3, z: ht + 1.5, w: 5, d: 5, h: 4, top: solid(L.hair), left: solid(L.hair), right: solid(L.hair) }); break;
    case 'long': hatBox(11.2, 10.2, 1.5, hair); out.push({ x: 0, y: -s * (hdp / 2 + 0.8), z: hz - 6, w: 11.4, d: 1.6, h: hh + 6, top: solid(L.hair), left: solid(L.hair), right: solid(L.hair) }); break;
    case 'hair': case 'slick': hatBox(11.2, 10.2, L.hat === 'hair' ? 2.4 : 1.2, hair); break;
    default: break;
  }
  return out;
}

/** hoja de personaje de bloques con la misma disposición que la clásica (3 filas × CHAR_FRAMES) */
export function isoCharacterSheet(L: CharLook): HTMLCanvasElement {
  const n = 3 * CHAR_FRAMES;
  const sheet = new Raster(ISO_CHAR_W * n, ISO_CHAR_H);
  for (let d = 0; d < 3; d++) {
    const view: 0 | 1 = d === 1 ? 1 : 0;
    for (let f = 0; f < CHAR_FRAMES; f++) {
      const r = new Raster(ISO_CHAR_W, ISO_CHAR_H);
      drawBoxes(r, ISO_CHAR_FOOT.x, ISO_CHAR_FOOT.y, charBoxes(L, view, f));
      r.grade({ sat: 0.88, dark: 0.94, grime: 0.08, tint: '#10141c', seed: d * 13 + f });
      r.outline('#05040a', 0.8);
      sheet.blit(r, (d * CHAR_FRAMES + f) * ISO_CHAR_W, 0);
    }
  }
  return sheet.toCanvas();
}

// ───────────────────────── mobiliario en bloque ─────────────────────────

/** muebles que se quedan como figura recortada (no tienen sentido como caja) */
/** muebles que se dibujarían como figura recortada (ya todos tienen modelo de bloques) */
export const ISO_BILLBOARD = new Set<PropKind>([]);

export interface IsoPropInfo { w: number; h: number; ox: number; oy: number; frames: number }

function propHeight(kind: PropKind) {
  const up = PROP_DEFS[kind].up;
  return Math.max(6, Math.min(40, up * 2.6));
}

/** caja «impresa» con el arte clásico del mueble: tapa = parte superior, frente = parte inferior */
export function isoPropSheet(kind: PropKind, variant: number): { canvas: HTMLCanvasElement; info: IsoPropInfo } {
  const d = PROP_DEFS[kind];
  const W2 = d.w * 32, H2 = d.h * 32 + d.up * 2;
  const frames = PROP_FRAMES[kind] ?? 1;
  const W = d.w * 32 - 2, D = d.h * 32 - 2, H = CUSTOM_PROP_H[kind] ?? propHeight(kind);
  const fw = Math.ceil((W + D) * A + 4), fh = Math.ceil(H + (W + D) * B + 4);
  const ox = (W + D) / 2 * A + 2, oy = H + (W + D) / 2 * B + 2;
  const out = new Raster(fw * frames, fh);
  for (let f = 0; f < frames; f++) {
    const custom = kind === 'station' ? stationBoxes(W, D) : customPropBoxes(kind, variant, f);
    if (custom) {
      const r = new Raster(fw, fh);
      drawBoxes(r, ox, oy, custom, true);
      r.rimLight('#cfe8ee', 0.2);
      r.outline('#020304', 0.7);
      out.blit(r, f * fw, 0);
      continue;
    }
    const src = new Raster(W2, H2);
    drawPropHD(kind, f, src, W2, H2, variant);
    src.grade({ sat: 0.5, dark: 0.78, grime: 0.5, seed: variant * 13 + kind.length });
    const frontH = Math.min(H2 * 0.55, Math.max(8, d.up * 2 + 6));
    const topH = H2 - frontH;
    // color medio opaco para rellenar huecos transparentes
    let rs = 0, gs = 0, bs = 0, n = 0;
    for (let i = 0; i < src.data.length; i += 7) { const c = src.data[i]; if ((c >>> 24) > 100) { rs += c & 255; gs += (c >> 8) & 255; bs += (c >> 16) & 255; n++; } }
    const avg = n ? ((255 << 24) | (Math.round(bs / n * 0.7) << 16) | (Math.round(gs / n * 0.7) << 8) | Math.round(rs / n * 0.7)) >>> 0 : col('#1c2326');
    const sample = (u: number, v: number, y0: number, hgt: number) => {
      const X = Math.min(src.W - 1, Math.max(0, Math.floor(u * src.W)));
      const Y = Math.min(src.H - 1, Math.max(0, Math.floor((y0 + v * hgt) * src.S)));
      const c = src.getN(X, Y);
      return (c >>> 24) > 60 ? (c | 0xff000000) >>> 0 : avg;
    };
    const r = new Raster(fw, fh);
    isoBox(r, ox, oy, {
      x: 0, y: 0, z: 0, w: W, d: D, h: H,
      top: (u, v) => sample(u, v, 0, topH),
      left: (u, v) => sample(u, v, topH, frontH),
      right: (u, v) => sample(0.75 + u * 0.25, v, topH, frontH),
    });
    r.rimLight('#cfe8ee', 0.18);
    r.outline('#020304', 0.7);
    out.blit(r, f * fw, 0);
  }
  return { canvas: out.toCanvas(), info: { w: fw, h: fh, ox, oy, frames } };
}

// ───────────────────────── muros biomecánicos en bloque ─────────────────────────

const BIO = ['#020303', '#060809', '#0c0f10', '#141819', '#1d2324', '#283031', '#363f3e', '#4b5450', '#6a705f', '#949178', '#c4bc9c', '#ece4c8'].map((c) => col(c));
const OIL = ['#020304', '#05080a', '#0a0e12', '#10161b', '#182027', '#222c35', '#2f3c47', '#41525f'].map((c) => col(c));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const pick = (r: number[], v: number, X: number, Y: number) => {
  const f = Math.max(0, Math.min(1, v)) * (r.length - 1);
  const i = Math.floor(f);
  return r[Math.min(r.length - 1, i + (f - i > 0.5 + (BAYER[((Y & 3) << 2) | (X & 3)] - 0.5) * 0.85 ? 1 : 0))];
};

export const ISO_WALL = { low: 14, tall: 72 };

/** bloque de muro: costillas vertebradas, tendón de hueso y vena luminosa del color de la sala */
export function isoWallBlock(height: number, accent: string): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const W = 32, D = 32, H = height;
  const fw = Math.ceil((W + D) * A + 4), fh = Math.ceil(H + (W + D) * B + 4);
  const ox = (W + D) / 2 * A + 2, oy = H + (W + D) / 2 * B + 2;
  const acc = col(accent), dark = col('#050606'), wet = col('#9fc4d4');
  const tendonZ = height > 30 ? height * 0.72 : height * 0.62;
  const face = (k: number) => (u: number, v: number, X: number, Y: number) => {
    const lz = (1 - v) * H, lx = u * 32;
    if (lz < 1.6) return pick(BIO, 0.08 + Math.sin(((lx % 6) / 6) * Math.PI) * 0.12, X, Y);
    if (lz < 3) return mixC(dark, acc, 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(lx * 0.5 + k)));
    if (Math.abs(lz - tendonZ) < 1.8) {
      const t = (lz - tendonZ) / 1.8;
      const seg = (lx % 6) < 0.6 ? -0.3 : 0;
      return pick(RAMPS_BONE, 0.62 - t * 0.35 + seg, X, Y);
    }
    if (lz > H - 1.2) return pick(BIO, 0.62, X, Y);
    const rx = ((lx + 4) % 8) / 8 - 0.5;
    const seg = ((lz - 3) % 7.5) / 7.5;
    const joint = Math.exp(-(seg * seg) / 0.006) + Math.exp(-((seg - 1) ** 2) / 0.006);
    const half = 0.36 - 0.1 * joint, ar = Math.abs(rx);
    let vv: number;
    if (ar < half) { const n = rx / half, h = Math.sqrt(1 - n * n); vv = 0.1 + Math.max(0, Math.min(1, -n * 0.55 + h * 0.62)) * 0.74 - joint * 0.22; }
    else vv = 0.04 + (1 - (ar - half) / (0.5 - half)) * 0.07;
    let c = pick(BIO, vv + (hsh(X >> 2, Y >> 2, k) - 0.5) * 0.05, X, Y);
    if (ar < half * 0.3 && rx < 0 && hsh(Math.floor((lx + 4) / 8), Math.floor(lz / 5), 9 + k) < 0.45) c = mixC(c, wet, 0.4);
    return c;
  };
  const r = new Raster(fw, fh);
  isoBox(r, ox, oy, {
    x: 0, y: 0, z: 0, w: W, d: D, h: H,
    top: (u, v, X, Y) => {
      const cx = ((u * 32) % 8) - 4, cy = ((v * 32) % 8) - 4;
      const bump = Math.hypot(cx, cy) < 2.2;
      return bump ? pick(RAMPS_BONE, 0.55 - (cx + cy) * 0.06, X, Y) : pick(OIL, 0.3 + hsh(X >> 1, Y >> 1, 4) * 0.1, X, Y);
    },
    left: face(0),
    right: face(3),
  });
  r.outline('#010202', 0.6);
  return { canvas: r.toCanvas(), ox, oy };
}

const RAMPS_BONE = (RAMPS.bone as Ramp).map((c) => col(c));
void rampOf;


// ───────────────────────── herramientas en la mano ─────────────────────────

export const ISO_TOOL_FRAMES = 5; // reposo + 4 de uso

/** posiciones de una «vara» como cadena de cubitos (mangos, mangueras) */
function rod(out: IsoBox[], a: [number, number, number], b: [number, number, number], th: number, face: Face, n = 12) {
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t - th / 2, w: th, d: th, h: th, top: face, left: face, right: face });
  }
}

function toolBoxes(tool: ToolId, view: 0 | 1, f: number): IsoBox[] {
  const s = view === 0 ? 1 : -1;
  const out: IsoBox[] = [];
  const use = f > 0;
  const k = f - 1;
  switch (tool) {
    case 'fregona': case 'superfregona': {
      const gold = tool === 'superfregona';
      const handle = solid(gold ? '#e8b830' : '#8a6a44'), band = solid('#7a8a8a');
      const strand = (_u: number, v: number, X: number, Y: number) => scaleC(col(gold ? '#5ae8f0' : '#d8d4c4'), (Math.floor(X / 2) % 2 ? 1 : 0.84) * (1 - v * 0.12));
      if (!use) {
        out.push({ x: 9.5, y: 1.5, z: 3.5, w: 1.3, d: 1.3, h: 21, top: handle, left: handle, right: handle });
        out.push({ x: 9.5, y: 1.5, z: 3, w: 3.6, d: 3.6, h: 1, top: band, left: band, right: band });
        out.push({ x: 9.5, y: 1.5, z: 0, w: 4.6, d: 4.6, h: 3, top: strand, left: strand, right: strand });
      } else {
        const sweep = [-3.5, -1, 3.5, 1][k];
        const hx = sweep, hy = 12 * s;
        rod(out, [6.5, 4.5 * s, 12.5], [hx, hy - 1.5 * s, 3.2], 1.3, handle, 14);
        out.push({ x: hx, y: hy, z: 2.2, w: 4.4, d: 2.6, h: 1, top: band, left: band, right: band });
        out.push({ x: hx, y: hy, z: 0, w: 6.4, d: 3.8, h: 2.2, top: strand, left: strand, right: strand });
      }
      break;
    }
    case 'espuma': case 'desinfectante': case 'crio': {
      const body = solid(tool === 'espuma' ? '#c8283a' : tool === 'desinfectante' ? '#2a9a94' : '#d8e4ea');
      const capC = solid(tool === 'crio' ? '#5ae8f0' : '#d8d6c4'), dark = solid('#1a1f24');
      if (!use) {
        // empuñada en reposo, apuntando al suelo por delante
        out.push({ x: 7.4, y: 2.4 * s, z: 7.6, w: 2.8, d: 5.4, h: 2.8, top: body, left: body, right: body });
        out.push({ x: 7.4, y: 1.4 * s, z: 10.4, w: 2.2, d: 2.2, h: 2.4, top: capC, left: capC, right: capC });
        out.push({ x: 7.4, y: 5.8 * s, z: 7.2, w: 1.1, d: 2.6, h: 1.1, top: dark, left: dark, right: dark });
        out.push({ x: 7.4, y: 0.6 * s, z: 6.4, w: 1.4, d: 1.4, h: 2, top: dark, left: dark, right: dark });
      } else {
        const rc = [0, -0.4, 0, 0.3][k] * s;
        out.push({ x: 6.5, y: (5.5 + rc) * s, z: 10.5, w: 3, d: 6, h: 3, top: body, left: body, right: body });
        out.push({ x: 6.5, y: (4.5 + rc) * s, z: 13.5, w: 2.4, d: 2.4, h: 2.6, top: capC, left: capC, right: capC });
        out.push({ x: 6.5, y: (10 + rc) * s, z: 11.4, w: 1.2, d: 3.4, h: 1.2, top: dark, left: dark, right: dark });
      }
      break;
    }
    case 'aspiradora': {
      const yel = solid('#d8a020'), dark = solid('#1a1f24'), hose = solid('#3a4044');
      if (!use) {
        // colgada del asa: el asa llega hasta la mano
        out.push({ x: 8.4, y: 0, z: 3.4, w: 4, d: 5.2, h: 5, top: yel, left: yel, right: yel });
        out.push({ x: 8.4, y: 0, z: 8.4, w: 1.2, d: 3.4, h: 1.2, top: dark, left: dark, right: dark });
        out.push({ x: 8.4, y: 1.2 * s, z: 8.4, w: 1, d: 1, h: 2.4, top: dark, left: dark, right: dark });
        out.push({ x: 8.4, y: -1.2 * s, z: 8.4, w: 1, d: 1, h: 2.4, top: dark, left: dark, right: dark });
        rod(out, [8.4, 2.6 * s, 4.5], [6.5, 8 * s, 0.8], 1.2, hose, 6);
        out.push({ x: 6.3, y: 8.8 * s, z: 0, w: 3.6, d: 2, h: 1.2, top: dark, left: dark, right: dark });
      } else {
        const jig = [-1.5, 0, 1.5, 0][k];
        out.push({ x: 7.5, y: 2.5 * s, z: 8, w: 4, d: 5, h: 5, top: yel, left: yel, right: yel });
        rod(out, [7, 5 * s, 9], [jig, 11 * s, 1.5], 1.4, hose, 12);
        out.push({ x: jig, y: 12 * s, z: 0, w: 5.5, d: 2.6, h: 1.6, top: dark, left: dark, right: dark });
      }
      break;
    }
    case 'trampa': {
      const st = solid('#6d776f'), red = solid('#c8283a');
      out.push({ x: use ? 0 : 7.6, y: use ? 6 * s : 1.6 * s, z: use ? 11 : 6.6, w: 4.5, d: 4.5, h: 2.4, top: st, left: st, right: st });
      out.push({ x: use ? 0 : 7.6, y: use ? 6 * s : 1.6 * s, z: (use ? 11 : 6.6) + 2.4, w: 1.4, d: 1.4, h: 0.8, top: red, left: red, right: red });
      break;
    }
    case 'robot': {
      const st = solid('#4d5958'), cy = solid('#5ae8f0');
      out.push({ x: use ? 0 : 7.6, y: use ? 6 * s : 1.6 * s, z: use ? 11 : 6.2, w: 5, d: 5, h: 3, top: st, left: st, right: st });
      out.push({ x: use ? 0 : 7.6, y: use ? 6 * s : 1.6 * s, z: (use ? 11 : 6.2) + 3, w: 1.6, d: 1.6, h: 0.8, top: cy, left: cy, right: cy });
      break;
    }
  }
  return out;
}

/** hoja de una herramienta: 3 filas (frente, espalda, frente) × 5 fotogramas, con los pies del conserje como origen */
export function isoToolSheet(tool: ToolId): HTMLCanvasElement {
  const n = 3 * ISO_TOOL_FRAMES;
  const sheet = new Raster(ISO_CHAR_W * n, ISO_CHAR_H);
  for (let d = 0; d < 3; d++) {
    for (let f = 0; f < ISO_TOOL_FRAMES; f++) {
      const r = new Raster(ISO_CHAR_W, ISO_CHAR_H);
      const boxes = toolBoxes(tool, d === 1 ? 1 : 0, f);
      if (boxes.length) drawBoxes(r, ISO_CHAR_FOOT.x, ISO_CHAR_FOOT.y, boxes);
      r.outline('#05040a', 0.75);
      sheet.blit(r, (d * ISO_TOOL_FRAMES + f) * ISO_CHAR_W, 0);
    }
  }
  return sheet.toCanvas();
}

// ───────────────────────── suciedad de bloques ─────────────────────────

/** residuos sólidos que se convierten en cubitos sobre el suelo */
export const ISO_CUBE_STYLES = new Set(['chunks', 'trash', 'debris', 'eggs', 'wires']);
export const ISO_DIRT_CUBE = { w: 36, h: 30, fx: 18, fy: 22 };

function dirtCubes(def: ResidueDef, v: number): IsoBox[] {
  const out: IsoBox[] = [];
  const rnd = (i: number) => hsh(i, v * 31 + def.id.length, def.id.charCodeAt(0));
  const c0 = def.colors[0], c1 = def.colors[1], c2 = def.colors[2];
  const n = def.style === 'wires' ? 4 : def.style === 'eggs' ? 2 + v : 4 + v;
  for (let i = 0; i < n; i++) {
    // repartidos en corona para que no se fundan en un solo bloque
    const a = (i / n) * Math.PI * 2 + rnd(i) * 0.7, rr = i === 0 ? 0 : 4 + rnd(i + 9) * 5;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.9;
    let w = 2 + rnd(i + 20) * 2.4, d = 2 + rnd(i + 30) * 2.4, h = 1.2 + rnd(i + 40) * 2.4;
    let colA = rnd(i + 50) < 0.4 ? c0 : rnd(i + 51) < 0.6 ? c1 : c2;
    if (def.style === 'debris') { h = 0.8 + rnd(i + 40) * 1.2; w += 1.5; colA = rnd(i + 50) < 0.5 ? c0 : c1; }
    if (def.style === 'eggs') { w = 4; d = 4; h = 5.5; colA = c0; }
    if (def.style === 'trash') {
      // papel arrugado, una lata roja y algún envoltorio
      if (i === 1) { w = 1.8; d = 1.8; h = 4.2; colA = c2; } else colA = rnd(i + 50) < 0.6 ? c0 : c1;
    }
    if (def.style === 'wires') { const along = rnd(i + 60) < 0.5; w = along ? 9 : 1; d = along ? 1 : 9; h = 1; colA = [c0, c1, c2, '#3a7ae8'][i % 4]; }
    const face = solid(colA, 0.08);
    const topF = (_u: number, _v: number, X: number, Y: number) => scaleC(col(def.style === 'eggs' ? c2 : colA), 1.06 - hsh(X >> 1, Y >> 1, 2) * 0.12);
    out.push({ x, y, z: 0, w, d, h, top: topF, left: face, right: face });
  }
  return out;
}

/** devuelve la versión de bloques de un residuo: cubitos (de pie) o charco pixelado (plano) */
export function isoDirtSheet(def: ResidueDef): { canvas: HTMLCanvasElement; upright: boolean } {
  if (ISO_CUBE_STYLES.has(def.style)) {
    const { w, h, fx, fy } = ISO_DIRT_CUBE;
    const out = new Raster(w * 3, h);
    for (let v = 0; v < 3; v++) {
      const r = new Raster(w, h);
      drawBoxes(r, fx, fy, dirtCubes(def, v));
      r.outline('#05040a', 0.7);
      out.blit(r, v * w, 0);
    }
    return { canvas: out.toCanvas(), upright: true };
  }
  // charco pixelado: celdas de 3 unidades con bisel (como bloques muy planos)
  const S = 40, cell = 3;
  const out = new Raster(S * 3, S);
  for (let v = 0; v < 3; v++) {
    const src = new Raster(S, S);
    drawResidueHD(src, def, v);
    const r = new Raster(S, S);
    const K = r.S, cn = cell * K;
    for (let cy = 0; cy < S / cell; cy++) for (let cx = 0; cx < S / cell; cx++) {
      const c = src.getN(Math.floor((cx + 0.5) * cn), Math.floor((cy + 0.5) * cn));
      if ((c >>> 24) < 90) continue;
      const base = (c | 0xff000000) >>> 0;
      const a = c >>> 24;
      for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) {
        let col2 = base;
        if (j === 0 || i === 0) col2 = scaleC(base, 1.16);
        else if (j === cn - 1 || i === cn - 1) col2 = scaleC(base, 0.78);
        r.setN(cx * cn + i, cy * cn + j, ((Math.max(a, 200) << 24) | (col2 & 0xffffff)) >>> 0);
      }
    }
    out.blit(r, v * S, 0);
  }
  return { canvas: out.toCanvas(), upright: false };
}

// ───────────────────────── bolsas ─────────────────────────

export const ISO_BAG = { w: 40, h: 30, fx: 20, fy: 22 };

/** bolsa de basura (cubo negro con lazo amarillo) o bolsa de cadáver (bloque tumbado con cremallera) */
export function isoBagTexture(kind: 'bag' | 'body'): HTMLCanvasElement {
  const { w, h, fx, fy } = ISO_BAG;
  const r = new Raster(w, h);
  if (kind === 'bag') {
    const bag = (_u: number, v: number, X: number, Y: number) => scaleC(col('#46584c'), 1 - v * 0.18 + hsh(X >> 1, Y >> 1, 7) * 0.14);
    drawBoxes(r, fx, fy, [
      { x: 0, y: 0, z: 0, w: 9, d: 9, h: 9, top: bag, left: bag, right: bag },
      { x: 0, y: 0, z: 9, w: 3, d: 3, h: 2.4, top: solid('#d8a020'), left: solid('#d8a020'), right: solid('#d8a020') },
    ]);
  } else {
    const bag = (u: number, _v: number, X: number, Y: number) => (Math.abs(u - 0.5) < 0.03 ? col('#a89c80') : scaleC(col('#2c3236'), 0.92 + hsh(X >> 1, Y >> 1, 9) * 0.12));
    drawBoxes(r, fx, fy, [
      { x: 0, y: 0, z: 0, w: 24, d: 10, h: 5, top: (u, v, X, Y) => (Math.abs(v - 0.5) < 0.04 ? col('#a89c80') : bag(u, v, X, Y)), left: bag, right: bag },
      { x: 9, y: 3.5, z: 5, w: 3, d: 2, h: 0.6, top: solid('#d8a020'), left: solid('#d8a020'), right: solid('#d8a020') },
    ]);
  }
  r.rimLight('#d8f0e4', 0.35);
  r.outline('#05040a', 0.75);
  return r.toCanvas();
}

void RESIDUES;


// ───────────────────────── texto en una cara ─────────────────────────

const GLYPH: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10001', '10001'], O: ['1111', '1001', '1001', '1001', '1111'], P: ['1111', '1001', '1111', '1000', '1000'],
  '-': ['000', '000', '111', '000', '000'],
};
/** ¿el punto (u,v) de un rótulo cae en una letra? (rótulo en [u0,u1]×[v0,v1]) */
function inText(text: string, u: number, v: number, u0: number, v0: number, u1: number, v1: number) {
  if (u < u0 || u > u1 || v < v0 || v > v1) return false;
  const gl = [...text].map((c) => GLYPH[c] ?? GLYPH['-']);
  const cols = gl.reduce((n, g) => n + g[0].length + 1, -1);
  let cx = Math.min(cols - 1, Math.floor(((u - u0) / (u1 - u0)) * cols));
  const cy = Math.min(4, Math.floor(((v - v0) / (v1 - v0)) * 5));
  for (const g of gl) {
    if (cx < g[0].length) return g[cy][cx] === '1';
    cx -= g[0].length + 1;
    if (cx < 0) return false;
  }
  return false;
}

// ───────────────────────── estación del conserje ─────────────────────────

function stationBoxes(W: number, D: number): IsoBox[] {
  const out: IsoBox[] = [];
  const cab = col('#3a4a52'), cabD = col('#24303a'), yel = col('#e0b020');
  // armario con cajones y el rótulo MOP
  const front = (u: number, v: number, X: number, Y: number) => {
    if (inText('MOP', u, v, 0.57, 0.24, 0.9, 0.7)) return yel;
    if (u > 0.54 && u < 0.93 && v > 0.14 && v < 0.8) return col('#0c1216');
    if (Math.abs(v - 0.5) < 0.03 && u < 0.5) return cabD;
    if (u > 0.2 && u < 0.3 && (Math.abs(v - 0.28) < 0.05 || Math.abs(v - 0.72) < 0.05)) return col('#a3b4bd');
    return scaleC(cab, 0.95 + hsh(X >> 1, Y >> 1, 3) * 0.1);
  };
  out.push({ x: 0, y: 2, z: 2, w: W - 2, d: D - 6, h: 13, top: solid('#4a5c66'), left: front, right: solid('#3a4a52') });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push({ x: sx * (W / 2 - 4), y: 2 + sy * (D / 2 - 5), z: 0, w: 3, d: 3, h: 2, top: solid('#141a1d'), left: solid('#141a1d'), right: solid('#141a1d') });
  // estantería trasera con botellas de colores
  out.push({ x: 0, y: -D / 2 + 3, z: 15, w: W - 4, d: 3, h: 20, top: solid('#4a5c66'), left: (_u, v, X, Y) => (Math.abs(v - 0.5) < 0.04 ? col('#6e808b') : scaleC(col('#2a363e'), 0.95 + hsh(X >> 1, Y >> 1, 5) * 0.1)), right: solid('#2a363e') });
  out.push({ x: 0, y: -D / 2 + 6, z: 24, w: W - 6, d: 4.4, h: 1, top: solid('#6e808b'), left: solid('#5a6a72'), right: solid('#4a5a62') });
  const bottles = ['#22bccc', '#34bc5a', '#ff5d9e', '#8646cc', '#e0b020'];
  bottles.forEach((c, i) => {
    const bx = -W / 2 + 10 + i * 9, sh = i % 2 === 0 ? 25 : 15;
    out.push({ x: bx, y: -D / 2 + 6, z: sh, w: 3.4, d: 3.4, h: 6, top: solid('#e8eef0'), left: solid(c), right: solid(c) });
  });
  // cubo amarillo con agua y escurridor
  const bx = -W / 2 + 14, by = 6;
  out.push({ x: bx, y: by, z: 15, w: 15, d: 13, h: 9, top: (u, v, X, Y) => (u > 0.12 && u < 0.88 && v > 0.12 && v < 0.88 ? scaleC(col('#3a8ab0'), 0.9 + hsh(X >> 1, Y >> 1, 9) * 0.2) : yel), left: solid('#e0b020'), right: solid('#b88a18') });
  out.push({ x: bx + 9, y: by, z: 20, w: 4, d: 9, h: 5, top: solid('#8a9aa2'), left: solid('#6e808b'), right: solid('#5a6a72') });
  // fregona de repuesto en el cubo
  out.push({ x: bx - 1.5, y: by - 1, z: 22.5, w: 6, d: 6, h: 2.4, top: (_u, _v, X, Y) => (hsh(X, Y >> 1, 11) > 0.5 ? col('#d8d4c0') : col('#a8a490')), left: solid('#c8c4b0'), right: solid('#a8a490') });
  rod(out, [bx - 1.5, by - 1, 24], [bx - 3.5, by - 3, 46], 1.4, solid('#8a6a44'), 12);
  // botes de detergente rojos
  for (let i = 0; i < 3; i++) out.push({ x: W / 2 - 18 + i * 5, y: 8, z: 15, w: 3.6, d: 3.6, h: 6, top: solid('#e8eef0'), left: solid('#c8283a'), right: solid('#9a1a28') });
  // piloto de recarga
  out.push({ x: W / 2 - 6, y: D / 2 - 4, z: 15, w: 2.4, d: 2.4, h: 1.2, top: solid('#4ff0ff'), left: solid('#22bccc'), right: solid('#13889a') });
  return out;
}

// ───────────────────────── criaturas de bloques ─────────────────────────

export interface IsoSpriteSpec { frames: number; w: number; h: number; fx: number; fy: number }
export const ISO_CREATURES: Record<string, IsoSpriteSpec> = {
  glorp: { frames: 6, w: 40, h: 40, fx: 20, fy: 32 },
  glorp_big: { frames: 6, w: 40, h: 40, fx: 20, fy: 32 },
  invasor: { frames: 6, w: 48, h: 40, fx: 24, fy: 32 },
  babosa: { frames: 4, w: 56, h: 36, fx: 28, fy: 27 },
  rata: { frames: 4, w: 32, h: 26, fx: 16, fy: 20 },
  insecto: { frames: 2, w: 20, h: 16, fx: 10, fy: 12 },
  rogue: { frames: 2, w: 30, h: 26, fx: 15, fy: 20 },
  cleanbot: { frames: 2, w: 30, h: 26, fx: 15, fy: 20 },
  reina: { frames: 3, w: 96, h: 92, fx: 48, fy: 70 },
  rey: { frames: 3, w: 84, h: 76, fx: 42, fy: 60 },
};

/** ojo cúbico: la pupila mira hacia +x (cara derecha) */
function eyeCube(x: number, y: number, z: number, size: number, state: 'normal' | 'angry' | 'stun', iris = '#14101c'): IsoBox {
  const white = col('#f4f4f0');
  const pupil = (u: number, v: number) => {
    if (state === 'stun') return Math.abs(u - v) < 0.14 || Math.abs(u + v - 1) < 0.14 ? col('#2a1020') : white;
    if (state === 'angry' && v < 0.3) return col('#141016');
    return u > 0.3 && u < 0.7 && v > 0.3 && v < 0.75 ? col(state === 'angry' ? '#e8203a' : iris) : white;
  };
  return { x, y, z, w: size, d: size, h: size, top: solid('#ffffff', 0.03), left: () => white, right: pupil };
}

function creatureBoxes(key: string, f: number): IsoBox[] {
  const out: IsoBox[] = [];
  switch (key) {
    case 'glorp': case 'glorp_big': {
      const big = key === 'glorp_big';
      const base = big ? '#6a32b8' : '#1fa86a', light = big ? '#a878f0' : '#5ef0b0', dark = big ? '#3e1a70' : '#0e6a44';
      const [W, H] = ([[14, 9], [14.6, 8.4], [13, 10.6], [15.4, 7.8], [15, 9.8], [16, 6.6]] as [number, number][])[f];
      const state = f === 4 ? 'angry' : f === 5 ? 'stun' : 'normal';
      const shine = (_u: number, v: number, X: number, Y: number) => scaleC(col(light), 1 - v * 0.1 + hsh(X >> 1, Y >> 1, 4) * 0.08);
      out.push({ x: 0, y: 0, z: 0, w: W, d: W * 0.86, h: H * 0.55, top: solid(base), left: solid(base), right: (u, v) => (v > 0.38 && v < 0.62 && u > 0.22 && u < 0.78 ? col('#08201a') : col(dark)) });
      out.push({ x: -0.6, y: 0, z: H * 0.55, w: W - 3.6, d: W * 0.86 - 3, h: H * 0.45, top: shine, left: shine, right: solid(base) });
      for (const sy of [-1, 1]) {
        const stalk = state === 'stun' ? 1.8 : 3.4;
        out.push({ x: 1.8, y: sy * 2.6, z: H, w: 1.2, d: 1.2, h: stalk, top: solid(base), left: solid(base), right: solid(dark) });
        out.push(eyeCube(1.8, sy * 2.6, H + stalk, 3, state));
      }
      if (f === 4) for (const sx of [-4, 0, 4]) out.push({ x: sx - 2, y: 0, z: H, w: 1.6, d: 1.6, h: 2.2, top: solid('#ff5d6c'), left: solid(dark), right: solid(dark) });
      break;
    }
    case 'invasor': {
      const ch = col('#141a20'), hi = '#5e7284', bone = col('#c4bc9c');
      const dead = f === 5, hurt = f === 4, attack = f === 2 || f === 3;
      const shell = (u: number, _v: number, X: number, Y: number) => (Math.abs(((u * 5) % 1) - 0.5) < 0.08 ? bone : scaleC(hurt ? col('#3a4a5a') : ch, 0.9 + hsh(X >> 1, Y >> 1, 2) * 0.25));
      if (dead) {
        out.push({ x: 0, y: 0, z: 0, w: 15, d: 10, h: 4, top: shell, left: solid('#1a2028'), right: solid('#141a20') });
        for (const lx of [-4, 3]) for (const sy of [-1, 1]) out.push({ x: lx, y: sy * 3.5, z: 4, w: 1.4, d: 1.4, h: 4.5, top: solid(hi), left: solid('#28323e'), right: solid('#1a2028') });
        out.push({ x: 9, y: 0, z: 0, w: 6, d: 7, h: 4, top: (u, v) => (u > 0.5 && (v < 0.3 || v > 0.7) ? col('#2a1020') : ch), left: solid('#1a2028'), right: solid('#141a20') });
        break;
      }
      const ph = f === 1 ? 1 : f === 3 ? -1 : f === 0 ? -1 : 1;
      for (const lx of [-4, 3.5]) for (const sy of [-1, 1]) {
        const off = (lx < 0 ? ph : -ph) * sy * 1.2;
        out.push({ x: lx + off, y: sy * 6.2, z: 0, w: 1.8, d: 2.6, h: 2, top: solid(hi), left: solid('#28323e'), right: solid('#1a2028') });
        out.push({ x: lx + off * 0.5, y: sy * 5, z: 2, w: 1.5, d: 1.5, h: 3.6, top: solid(hi), left: solid('#28323e'), right: solid('#1a2028') });
      }
      out.push({ x: -1, y: 0, z: 4, w: 14, d: 10, h: 6, top: shell, left: (u, v, X, Y) => (v > 0.8 ? bone : shell(u, v, X, Y)), right: solid('#1a2028') });
      for (let i = 0; i < 4; i++) out.push({ x: -9 - i * 2.4, y: 0, z: 8 + i * 1.6, w: 3 - i * 0.5, d: 3 - i * 0.5, h: 2.4 - i * 0.3, top: solid('#a89c80'), left: solid('#28323e'), right: solid('#1a2028') });
      const hx = 8.5 + (attack ? 1.6 : 0);
      out.push({ x: hx, y: 0, z: 5, w: 7, d: 8, h: 6, top: solid('#28323e'), left: solid('#1a2028'), right: (u, v) => (v > 0.25 && v < 0.5 && ((u > 0.15 && u < 0.38) || (u > 0.62 && u < 0.85)) ? col('#f4a62a') : ch) });
      if (attack) out.push({ x: hx + 3.5, y: 0, z: 3, w: 3, d: 6, h: 2.2, top: (u) => (Math.floor(u * 6) % 2 ? col('#f4f4f0') : col('#9a1020')), left: solid('#9a1020'), right: solid('#7a0a18') });
      break;
    }
    case 'babosa': {
      const body = '#c8d84a', mantle = '#8aa83a', belly = '#e8f08a';
      for (let i = 0; i < 5; i++) {
        const x = -14 + i * 6.4, hh = 4.4 + Math.sin(i * 1.3 + f * Math.PI / 2) * 1.1 + (i === 4 ? 1 : 0);
        out.push({ x, y: 0, z: 0, w: 6.8, d: 11 - Math.abs(i - 2) * 0.8, h: hh, top: (_u, v, X, Y) => scaleC(col(i % 2 ? mantle : body), 1 - v * 0.1 + hsh(X >> 1, Y >> 1, i) * 0.08), left: (_u, v) => (v > 0.75 ? col(belly) : col(body)), right: solid(mantle) });
      }
      for (const sy of [-1, 1]) {
        out.push({ x: 13, y: sy * 2.6, z: 6, w: 1.2, d: 1.2, h: 4, top: solid(body), left: solid(body), right: solid(mantle) });
        out.push(eyeCube(13, sy * 2.6, 10, 2.4, 'normal'));
      }
      break;
    }
    case 'rata': {
      const fur = '#7a7a8e', dark = '#5a5a6c', pink = '#e88aa0';
      const run = f % 2;
      for (const lx of [-3, 3]) for (const sy of [-1, 1]) out.push({ x: lx + (run ? sy : -sy) * 0.8, y: sy * 2, z: 0, w: 1.4, d: 1.4, h: 1.6, top: solid(pink), left: solid(pink), right: solid(pink) });
      out.push({ x: -1, y: 0, z: 1.4, w: 9.5, d: 5.4, h: 4.2 + (f === 2 ? 0.5 : 0), top: (_u, _v, X, Y) => scaleC(col(fur), 0.9 + hsh(X >> 1, Y >> 1, 6) * 0.2), left: solid(fur), right: solid(dark) });
      out.push({ x: 6, y: 0, z: 2, w: 4.6, d: 4.2, h: 3.6, top: solid(fur), left: solid(fur), right: (u, v) => (v > 0.2 && v < 0.45 && (u < 0.3 || u > 0.7) ? col('#ff3040') : v > 0.6 && u > 0.4 && u < 0.6 ? col(pink) : col(dark)) });
      for (const sy of [-1, 1]) out.push({ x: 5, y: sy * 1.7, z: 5.6, w: 1.2, d: 1.8, h: 1.8, top: solid(pink), left: solid(pink), right: solid(pink) });
      rod(out, [-5.5, 0, 3], [-12, (run ? 1.5 : -1.5), 1.4], 0.9, solid(pink), 7);
      break;
    }
    case 'insecto': {
      const shell = '#7a3a2a';
      for (const lx of [-1.6, 0.4, 2.2]) for (const sy of [-1, 1]) out.push({ x: lx + (f ? sy : -sy) * 0.5, y: sy * 2.4, z: 0, w: 0.7, d: 2.2, h: 0.7, top: solid('#2a1a14'), left: solid('#2a1a14'), right: solid('#2a1a14') });
      out.push({ x: 0, y: 0, z: 0.7, w: 5.4, d: 3.4, h: 2.2, top: (u) => (Math.abs(u - 0.5) < 0.06 ? col('#3a1a10') : col(shell)), left: solid(shell), right: solid('#5a2a1a') });
      out.push({ x: 3.4, y: 0, z: 0.8, w: 2, d: 2.4, h: 1.8, top: solid('#3a1a10'), left: solid('#3a1a10'), right: (_u, v) => (v < 0.5 ? col('#e8f040') : col('#3a1a10')) });
      break;
    }
    case 'rogue': case 'cleanbot': {
      const rogue = key === 'rogue';
      const shell = rogue ? '#5a5a66' : '#c8ccd0', band = rogue ? '#c8283a' : '#22bccc', light = rogue ? (f ? '#ff3040' : '#7a1020') : (f ? '#4ff0ff' : '#13889a');
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push({ x: sx * 3.5, y: sy * 3.5, z: 0, w: 2, d: 2, h: 1.2, top: solid('#141a1d'), left: solid('#141a1d'), right: solid('#141a1d') });
      out.push({ x: 0, y: 0, z: 1, w: 11, d: 11, h: 4, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.18 ? col('#2a3036') : col(shell)), left: (_u, v) => (v > 0.4 && v < 0.65 ? col(band) : col(shell)), right: (u, v) => (rogue && v < 0.4 && ((u > 0.2 && u < 0.38) || (u > 0.62 && u < 0.8)) ? col('#ff3040') : v > 0.4 && v < 0.65 ? col(band) : col(shell)) });
      out.push({ x: 0, y: 0, z: 5, w: 3, d: 3, h: 1.2, top: solid(light), left: solid(light), right: solid(light) });
      break;
    }
    case 'reina': {
      const pulse = [0, 1, 2][f];
      const mold = (_u: number, v: number, X: number, Y: number) => scaleC(col(f === 2 ? '#5a8a4a' : '#3e5a2a'), 0.85 + hsh(X >> 2, Y >> 2, 3) * 0.3 - v * 0.1);
      const fung = (_u: number, v: number, X: number, Y: number) => scaleC(col(f === 2 ? '#b080e8' : '#7a3aa8'), 0.85 + hsh(X >> 2, Y >> 2, 5) * 0.3 - v * 0.1);
      out.push({ x: 0, y: 0, z: 0, w: 46, d: 42, h: 10 + pulse, top: mold, left: mold, right: mold });
      out.push({ x: -2, y: 0, z: 10 + pulse, w: 34, d: 30, h: 11, top: fung, left: fung, right: fung });
      out.push({ x: -4, y: 0, z: 21 + pulse, w: 20, d: 18, h: 8, top: solid('#c8a0e8'), left: fung, right: fung });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; out.push({ x: -4 + Math.cos(a) * 7, y: Math.sin(a) * 6, z: 29 + pulse, w: 2.6, d: 2.6, h: 5 + (i % 3) * 2, top: solid('#e8d84a'), left: solid('#a89a20'), right: solid('#7a6a10') }); }
      out.push({ x: 15, y: 0, z: 12 + pulse, w: 6, d: 12, h: 8, top: fung, left: fung, right: (u, v) => (Math.abs(u - 0.5) < 0.07 && v > 0.15 && v < 0.85 ? col('#1a0a10') : Math.hypot(u - 0.5, (v - 0.5) * 0.8) < 0.38 ? col('#f4a62a') : col('#5a2a7a')) });
      for (let i = 0; i < 5; i++) out.push({ x: -20 + i * 9, y: 18 - (i % 2) * 34, z: 0, w: 3, d: 3, h: 2 + (i + f) % 3, top: solid('#e8d84a'), left: solid('#a89a20'), right: solid('#7a6a10') });
      break;
    }
    case 'rey': {
      const bob = f === 1 ? 0.6 : 0;
      const metal = (_u: number, v: number, X: number, Y: number) => scaleC(col('#9aa0a8'), 0.88 + hsh(X >> 2, Y >> 2, 7) * 0.2 - v * 0.15);
      out.push({ x: 0, y: 0, z: 0, w: 30, d: 26, h: 4, top: solid('#141a1d'), left: (u) => (Math.floor(u * 10) % 2 ? col('#141a1d') : col('#2a3036')), right: solid('#141a1d') });
      out.push({ x: 0, y: 0, z: 4, w: 28, d: 24, h: 16, top: metal, left: (_u, v, X, Y) => (v > 0.7 && v < 0.82 ? col('#c8283a') : metal(0, v, X, Y)), right: (u, v, X, Y) => (v > 0.22 && v < 0.42 && u > 0.12 && u < 0.88 ? col(f === 2 ? '#ff6070' : '#ff3040') : v > 0.7 && v < 0.82 ? col('#c8283a') : metal(u, v, X, Y)) });
      out.push({ x: 17, y: 0, z: 1, w: 6, d: 10, h: 4, top: solid('#2a3036'), left: solid('#2a3036'), right: solid('#141a1d') });
      out.push({ x: 0, y: 0, z: 20 + bob, w: 18, d: 14, h: 3, top: solid('#e0b020'), left: solid('#c8941a'), right: solid('#9a6a10') });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; out.push({ x: Math.cos(a) * 6, y: Math.sin(a) * 4.5, z: 23 + bob, w: 2.4, d: 2.4, h: 4 + (i % 2) * 2, top: solid('#fff09a'), left: solid('#e0b020'), right: solid('#9a6a10') }); }
      out.push({ x: 0, y: 0, z: 26 + bob, w: 2.6, d: 2.6, h: 2.6, top: solid('#ff5d6c'), left: solid('#c8283a'), right: solid('#9a1a28') });
      break;
    }
  }
  return out;
}

export function isoCreatureSheet(key: string): HTMLCanvasElement | null {
  const sp = ISO_CREATURES[key];
  if (!sp) return null;
  const out = new Raster(sp.w * sp.frames, sp.h);
  for (let f = 0; f < sp.frames; f++) {
    const r = new Raster(sp.w, sp.h);
    drawBoxes(r, sp.fx, sp.fy, creatureBoxes(key, f), true);
    r.grade({ sat: 0.85, dark: 0.9, grime: 0.1, tint: '#06140e', seed: f + key.length });
    r.rimLight('#eafff4', 0.3);
    r.outline('#020304', 0.78);
    out.blit(r, f * sp.w, 0);
  }
  return out.toCanvas();
}

// ───────────────────────── efectos de bloques ─────────────────────────

export const ISO_FX: Record<string, IsoSpriteSpec> = {
  fx_fire: { frames: 4, w: 32, h: 40, fx: 16, fy: 32 },
  fx_ghost: { frames: 1, w: 24, h: 30, fx: 12, fy: 26 },
  fx_cup: { frames: 1, w: 14, h: 16, fx: 7, fy: 12 },
  fx_foam: { frames: 1, w: 14, h: 14, fx: 7, fy: 10 },
  fx_star: { frames: 1, w: 12, h: 12, fx: 6, fy: 9 },
};

function fxBoxes(key: string, f: number): IsoBox[] {
  const out: IsoBox[] = [];
  const glow = (c: string) => solid(c, 0.04);
  switch (key) {
    case 'fx_fire': {
      const j = (i: number, k: number) => (hsh(i, f, k) - 0.5);
      for (let i = 0; i < 4; i++) out.push({ x: j(i, 1) * 10, y: j(i, 2) * 10, z: 0, w: 6, d: 6, h: 7 + hsh(i, f, 3) * 7, top: glow('#ffb040'), left: glow('#e8401a'), right: glow('#a0141a') });
      for (let i = 0; i < 3; i++) out.push({ x: j(i, 4) * 6, y: j(i, 5) * 6, z: 7 + hsh(i, f, 6) * 4, w: 4.6, d: 4.6, h: 6 + hsh(i, f, 7) * 5, top: glow('#fff6c8'), left: glow('#ffd24a'), right: glow('#ff8a2a') });
      out.push({ x: j(9, 8) * 3, y: j(9, 9) * 3, z: 18 + (f % 2) * 2, w: 2.6, d: 2.6, h: 3, top: glow('#ffffff'), left: glow('#fff6c8'), right: glow('#ffd24a') });
      break;
    }
    case 'fx_ghost': {
      const g = (u: number, v: number) => ((u > 0.18 && u < 0.38 || u > 0.62 && u < 0.82) && v > 0.25 && v < 0.45 ? col('#1a1a2a') : v > 0.55 && v < 0.62 && u > 0.35 && u < 0.65 ? col('#1a1a2a') : col('#d8e8f0'));
      out.push({ x: 0, y: 0, z: 4, w: 10, d: 9, h: 13, top: solid('#f4f8ff'), left: g, right: g });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push({ x: sx * 3, y: sy * 2.6, z: 2, w: 3, d: 3, h: 2, top: solid('#d8e8f0'), left: solid('#c8d8e8'), right: solid('#a8b8c8') });
      break;
    }
    case 'fx_cup':
      out.push({ x: 0, y: 0, z: 0, w: 5, d: 5, h: 6, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.36 ? col('#5a3418') : col('#f4f4f0')), left: (_u, v) => (v > 0.3 && v < 0.5 ? col('#c8283a') : col('#f4f4f0')), right: solid('#d8d8d0') });
      out.push({ x: 3.3, y: 0, z: 1.6, w: 1.2, d: 1.4, h: 2.6, left: solid('#d8d8d0'), right: solid('#b8b8b0'), top: solid('#f4f4f0') });
      break;
    case 'fx_foam':
      out.push({ x: 0, y: 0, z: 0, w: 7, d: 7, h: 6.4, top: solid('#ffffff', 0.03), left: solid('#e8f0f8', 0.03), right: solid('#c8d4e0', 0.03) });
      break;
    case 'fx_star':
      out.push({ x: 0, y: 0, z: 0, w: 5.6, d: 5.6, h: 5.6, top: solid('#e8fcff', 0.03), left: solid('#a8f0ff', 0.03), right: solid('#5ac8e8', 0.03) });
      break;
  }
  return out;
}

export function isoFxSheet(key: string): HTMLCanvasElement | null {
  const sp = ISO_FX[key];
  if (!sp) return null;
  const out = new Raster(sp.w * sp.frames, sp.h);
  for (let f = 0; f < sp.frames; f++) {
    const r = new Raster(sp.w, sp.h);
    drawBoxes(r, sp.fx, sp.fy, fxBoxes(key, f), true);
    if (key !== 'fx_fire') r.outline('#05040a', 0.7);
    out.blit(r, f * sp.w, 0);
  }
  return out.toCanvas();
}


// ───────────────────────── muebles pequeños de bloques ─────────────────────────

const CUSTOM_PROP_H: Partial<Record<PropKind, number>> = {
  plant: 30, coffee: 32, toilet: 22, sink: 36, bin: 20, barrel: 24, captainChair: 32, medkit: 30,
  console: 30, holoTable: 32, gravityGen: 38, counter: 26, table: 18, tank: 38, bench: 26, reactor: 48, reactorConsole: 26,
  pipes: 42, toolrack: 36, bed: 16, locker: 42, chute: 30, vending: 42, medBed: 18, medPod: 22, medScanner: 30,
  medCabinet: 42, plantBed: 30, hydroTank: 44, secretLocker: 44,
};

/** caras con grano y una banda opcional */
const banded = (base: string, band: string | null, v0: number, v1: number): Face => {
  const c = col(base), bc = band ? col(band) : 0;
  return (_u, v, X, Y) => (bc && v > v0 && v < v1 ? bc : scaleC(c, 0.94 + hsh(X >> 1, Y >> 1, 7) * 0.12));
};

/** caja de un color (las caras laterales ya se sombrean solas) */
const sb = (x: number, y: number, z: number, w: number, d: number, h: number, c: string, n = 0.06): IsoBox => ({ x, y, z, w, d, h, top: solid(c, n), left: solid(c, n), right: solid(c, n) });
/** pantalla con líneas de barrido */
const screenF = (c: string, f: number) => (_u: number, v: number, X: number, Y: number): number => scaleC(col(c), Math.abs(((v * 24 + f * 2) % 3) - 1.5) < 0.4 ? 0.6 : 0.95 + hsh(X >> 1, Y >> 1, f + 5) * 0.1);

function customPropBoxes(kind: PropKind, variant: number, f: number): IsoBox[] | null {
  const out: IsoBox[] = [];
  const pd = PROP_DEFS[kind], W = pd.w * 32 - 2, D = pd.h * 32 - 2;
  switch (kind) {
    case 'console': {
      out.push({ x: 0, y: 3, z: 0, w: W - 4, d: D - 10, h: 12, top: (u, v) => (v > 0.3 && v < 0.6 && ((u > 0.1 && u < 0.14) || (u > 0.18 && u < 0.22) || (u > 0.26 && u < 0.3)) ? col(u < 0.15 ? '#e83a4a' : u < 0.23 ? '#ffd23f' : '#5dff9b') : v > 0.4 && v < 0.5 && u > 0.5 && u < 0.75 ? col(u > 0.56 + f * 0.1 && u < 0.6 + f * 0.1 ? '#c8d0e8' : '#1a1f30') : col('#5a6a72')), left: (u, v) => (v > 0.4 && Math.abs(((u * 30) % 2) - 1) < 0.3 ? col('#2a3048') : col('#3a4650')), right: solid('#3a4650') });
      out.push({ x: 0, y: -D / 2 + 4, z: 12, w: W - 16, d: 3, h: 16, top: solid('#2a3036'), left: (u, v) => (u > 0.06 && u < 0.94 && v > 0.1 && v < 0.9 ? screenF(f ? '#5dff9b' : '#4ff0ff', f)(u, v, 0, Math.floor(v * 40)) : col('#1a2028')), right: solid('#1a2028') });
      out.push(sb(0, -D / 2 + 4, 0, 6, 3, 12, '#2a3036'));
      break;
    }
    case 'holoTable': {
      out.push({ x: 0, y: 0, z: 0, w: W - 6, d: D - 8, h: 12, top: (u, v) => (Math.abs(u - 0.5) < 0.46 && Math.abs(v - 0.5) < 0.38 ? col('#0c2a30') : col('#6e808b')), left: (u, v) => (v > 0.55 && v < 0.7 && Math.floor(u * 12) % 2 === 0 ? col(f ? '#5ae8f0' : '#13889a') : col('#3a4650')), right: solid('#3a4650') });
      const ring = 10, ph = f * 0.4;
      for (let i = 0; i < 8; i++) { const a = ph + (i / 8) * Math.PI * 2; out.push(sb(Math.cos(a) * ring * 2.4, Math.sin(a) * ring * 0.9, 20 + Math.sin(a * 2) * 1.5, 2.2, 2.2, 2.2, '#7cf0f8', 0.02)); }
      out.push(sb(0, 0, 18, 8, 8, 8, '#4ff0ff', 0.04));
      out.push(sb(0, 0, 26, 3, 3, 3, '#e8ffff', 0.02));
      break;
    }
    case 'gravityGen': {
      const off = f === 2, core = off ? '#3a3050' : f ? '#c8a0ff' : '#9a60e8', lamp = off ? '#e83a4a' : '#5dff9b';
      out.push({ x: 0, y: 0, z: 0, w: W - 4, d: D - 4, h: 8, top: (u, v) => (Math.abs(u - 0.5) > 0.42 || Math.abs(v - 0.5) > 0.42 ? (Math.floor((u + v) * 14) % 2 ? col('#ffd23f') : col('#1a1a22')) : col('#4a5660')), left: solid('#3a4650'), right: solid('#3a4650') });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        out.push(sb(sx * 20, sy * 20, 8, 8, 8, 24, '#2a3036'));
        out.push(sb(sx * 20, sy * 20, 32, 4, 4, 2, lamp, 0.02));
      }
      out.push({ x: 0, y: 0, z: 8, w: 20, d: 20, h: 20, top: solid(core, 0.04), left: (_u, v) => (Math.abs(((v * 20 + f * 3) % 5) - 2.5) < 0.6 ? col(off ? '#2a2038' : '#ddc2ff') : col(core)), right: solid(core, 0.04) });
      if (!off) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + f * 0.5; out.push(sb(Math.cos(a) * 15, Math.sin(a) * 15, 17 + (i % 2) * 3, 2, 2, 2, '#ddc2ff', 0.02)); }
      break;
    }
    case 'counter': {
      const on = f === 1;
      out.push({ x: 0, y: 0, z: 0, w: W - 2, d: D - 4, h: 14, top: (u, v) => {
        for (const cx of [0.12, 0.4, 0.68]) if (Math.abs(u - cx) < 0.06 && Math.abs(v - 0.5) < 0.3) return Math.hypot((u - cx) * 3, v - 0.5) < 0.18 ? col(on ? '#ff8a2a' : '#3a3a48') : col('#141418');
        return col('#8a9aa2');
      }, left: (u, v) => (v > 0.3 && v < 0.5 && Math.abs(((u * 20) % 1) - 0.5) < 0.12 ? col('#c8d0e0') : v > 0.6 && Math.floor(u * 10) % 2 ? col('#2a3048') : col('#5a6a72')), right: solid('#4a5660') });
      out.push(sb(-W / 2 + 14, 0, 14, 10, 9, 7, '#8a9aa2'));
      out.push(sb(-W / 2 + 14, 0, 21, 10, 9, 0.6, '#c8a070'));
      out.push(sb(W * 0.02, 0, 14, 12, 10, 2, '#2a2a30'));
      out.push(sb(W * 0.3, -2, 14, 9, 9, 10, '#a2afc4'));
      if (on) for (const cx of [0.12, 0.4, 0.68]) { const x = -W / 2 + cx * W; out.push(sb(x - 2, 0, 14, 2, 2, 3, '#ffd24a', 0.02)); out.push(sb(x + 2, 1, 14, 2, 2, 2.4, '#ff8a2a', 0.02)); }
      break;
    }
    case 'table': {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(sb(sx * (W / 2 - 5), sy * (D / 2 - 6), 0, 2.6, 2.6, 10, '#3a2010'));
      out.push({ x: 0, y: 0, z: 10, w: W - 4, d: D - 6, h: 2.6, top: (_u, v, X, Y) => scaleC(col('#a87a4a'), 0.9 + hsh(X >> 2, Y, 3) * 0.16 - (Math.abs(((v * 6) % 1) - 0.5) < 0.04 ? 0.15 : 0)), left: solid('#7a5230'), right: solid('#6a4224') });
      out.push({ x: -W / 4, y: 1, z: 12.6, w: 10, d: 8, h: 1, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.25 ? col('#ff8a3d') : col('#f4f4f0')), left: solid('#e8e8e0'), right: solid('#c8c8c0') });
      out.push({ x: W / 5, y: 0, z: 12.6, w: 4, d: 4, h: 4.5, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.3 ? col('#5a3418') : col('#f4f4f0')), left: solid('#f4f4f0'), right: solid('#d8d8d0') });
      break;
    }
    case 'tank': case 'hydroTank': {
      const hydro = kind === 'hydroTank', liquid = hydro ? '#3ad8a8' : '#2ac98a', th = hydro ? 32 : 26;
      out.push(sb(0, 0, 0, W - 4, D - 4, 6, '#4a5660'));
      const glass = (u: number, v: number, X: number, Y: number) => {
        if (u < 0.1) return col('#d8fff0');
        for (let i = 0; i < 4; i++) { const bu = 0.25 + ((i * 0.23 + f * 0.11) % 0.6), bv = 1 - ((i * 0.27 + f * 0.17) % 0.9); if (Math.hypot(u - bu, (v - bv) * 1.6) < 0.05) return col('#e8fff8'); }
        if (!hydro && Math.hypot(u - 0.5, (v - 0.6) * 0.8) < 0.22) return col('#0e5a3e');
        if (!hydro && Math.hypot(u - 0.5, v - 0.32) < 0.14) return col('#0e5a3e');
        return scaleC(col(liquid), 0.8 + v * 0.15 + hsh(X >> 1, Y >> 1, 3) * 0.08);
      };
      out.push({ x: 0, y: 0, z: 6, w: W - 8, d: D - 8, h: th, top: solid('#7ad8c8'), left: glass, right: glass });
      out.push(sb(0, 0, 6 + th, W - 4, D - 4, 4, '#5a6a72'));
      if (hydro) out.push(sb(W / 2 - 2, 0, 16, 4, 4, 4, '#8a9aa2'));
      break;
    }
    case 'bench': {
      out.push({ x: 0, y: 0, z: 0, w: W - 2, d: D - 6, h: 13, top: solid('#e8eef0'), left: (u, v) => (v > 0.15 && Math.abs(((u * 6) % 1) - 0.5) < 0.02 ? col('#7a86ad') : v > 0.4 && v < 0.5 && Math.abs(((u * 6) % 1) - 0.5) < 0.1 ? col('#c8d0e0') : col('#a2afc4')), right: solid('#8a96b0') });
      out.push({ x: -W / 2 + 12, y: -2, z: 13, w: 5, d: 5, h: 8, top: solid('#e8f4ff'), left: (_u, v) => (v > 0.4 ? col('#b07aff') : col('#c8e8f4')), right: (_u, v) => (v > 0.4 ? col('#8646cc') : col('#a8c8d8')) });
      out.push({ x: -W / 2 + 26, y: 1, z: 13, w: 7, d: 7, h: 6, top: solid('#e8f4ff'), left: (_u, v) => (v > 0.35 ? col('#34bc5a') : col('#c8e8f4')), right: (_u, v) => (v > 0.35 ? col('#1f8a3a') : col('#a8c8d8')) });
      for (let i = 0; i < 4; i++) out.push(sb(-2 + i * 2.6, -4, 13, 1.4, 1.4, 6, i % 2 ? '#e83a4a' : '#4ff0ff', 0.03));
      out.push(sb(W / 2 - 18, -3, 13, 8, 6, 3, '#4a5660'));
      out.push(sb(W / 2 - 18, -4, 16, 2.4, 2.4, 8, '#8a9aa2'));
      out.push(sb(W / 2 - 16, -2, 22, 4, 2.4, 2.4, '#5a6a72'));
      out.push(sb(8, 5, 13, 10, 7, 0.5, '#f2f0ff'));
      break;
    }
    case 'reactor': {
      const hot = f === 2, glow = hot ? '#ff8a2a' : f ? '#7ae8ff' : '#4ff0ff';
      out.push({ x: 0, y: 0, z: 0, w: W - 2, d: D - 2, h: 10, top: (u, v) => (Math.abs(u - 0.5) > 0.42 || Math.abs(v - 0.5) > 0.42 ? (Math.floor((u + v) * 16) % 2 ? col('#ffd23f') : col('#1a1a22')) : col('#4a5660')), left: (u, v) => (v > 0.45 && v < 0.75 && Math.floor(u * 12) % 2 ? col('#ffd23f') : col('#3a4650')), right: solid('#3a4650') });
      const core = (u: number, v: number, X: number, Y: number) => (Math.abs(u - 0.5) < 0.18 && v > 0.08 && v < 0.92 ? scaleC(col(glow), 0.85 + Math.abs(((v * 30 + f * 4) % 6) - 3) * 0.05) : Math.abs(((v * 34) % 8) - 4) < 0.6 ? col('#1a1f30') : scaleC(col('#5a6a72'), 0.9 + hsh(X >> 1, Y >> 1, 2) * 0.15));
      out.push({ x: 0, y: 0, z: 10, w: 30, d: 30, h: 30, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.2 ? col(glow) : col('#6e808b')), left: core, right: core });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(sb(sx * 23, sy * 23, 10, 6, 6, 32, '#b86a30'));
      out.push(sb(0, 0, 40, 34, 34, 4, '#4a5660'));
      out.push(sb(0, 0, 44, 10, 10, 3, glow, 0.02));
      break;
    }
    case 'reactorConsole': {
      out.push({ x: 0, y: 2, z: 0, w: W - 4, d: D - 10, h: 12, top: solid('#5a6a72'), left: (u, v) => (v > 0.3 && v < 0.6 && ((u > 0.15 && u < 0.3) || (u > 0.65 && u < 0.8)) ? col(u < 0.5 ? (f ? '#e83a4a' : '#5dff9b') : '#ffd23f') : col('#3a4650')), right: solid('#3a4650') });
      out.push({ x: 0, y: -D / 2 + 4, z: 12, w: W - 8, d: 3, h: 12, top: solid('#2a3036'), left: (u, v) => {
        if (u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92) return col('#2a3036');
        const ang = f ? 0.35 : -0.35, nx = 0.5 + Math.sin(ang) * (0.85 - v) * 0.8;
        if (v > 0.2 && Math.abs(u - nx) < 0.04 && v < 0.85) return col(f ? '#e83a4a' : '#1fae5c');
        return col('#eef0f2');
      }, right: solid('#1a2028') });
      break;
    }
    case 'pipes': {
      out.push(sb(0, -D / 2 + 5, 0, W - 2, 9, 6, '#4a5660'));
      const cs = ['#8a9aa2', '#c27a3a', '#5a6a72'];
      for (let i = 0; i < 3; i++) {
        const x = -W / 2 + 12 + i * 19;
        out.push({ x, y: -D / 2 + 6, z: 0, w: 7, d: 7, h: 40, top: solid(cs[i]), left: (_u, v) => (Math.abs(((v * 40) % 10) - 5) < 0.6 ? col('#262b40') : col(cs[i])), right: solid(cs[i]) });
        out.push(sb(x, -D / 2 + 10.5, 12 + i * 7, 9, 2, 4, '#c8283a'));
      }
      out.push({ x: W / 2 - 8, y: -D / 2 + 9, z: 24, w: 8, d: 3, h: 8, top: solid('#e8eef0'), left: (u, v) => (Math.abs(u - 0.5 - (0.5 - v) * 0.4) < 0.07 && v < 0.6 ? col('#e83a4a') : col('#f4f4f0')), right: solid('#c8c8c0') });
      out.push(sb(0, -D / 2 + 6, 34, W - 6, 6, 5, '#6e808b'));
      break;
    }
    case 'toolrack': {
      out.push({ x: 0, y: -D / 2 + 3, z: 0, w: W - 4, d: 3, h: 34, top: solid('#8a6a42'), left: (u, v, X, Y) => (Math.abs(((u * 40) % 2) - 1) < 0.25 && Math.abs(((v * 30) % 2) - 1) < 0.25 ? col('#4a3420') : scaleC(col('#8a6a42'), 0.92 + hsh(X >> 1, Y >> 1, 4) * 0.12)), right: solid('#6a4a2a') });
      out.push(sb(0, -D / 2 + 9, 0, W - 4, 10, 9, '#5a6a72'));
      // herramientas colgadas
      out.push(sb(-W / 2 + 12, -D / 2 + 5.5, 14, 2, 2, 14, '#c8d0e0'));
      out.push(sb(-W / 2 + 12, -D / 2 + 5.5, 27, 6, 2, 3, '#c8d0e0'));
      out.push(sb(-W / 2 + 26, -D / 2 + 5.5, 12, 2.4, 2, 14, '#8a5a2a'));
      out.push(sb(-W / 2 + 26, -D / 2 + 5.5, 25, 9, 2.4, 4, '#5a6a72'));
      out.push(sb(-W / 2 + 40, -D / 2 + 5.5, 18, 1.6, 2, 9, '#c8d0e0'));
      out.push(sb(-W / 2 + 40, -D / 2 + 5.5, 12, 2.8, 2.4, 6, '#c8283a'));
      out.push(sb(-W / 2 + 52, -D / 2 + 5.5, 12, 8, 1.6, 16, '#a2afc4'));
      out.push(sb(-W / 2 + 20, -D / 2 + 10, 9, 6, 5, 4, '#e0b020'));
      break;
    }
    case 'bed': case 'medBed': {
      const med = kind === 'medBed';
      const blanket = med ? '#5ab8c8' : ['#5a6ad8', '#d85a8a', '#4ab89a', '#d8a04a'][variant % 4];
      out.push(sb(0, 0, 0, W - 2, D - 2, med ? 8 : 5, med ? '#a2afc4' : '#4a5660'));
      out.push(sb(0, 0, med ? 8 : 5, W - 4, D - 4, 3, '#e8eef0'));
      out.push({ x: 0, y: -D / 2 + 9, z: (med ? 8 : 5) + 3, w: W - 10, d: 10, h: 3, top: (u, v) => (Math.abs(v - 0.5) < 0.06 ? col('#c8d0d8') : col('#f8fafc')), left: solid('#e8eef0'), right: solid('#d8dee4') });
      out.push({ x: 0, y: 7, z: (med ? 8 : 5) + 3, w: W - 3.4, d: D - 26, h: 3, top: (_u, v, X, Y) => (v < 0.08 ? scaleC(col(blanket), 1.25) : scaleC(col(blanket), 0.92 + hsh(X >> 1, Y >> 1, 4) * 0.12 - (Math.abs(v - 0.55 - _u * 0.1) < 0.02 ? 0.2 : 0))), left: solid(blanket), right: solid(blanket) });
      if (med) for (const sx of [-1, 1]) out.push(sb(sx * (W / 2 - 1.5), 4, 11, 1.6, D - 22, 4, '#c8d0e0'));
      else out.push({ x: 0, y: -D / 2 + 1.5, z: 0, w: W - 2, d: 3, h: 15, top: solid('#5a6a72'), left: (u, v) => (v > 0.2 && v < 0.75 && Math.abs(((u * 4) % 1) - 0.5) < 0.08 ? col('#2a3036') : col('#5a6a72')), right: solid('#4a5660') });
      break;
    }
    case 'locker': case 'secretLocker': {
      const secret = kind === 'secretLocker';
      const c0 = secret ? '#e0b020' : ['#5a7a9a', '#7a6a9a', '#5a8a7a'][variant % 3];
      out.push({ x: 0, y: -3, z: 0, w: W - 4, d: D - 10, h: 40, top: solid(c0), left: (u, v, X, Y) => {
        if (Math.abs(u - 0.5) < 0.012) return scaleC(col(c0), 0.55);
        if (secret && inText('MOP', u, v, 0.22, 0.3, 0.78, 0.42)) return col('#7a4a0c');
        if (!secret && v > 0.12 && v < 0.4 && Math.abs(((v * 40) % 2.4) - 1.2) < 0.4 && (u < 0.44 || u > 0.56) && u > 0.1 && u < 0.9) return scaleC(col(c0), 0.55);
        if (v > 0.55 && v < 0.65 && (Math.abs(u - 0.42) < 0.03 || Math.abs(u - 0.58) < 0.03)) return col('#d6def0');
        if (!secret && v > 0.78 && v < 0.84 && u > 0.15 && u < 0.35) return col('#f2f0ff');
        return scaleC(col(c0), 0.92 + hsh(X >> 1, Y >> 1, 3) * 0.12);
      }, right: solid(c0) });
      if (secret && f) for (const [x, y, z] of [[-10, 8, 34], [11, 6, 12], [-9, 9, 6], [10, 7, 30]]) out.push(sb(x, y, z, 1.6, 1.6, 1.6, '#fff6c8', 0.02));
      break;
    }
    case 'chute': {
      out.push({ x: 0, y: -2, z: 0, w: W - 4, d: D - 8, h: 28, top: (u, v) => (Math.abs(u - 0.5) < 0.36 && Math.abs(v - 0.5) < 0.3 ? col('#05070a') : col('#6e808b')), left: (u, v) => {
        if (v < 0.14) return Math.floor(u * 10) % 2 ? col('#ffd23f') : col('#1a1a22');
        if (u > 0.18 && u < 0.82 && v > 0.28 && v < 0.8) return v < 0.32 ? col('#56618a') : col('#05070a');
        if (Math.abs(u - 0.5) < 0.06 && v > 0.84) return col('#ffd23f');
        return col('#5a6a72');
      }, right: solid('#4a5660') });
      break;
    }
    case 'vending': {
      const broken = f === 1, body = broken ? '#5a2a30' : '#b02838';
      const snack = ['#ffd23f', '#5dff9b', '#ff5d9e', '#4ff0ff', '#ff8a3d'];
      out.push({ x: 0, y: -3, z: 0, w: W - 4, d: D - 10, h: 40, top: solid(body), left: (u, v) => {
        if (u > 0.1 && u < 0.66 && v > 0.1 && v < 0.7) {
          if (broken) return Math.abs(u - 0.15 - v * 0.6) < 0.025 || Math.abs(u - 0.6 + v * 0.5) < 0.025 ? col('#c8d0e0') : col('#141016');
          const gx = Math.floor((u - 0.1) / 0.56 * 3), gy = Math.floor((v - 0.1) / 0.6 * 5);
          const lu = ((u - 0.1) / 0.56 * 3) % 1, lv = ((v - 0.1) / 0.6 * 5) % 1;
          if (lu > 0.2 && lu < 0.8 && lv > 0.25 && lv < 0.85) return col(snack[(gx + gy) % 5]);
          return u + v < 0.4 ? col('#c8f0ff') : col('#5a8aa8');
        }
        if (u > 0.74 && u < 0.88 && v > 0.22 && v < 0.3) return col('#ffd23f');
        if (u > 0.15 && u < 0.6 && v > 0.78 && v < 0.9) return col('#141016');
        return col(body);
      }, right: solid(body) });
      break;
    }
    case 'medPod': {
      const occ = f === 1;
      out.push(sb(0, 0, 0, W - 2, D - 2, 8, '#e8eef0'));
      out.push({ x: 0, y: 0, z: 8, w: W - 8, d: D - 10, h: 10, top: (u, v) => {
        if (u < 0.12) return col('#e8ffff');
        if (occ && Math.hypot(u - 0.5, (v - 0.18) * 1.2) < 0.14) return col('#d8b090');
        if (occ && Math.abs(u - 0.5) < 0.24 && v > 0.3 && v < 0.85) return col('#3a4a7a');
        return col('#7ad8f0');
      }, left: solid('#5ab8d0', 0.03), right: solid('#4aa0b8', 0.03) });
      out.push(sb(0, D / 2 - 4, 8, 6, 2, 2, occ ? '#5dff9b' : '#4ff0ff', 0.02));
      break;
    }
    case 'medScanner': {
      out.push({ x: 0, y: 2, z: 0, w: W - 4, d: D - 10, h: 12, top: solid('#e8eef0'), left: (u, v) => ((Math.abs(u - 0.5) < 0.03 && Math.abs(v - 0.5) < 0.3) || (Math.abs(v - 0.5) < 0.1 && Math.abs(u - 0.5) < 0.09) ? col('#e83a4a') : col('#dfe5ea')), right: solid('#c4ccd4') });
      out.push({ x: 0, y: -D / 2 + 4, z: 12, w: W - 18, d: 3, h: 16, top: solid('#2a3036'), left: (u, v) => {
        if (u < 0.05 || u > 0.95 || v < 0.08 || v > 0.92) return col('#2a3036');
        const k = Math.floor(((u * 40 + f * 8) % 20));
        const y = k === 8 ? 0.2 : k === 10 ? 0.8 : k === 12 ? 0.35 : 0.5;
        return Math.abs(v - y) < 0.06 ? col('#5dff9b') : col('#06140e');
      }, right: solid('#1a2028') });
      break;
    }
    case 'medCabinet': {
      const cs = ['#e83a4a', '#4ff0ff', '#ffd23f', '#5dff9b'];
      out.push({ x: 0, y: -5, z: 0, w: W - 4, d: D - 14, h: 40, top: solid('#f4f6f8'), left: (u, v) => {
        if (v < 0.14 && ((Math.abs(u - 0.5) < 0.05 && v > 0.02) || (Math.abs(v - 0.08) < 0.025 && Math.abs(u - 0.5) < 0.14))) return col('#e83a4a');
        if (u > 0.12 && u < 0.88 && v > 0.2 && v < 0.82) {
          const row = v < 0.5 ? 0 : 1, lv = row ? (v - 0.52) / 0.3 : (v - 0.22) / 0.26;
          const i = Math.floor((u - 0.14) / 0.18), lu = ((u - 0.14) / 0.18) % 1;
          if (i >= 0 && i < 4 && lu > 0.25 && lu < 0.75 && lv > 0.35 && lv < 0.95) return col(cs[row ? 3 - i : i]);
          if (Math.abs(v - 0.5) < 0.012) return col('#c8d0e0');
          return u + v < 0.5 ? col('#e4fbff') : col('#9fd0e4');
        }
        return col('#eef0f2');
      }, right: solid('#c4ccd4') });
      break;
    }
    case 'plantBed': {
      out.push({ x: 0, y: 0, z: 0, w: W - 4, d: D - 6, h: 10, top: (u, v, X, Y) => (Math.abs(u - 0.5) < 0.47 && Math.abs(v - 0.5) < 0.36 ? scaleC(col('#3a2414'), 0.9 + hsh(X >> 1, Y >> 1, 2) * 0.2) : col('#8a5a2a')), left: solid('#7a4a24'), right: solid('#6a3e1e') });
      for (let i = 0; i < 7; i++) {
        const x = -W / 2 + 10 + i * ((W - 20) / 6);
        out.push(sb(x, -2, 10, 6, 6, 4, i % 2 ? '#3a9a3a' : '#4ab84a'));
        out.push(sb(x + 1.5, 1, 14, 4.5, 4.5, 3, '#5ac84a'));
        if ((i + variant) % 3 === 0) out.push(sb(x - 1, 3, 13, 2.4, 2.4, 2.4, f ? '#e83a4a' : '#ff8a3d', 0.03));
      }
      for (const sx of [-1, 1]) out.push(sb(sx * (W / 2 - 4), -D / 2 + 4, 10, 2, 2, 16, '#5a6a72'));
      out.push(sb(0, -D / 2 + 4, 26, W - 6, 3, 2.4, '#d080ff', 0.02));
      break;
    }
    case 'plant': {
      out.push({ x: 0, y: 0, z: 0, w: 14, d: 14, h: 10, top: (u, v) => (u > 0.12 && u < 0.88 && v > 0.12 && v < 0.88 ? col('#2a1a10') : col('#c8683a')), left: banded('#b85a30', '#8a3a1e', 0.1, 0.24), right: banded('#9a4a26', '#7a3018', 0.1, 0.24) });
      rod(out, [0, 0, 9], [0, 0, 18], 1.6, solid('#3a7a2a'), 4);
      const leaves: [number, number, number, number][] = [[-5, 1, 13, 7], [5, -2, 16, 6], [0, 5, 19, 6], [-3, -4, 22, 5], [2, 1, 25, 4.5], [6, 4, 12, 5]];
      leaves.forEach(([x, y, z, sz], i) => out.push({ x, y, z, w: sz, d: sz, h: 2.6, top: solid(i % 2 ? '#5ac84a' : '#7ae86a'), left: solid('#3a9a3a'), right: solid('#2a7a2a') }));
      // capullo biomecánico (toque Giger): vaina de hueso con ojo ámbar
      out.push({ x: 2, y: 1, z: 27.5, w: 3, d: 3, h: 2.4, top: solid('#f4a62a'), left: solid('#c4bc9c'), right: solid('#949178') });
      break;
    }
    case 'coffee': {
      const broken = f === 1, body = broken ? '#4a3434' : '#3a3044';
      const front = (u: number, v: number, X: number, Y: number) => {
        if (v > 0.1 && v < 0.28 && u > 0.18 && u < 0.62) return broken ? (((X + Y) >> 1) & 1 ? col('#e83a4a') : col('#5a1018')) : col('#5dff9b');
        if (v > 0.12 && v < 0.24 && u > 0.72 && u < 0.84) return broken ? col('#141016') : col('#e83a4a');
        if (v > 0.4 && v < 0.86 && u > 0.22 && u < 0.78) return col('#0c0a10');
        return scaleC(col(body), 0.94 + hsh(X >> 1, Y >> 1, 3) * 0.12);
      };
      out.push({ x: 0, y: -2, z: 0, w: 18, d: 14, h: 30, top: solid('#5a6a72'), left: front, right: (_u, v, X, Y) => (Math.abs(((v * 30) % 4) - 2) < 0.5 ? col('#1a1620') : scaleC(col(body), 0.9 + hsh(X >> 1, Y >> 1, 4) * 0.1)) });
      out.push({ x: 0, y: 6, z: 0, w: 14, d: 3, h: 2, top: (u) => (Math.floor(u * 8) % 2 ? col('#8a9aa2') : col('#4a5a62')), left: solid('#6e808b'), right: solid('#4a5a62') });
      if (!broken) out.push({ x: 0, y: 4, z: 2, w: 4, d: 4, h: 4.5, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.34 ? col('#5a3418') : col('#f4f4f0')), left: solid('#f4f4f0'), right: solid('#d8d8d0') });
      else out.push({ x: 1, y: 11, z: 0, w: 10, d: 6, h: 0.6, top: solid('#6b3f1f'), left: solid('#4a2a10'), right: solid('#3a2008') });
      break;
    }
    case 'toilet': {
      const dirty = f >= 1, water = dirty ? '#6d6a2a' : '#7ad8f0';
      out.push({ x: 0, y: -9, z: 0, w: 16, d: 6, h: 20, top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.16 ? col('#a2afc4') : col('#f0f2f4')), left: banded('#e8ecf0', null, 0, 0), right: solid('#c8d0d8') });
      out.push({ x: 0, y: 2, z: 0, w: 14, d: 16, h: 10, top: (u, v) => (u > 0.18 && u < 0.82 && v > 0.14 && v < 0.86 ? (dirty && hsh(Math.floor(u * 9), Math.floor(v * 9), 2) > 0.6 ? col('#3a3810') : col(water)) : col('#f4f6f8')), left: solid('#e4e8ec'), right: solid('#c4ccd4') });
      if (f === 2) {
        out.push({ x: -11, y: 10, z: 0, w: 7, d: 5, h: 0.6, top: solid('#6d6a2a'), left: solid('#4a4810'), right: solid('#3a3808') });
        out.push({ x: 10, y: 8, z: 0, w: 6, d: 6, h: 0.6, top: solid('#6d6a2a'), left: solid('#4a4810'), right: solid('#3a3808') });
      }
      break;
    }
    case 'sink': {
      out.push({ x: 0, y: -12.5, z: 18, w: 18, d: 1.6, h: 15, top: solid('#9db4c6'), left: (u, v) => (Math.abs(u - v * 0.6 - 0.15) < 0.06 ? col('#e4fbff') : col('#5a8aa8')), right: solid('#3a5a70') });
      out.push({ x: 0, y: -2, z: 0, w: 5, d: 5, h: 12, top: solid('#a2afc4'), left: solid('#a2afc4'), right: solid('#7a86ad') });
      out.push({ x: 0, y: -1, z: 12, w: 20, d: 14, h: 6, top: (u, v) => (Math.hypot((u - 0.5) * 1.4, v - 0.55) < 0.32 ? col('#7ad8f0') : col('#f4f6f8')), left: solid('#e4e8ec'), right: solid('#c4ccd4') });
      out.push({ x: 0, y: -7, z: 18, w: 1.6, d: 1.6, h: 5, top: solid('#c8d0e0'), left: solid('#a2afc4'), right: solid('#7a86ad') });
      out.push({ x: 0, y: -4.5, z: 22, w: 1.6, d: 4, h: 1.4, top: solid('#c8d0e0'), left: solid('#a2afc4'), right: solid('#7a86ad') });
      break;
    }
    case 'bin': {
      const full = f === 1;
      out.push({ x: 0, y: 0, z: 0, w: 14, d: 14, h: 14, top: (u, v) => (u > 0.12 && u < 0.88 && v > 0.12 && v < 0.88 ? col('#0c0f10') : col('#8a9aa2')), left: (u, v, X, Y) => (v > 0.3 && v < 0.38 ? col('#262b40') : v > 0.46 && v < 0.6 && u > 0.42 && u < 0.58 ? col(full ? '#e83a4a' : '#5dff9b') : scaleC(col('#6e808b'), 0.92 + hsh(X >> 1, Y >> 1, 3) * 0.12)), right: banded('#5a6a72', '#262b40', 0.3, 0.38) });
      if (full) {
        out.push({ x: -2, y: -1, z: 13, w: 6, d: 6, h: 4.5, top: solid('#f4f4f0'), left: solid('#d8d8d0'), right: solid('#b8b8b0') });
        out.push({ x: 3.5, y: 2.5, z: 13, w: 3, d: 3, h: 5.5, top: solid('#c8c8c8'), left: solid('#c8283a'), right: solid('#9a1a28') });
        out.push({ x: 0, y: 4.5, z: 14, w: 5, d: 2, h: 1.4, top: solid('#ffe24a'), left: solid('#e0b020'), right: solid('#b88a18') });
      }
      break;
    }
    case 'barrel': {
      const fuel = variant % 2 === 1, base = fuel ? '#c84a1a' : '#2a2438', side = fuel ? '#a03a14' : '#1e1a2a';
      const front = (u: number, v: number, X: number, Y: number) => {
        if ((v > 0.1 && v < 0.2) || (v > 0.82 && v < 0.92)) return col('#ffd23f');
        // triángulo de peligro
        const tv = (v - 0.32) / 0.4, tu = Math.abs(u - 0.5);
        if (tv > 0 && tv < 1 && tu < tv * 0.3) return tu < tv * 0.3 - 0.07 && tv > 0.16 ? (tu < 0.03 && tv > 0.35 && tv < 0.85 ? col('#e83a4a') : col('#1a1a22')) : col('#ffd23f');
        return scaleC(col(base), 0.92 + hsh(X >> 1, Y >> 1, 5) * 0.14);
      };
      out.push({ x: 0, y: 0, z: 0, w: 16, d: 16, h: 22, top: (u, v) => (Math.hypot(u - 0.72, v - 0.3) < 0.1 ? col('#141016') : Math.abs(u - 0.5) > 0.42 || Math.abs(v - 0.5) > 0.42 ? col('#ffd23f') : col(fuel ? '#e86a2a' : '#3a3450')), left: front, right: banded(side, '#c8a020', 0.1, 0.2) });
      break;
    }
    case 'captainChair': {
      const red = '#c8283a', dk = '#7a1420';
      out.push({ x: 0, y: 0, z: 0, w: 12, d: 12, h: 2, top: solid('#2a3048'), left: solid('#1a2030'), right: solid('#141824') });
      out.push({ x: 0, y: 0, z: 2, w: 3, d: 3, h: 6, top: solid('#3a4260'), left: solid('#3a4260'), right: solid('#2a3048') });
      out.push({ x: 0, y: 1.5, z: 8, w: 18, d: 16, h: 4, top: (u, v) => (Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.5) < 0.03 ? col(dk) : col(red)), left: solid(red), right: solid(dk) });
      for (const sx of [-1, 1]) out.push({ x: sx * 9.5, y: 2, z: 12, w: 2.6, d: 13, h: 4, top: solid('#a2afc4'), left: solid('#7a86ad'), right: solid('#5a6690') });
      out.push({ x: 0, y: -7.5, z: 12, w: 18, d: 4, h: 18, top: solid(red), left: (u, v, X, Y) => (v > 0.12 && v < 0.3 && u > 0.38 && u < 0.62 ? col('#ffd23f') : scaleC(col(red), 0.92 + hsh(X >> 1, Y >> 1, 2) * 0.12 - (Math.abs(((u * 18) % 6) - 3) < 0.4 ? 0.2 : 0))), right: solid(dk) });
      break;
    }
    case 'medkit': {
      const cross = f ? '#8a8a9a' : '#e83a4a';
      out.push({ x: 0, y: 0, z: 0, w: 14, d: 10, h: 2, top: solid('#8a9aa2'), left: solid('#6e808b'), right: solid('#5a6a72') });
      out.push({ x: 0, y: -1, z: 2, w: 2.2, d: 2.2, h: 10, top: solid('#a2afc4'), left: solid('#a2afc4'), right: solid('#7a86ad') });
      out.push({ x: 0, y: -1, z: 12, w: 18, d: 8, h: 16, top: solid('#f4f6f8'), left: (u, v) => ((Math.abs(u - 0.5) < 0.09 && Math.abs(v - 0.5) < 0.3) || (Math.abs(v - 0.5) < 0.1 && Math.abs(u - 0.5) < 0.27) ? col(cross) : col('#eef0f2')), right: solid('#c4ccd4') });
      out.push({ x: 0, y: -1, z: 28, w: 3, d: 3, h: 1.4, top: solid(f ? '#5a5a66' : '#ff5d6c'), left: solid(f ? '#3a3a44' : '#c8283a'), right: solid(f ? '#2a2a34' : '#9a1a28') });
      break;
    }
    default: return null;
  }
  return out;
}

// ───────────────────────── hojas a partir de cajas (encuadre automático) ─────────────────────────

export interface IsoSheetInfo { w: number; h: number; fx: number; fy: number; frames: number }

/** encuadra todos los fotogramas en el mismo marco y devuelve dónde cae el origen del modelo */
export function sheetFromBoxes(frames: IsoBox[][], finish?: (r: Raster, f: number) => void): { canvas: HTMLCanvasElement; info: IsoSheetInfo } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const bs of frames) for (const b of bs) for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const z of [b.z, b.z + b.h]) {
    const px = b.x + sx * b.w, py = b.y + sy * b.d;
    const X = (px - py) * A, Y = (px + py) * B - z;
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  const pad = 2;
  const w = Math.ceil(x1 - x0 + pad * 2), h = Math.ceil(y1 - y0 + pad * 2);
  const fx = -x0 + pad, fy = -y0 + pad;
  const out = new Raster(w * frames.length, h);
  frames.forEach((bs, f) => {
    const r = new Raster(w, h);
    drawBoxes(r, fx, fy, bs, true);
    if (finish) finish(r, f);
    else { r.rimLight('#cfe8ee', 0.2); r.outline('#020304', 0.7); }
    out.blit(r, f * w, 0);
  });
  return { canvas: out.toCanvas(), info: { w, h, fx, fy, frames: frames.length } };
}

// ───────────────────────── puertas correderas ─────────────────────────

/** altura de las hojas: la de los muros bajos, para no tapar a nadie */
export const ISO_DOOR_H = 13;

function doorBoxes(orient: 'h' | 'v', end: 'a' | 'b', f: number): IsoBox[] {
  const out: IsoBox[] = [];
  const frac = [1, 0.69, 0.375, 0.125][f];
  const L = 32 * frac, T = 5, H = ISO_DOOR_H;
  const sg = end === 'a' ? -1 : 1;
  const c = sg * (16 - L / 2);
  // cromo negro acanalado con banda de peligro arriba
  const broad: Face = (_u, v, X, Y) => {
    if (v > 0.07 && v < 0.24) return ((X + Y) >> 2) & 1 ? col('#d08a1a') : col('#0a0806');
    if (Math.abs(((v * H) % 3) - 1.5) < 0.35) return col('#3a4652');
    return scaleC(col('#1a2028'), 0.9 + hsh(X >> 1, Y >> 1, 9) * 0.2);
  };
  const edge = solid('#2a3440');
  const topF = solid('#5e7284');
  if (orient === 'h') out.push({ x: c, y: 0, z: 0, w: L, d: T, h: H, top: topF, left: broad, right: edge });
  else out.push({ x: 0, y: c, z: 0, w: T, d: L, h: H, top: topF, left: edge, right: broad });
  // canto de vértebras en el borde que se desliza
  if (L > 6) {
    const e = c - sg * (L / 2 - 1);
    for (let k = 0; k < 4; k++) {
      const z = 1 + k * 3;
      if (orient === 'h') out.push({ x: e, y: 0, z, w: 2, d: T + 1.2, h: 2.2, top: solid('#ece4c8'), left: solid('#c4bc9c'), right: solid('#949178') });
      else out.push({ x: 0, y: e, z, w: T + 1.2, d: 2, h: 2.2, top: solid('#ece4c8'), left: solid('#c4bc9c'), right: solid('#949178') });
    }
  }
  // pilar de vértebras en la jamba (dentro del muro contiguo, más alto que los muros bajos)
  const PH = 22, along = sg * 19;
  const at = (a: number, z: number, w: number, d: number, h: number, top: Face, left: Face, right: Face): IsoBox =>
    orient === 'h' ? { x: a, y: 0, z, w, d, h, top, left, right } : { x: 0, y: a, z, w: d, d: w, h, top, left, right };
  out.push(at(along, 0, 6, 9, PH, solid('#2a3440'), (_u, v, X, Yp) => scaleC(col('#1a2028'), 0.9 + hsh(X >> 1, Yp >> 1, 6) * 0.2 + (Math.abs(((v * PH) % 5) - 2.5) < 0.5 ? 0.4 : 0)), solid('#141a20')));
  for (const z of [3, 8, 13, 18]) out.push(at(along, z, 7.4, 10.4, 1.8, solid('#ece4c8'), solid('#c4bc9c'), solid('#949178')));
  // piloto: ámbar cerrada, verde ácido abierta
  const lc = f === 0 ? ['#ffc24a', '#f4a62a', '#b8761a'] : ['#c8ff9a', '#7dff5a', '#46b84a'];
  out.push(at(along, PH, 3.4, 3.4, 1.8, solid(lc[0], 0.02), solid(lc[1], 0.02), solid(lc[2], 0.02)));
  return out;
}

export function isoDoorSheet(orient: 'h' | 'v', end: 'a' | 'b') {
  // las cuatro hojas comparten encuadre: se incluye una caja invisible del tamaño de la casilla
  const frames = [0, 1, 2, 3].map((f) => [...doorBoxes(orient, end, f), { x: 0, y: 0, z: 0, w: 32, d: 32, h: ISO_DOOR_H + 2 }]);
  return sheetFromBoxes(frames, (r) => { r.rimLight('#cfe8ee', 0.25); r.outline('#020304', 0.7); });
}

// ───────────────────────── paneles, tuberías y brechas en la pared ─────────────────────────

/** modelos colgados de la cara sur del bloque de muro; el origen es el centro de la casilla del muro */
function fixtureBoxes(kind: 'fix_panel' | 'fix_pipe' | 'fix_breach', f: number): IsoBox[] {
  const out: IsoBox[] = [];
  const Y = 16; // cara sur del muro
  if (kind === 'fix_panel') {
    const grav = f >= 2, broken = f % 2 === 1;
    const body = grav ? '#4a3a6a' : '#4a5660';
    const face: Face = (u, v, X, Yp) => {
      if (broken) {
        if (u > 0.1 && u < 0.9 && v > 0.12 && v < 0.88) {
          const w1 = Math.abs(v - (0.2 + u * 0.7)) < 0.05, w2 = Math.abs(v - (0.85 - u * 0.6)) < 0.05, w3 = Math.abs(v - 0.5 - Math.sin(u * 9) * 0.1) < 0.04;
          return w1 ? col('#e83a4a') : w2 ? col('#ffd23f') : w3 ? col('#4ff0ff') : col('#0a0c10');
        }
        return scaleC(col(body), 0.7);
      }
      if (v > 0.16 && v < 0.34 && ((u > 0.18 && u < 0.32) || (u > 0.42 && u < 0.56))) return u < 0.35 ? col('#5dff9b') : col(grav ? '#b07aff' : '#ffd23f');
      if (v > 0.48 && v < 0.82 && u > 0.16 && u < 0.84) return Math.abs(((v * 30 + f * 3) % 4) - 2) < 0.5 ? col('#13889a') : col('#22bccc');
      return scaleC(col(body), 0.92 + hsh(X >> 1, Yp >> 1, 4) * 0.14);
    };
    out.push({ x: 0, y: Y + 1.4, z: 1.5, w: 20, d: 2.8, h: 11, top: solid('#8a9aa2'), left: face, right: solid('#2a3036') });
    out.push({ x: 0, y: Y + 1.4, z: 12.5, w: 4, d: 1.6, h: 1.4, top: solid('#ffe24a'), left: solid('#e0b020'), right: solid('#b88a18') });
    if (broken) out.push({ x: 4, y: Y + 3.4, z: 9, w: 1.4, d: 1.4, h: 1.4, top: solid('#ffffff', 0.02), left: solid('#fff6a0', 0.02), right: solid('#ffd24a', 0.02) });
  } else if (kind === 'fix_pipe') {
    const frozen = f === 3, steel = frozen ? '#c8e8f4' : '#8a9aa2', copper = frozen ? '#d8f4ff' : '#c27a3a';
    out.push({ x: 0, y: Y + 2, z: 6, w: 32, d: 3.6, h: 3.6, top: solid(steel), left: (u, v) => (Math.abs(((u * 32) % 8) - 4) < 0.5 ? col('#4a5a62') : col(steel)), right: solid(frozen ? '#a8c8d8' : '#5a6a72') });
    out.push({ x: 0, y: Y + 2, z: 0, w: 3.4, d: 3.4, h: 13, top: solid(copper), left: solid(copper), right: solid(frozen ? '#a8c8d8' : '#8a4a20') });
    out.push({ x: 0, y: Y + 4.2, z: 10, w: 6, d: 1.4, h: 2.4, top: solid('#e83a4a'), left: solid('#c8283a'), right: solid('#9a1a28') });
    if (f === 1) for (const [x, z] of [[-6, 3], [5, 1.5], [9, 4], [-11, 1]]) out.push({ x, y: Y + 3, z, w: 1.2, d: 1.2, h: 1.6, top: solid('#e4fbff', 0.02), left: solid('#7ad8f0', 0.02), right: solid('#4aa8c8', 0.02) });
    if (f === 2) out.push({ x: -7, y: Y + 2, z: 5.6, w: 5, d: 4.4, h: 4.4, top: solid('#d8d6c0'), left: (u) => (Math.abs(u - 0.5) < 0.08 ? col('#a8a690') : col('#d8d6c0')), right: solid('#b8b6a0') });
    if (frozen) for (const [x, z] of [[-9, 9.6], [3, 9.6], [12, 9.6], [-2, 13]]) out.push({ x, y: Y + 2, z, w: 2.6, d: 3, h: 1.6, top: solid('#ffffff', 0.02), left: solid('#e8fcff', 0.02), right: solid('#c8f0ff', 0.02) });
  } else {
    if (f < 2) {
      // agujero al espacio: placa de bordes rasgados con estrellas
      const hole: Face = (u, v, X, Yp) => {
        const r = Math.hypot((u - 0.5) * 1.2, v - 0.5);
        const jag = 0.36 + hsh(Math.floor(u * 10), Math.floor(v * 8), 3) * 0.1;
        if (r < jag) return hsh(X, Yp, f + 7) > 0.97 ? col('#ffffff') : hsh(X, Yp, f + 9) > 0.985 ? col('#9fb4ff') : col('#020108');
        if (r < jag + 0.08) return col('#8a94b8');
        return 0;
      };
      out.push({ x: 0, y: Y + 0.4, z: 1, w: 22, d: 0.8, h: 12, left: hole, top: undefined, right: undefined });
      for (const [x, z, a] of [[-10, 2, 1], [9, 10, -1], [-8, 11, 1], [10, 2, -1]]) out.push({ x, y: Y + 1.4, z, w: 3, d: 2, h: 2, top: solid('#a8b0c8'), left: solid('#8a94b8'), right: solid('#5a6590') }), void a;
    } else {
      for (const [x, z, sz] of [[0, 3, 9], [-6, 2, 6], [6, 6, 6], [-2, 8, 5], [3, 1, 5]]) out.push({ x, y: Y + 2, z, w: sz, d: 3.6, h: sz * 0.8, top: solid('#ffffff', 0.03), left: solid('#e8f0f8', 0.03), right: solid('#c8d4e0', 0.03) });
    }
  }
  return out;
}

export function isoFixtureSheet(kind: 'fix_panel' | 'fix_pipe' | 'fix_breach') {
  const n = kind === 'fix_breach' ? 3 : 4;
  return sheetFromBoxes(Array.from({ length: n }, (_, f) => fixtureBoxes(kind, f)));
}

// ───────────────────────── candado y trampa ─────────────────────────

export function isoLockSheet() {
  const boxes: IsoBox[] = [
    { x: 0, y: 0, z: 0, w: 7, d: 3.4, h: 6.4, top: solid('#ff5d6c'), left: (u, v) => (Math.abs(u - 0.5) < 0.1 && v > 0.3 && v < 0.7 ? col('#14101c') : col('#e83a4a')), right: solid('#9a1a28') },
    { x: -2.4, y: 0, z: 6.4, w: 1.4, d: 1.4, h: 3, top: solid('#e8eef0'), left: solid('#c8d0e0'), right: solid('#8a9aa2') },
    { x: 2.4, y: 0, z: 6.4, w: 1.4, d: 1.4, h: 3, top: solid('#e8eef0'), left: solid('#c8d0e0'), right: solid('#8a9aa2') },
    { x: 0, y: 0, z: 9.4, w: 6.2, d: 1.4, h: 1.4, top: solid('#e8eef0'), left: solid('#c8d0e0'), right: solid('#8a9aa2') },
  ];
  return sheetFromBoxes([boxes]);
}

export function isoTrapSheet() {
  const frames = [0, 1].map((f) => {
    const sprung = f === 1;
    const out: IsoBox[] = [{ x: 0, y: 0, z: 0, w: 16, d: 11, h: 3, top: solid('#5a6a72'), left: banded('#4a5660', '#262b40', 0.4, 0.55), right: solid('#3a4650') }];
    for (let i = 0; i < 6; i++) for (const sy of [-1, 1]) {
      const x = -6.5 + i * 2.6;
      if (sprung) out.push({ x, y: sy * 0.9, z: 3, w: 1.2, d: 1.2, h: 2.2, top: solid('#c8d0e0'), left: solid('#a2afc4'), right: solid('#7a86ad') });
      else out.push({ x, y: sy * 4, z: 3, w: 1.2, d: 1.2, h: 3.2, top: solid('#e8eef0'), left: solid('#c8d0e0'), right: solid('#8a9aa2') });
    }
    out.push({ x: 0, y: 5.8, z: 0.8, w: 4, d: 0.8, h: 1.4, top: solid(sprung ? '#5dff9b' : '#e83a4a', 0.02), left: solid(sprung ? '#5dff9b' : '#e83a4a', 0.02), right: solid(sprung ? '#2a9a5a' : '#9a1a28', 0.02) });
    return out;
  });
  return sheetFromBoxes(frames);
}


// ───────────────────────── congelación y espuma ─────────────────────────

/** color con transparencia (0..1) */
const colA = (hex: string, a: number) => ((col(hex) & 0xffffff) | (Math.round(Math.max(0, Math.min(1, a)) * 255) << 24)) >>> 0;

/** cara de hielo: translúcida, con vetas brillantes, grietas, aristas claras y escarcha abajo */
function iceFace(seed: number, top = false): Face {
  return (u, v, X, Y) => {
    const edge = Math.min(u, v, 1 - u, 1 - v);
    if (edge < 0.05) return colA('#f4feff', 0.92);
    if (!top && v > 0.82 && hsh(X >> 1, Y >> 1, seed + 3) > 0.35) return colA('#ffffff', 0.85);
    if (Math.abs(((u * 1.2 + v * 0.7 + seed * 0.13) % 0.5) - 0.25) < 0.018) return colA('#ffffff', 0.75);
    if (Math.abs(u - 0.62 - (v - 0.3) * 0.5) < 0.012 && v > 0.25 && v < 0.7) return colA('#5ac8e8', 0.8);
    if (hsh(X, Y, seed + 9) > 0.985) return colA('#ffffff', 1);
    return top ? colA('#d8f8ff', 0.6) : colA('#9fe4ff', 0.36 + v * 0.12);
  };
}

/** bloque de hielo que encierra a una criatura ('creature') o a un tripulante de pie ('crew') */
export function isoIceSheet(kind: 'creature' | 'crew') {
  const crew = kind === 'crew';
  const w = crew ? 21 : 22, d = crew ? 17 : 20, h = crew ? 46 : 20;
  const boxes: IsoBox[] = [{ x: 0, y: 0, z: 0, w, d, h, top: iceFace(1, true), left: iceFace(2), right: iceFace(3) }];
  // escarcha y trozos de hielo en la base
  for (const [x, y, sz] of [[-w / 2 + 1, d / 2 - 1, 4], [w / 2 - 1, d / 2 + 0.5, 3.4], [w / 2 + 0.5, -d / 2 + 3, 3], [-w / 2 + 3, d / 2 + 1.5, 2.6]] as [number, number, number][])
    boxes.push({ x, y, z: 0, w: sz, d: sz, h: sz * 0.7, top: solid('#ffffff', 0.04), left: solid('#e8fcff', 0.04), right: solid('#c8f0ff', 0.04) });
  // esquirlas que asoman por arriba
  for (const [x, y, hh] of [[-3, -2, 6], [3, 2, 4.5], [5, -4, 3.5]] as [number, number, number][])
    boxes.push({ x, y, z: h, w: 2.6, d: 2.6, h: hh, top: iceFace(4, true), left: iceFace(5), right: iceFace(6) });
  return sheetFromBoxes([boxes], (r) => r.rimLight('#ffffff', 0.25));
}

/** espuma que cubre a una criatura: montón de pompas blancas */
export function isoFoamCoatSheet() {
  const boxes: IsoBox[] = [];
  const foam = (seed: number): Face => (u, v, X, Y) => (hsh(X >> 1, Y >> 1, seed) > 0.93 ? col('#ffffff') : scaleC(col('#eef4fa'), 0.9 + hsh(X >> 2, Y >> 2, seed + 1) * 0.12 - v * 0.06 + (u < 0.15 ? 0.06 : 0)));
  boxes.push({ x: 0, y: 0, z: 0, w: 22, d: 20, h: 8, top: foam(1), left: foam(2), right: foam(3) });
  const lumps: [number, number, number, number][] = [[-4, -3, 8, 9], [4, 2, 8, 8], [0, -1, 13, 7], [-6, 5, 8, 6], [6, -5, 8, 6], [2, 4, 15, 5], [-3, 1, 18, 4]];
  lumps.forEach(([x, y, z, sz], i) => boxes.push({ x, y, z, w: sz, d: sz, h: sz * 0.8, top: foam(10 + i), left: foam(20 + i), right: foam(30 + i) }));
  for (const [x, y, z] of [[-9, 8, 2], [10, 6, 4], [8, -9, 3], [-10, -6, 5]] as [number, number, number][])
    boxes.push({ x, y, z, w: 2.4, d: 2.4, h: 2.4, top: solid('#ffffff', 0.02), left: solid('#f4f8ff', 0.02), right: solid('#d8e4f0', 0.02) });
  return sheetFromBoxes([boxes]);
}
