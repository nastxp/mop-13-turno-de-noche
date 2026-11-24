import { col, rampOf, RAMPS, Raster, type Ramp } from './raster';
import type { CharLook } from '../data/crew';

/**
 * Fotogramas por dirección: reposo, paso A, paso medio, paso B, paso medio, acción A/B, brazos arriba,
 * parpadeo, KO y tres de «andar cargando» (brazos arriba + paso A, paso medio, paso B).
 */
export const CHAR_FRAMES = 13;
export const FRAME = { idle: 0, walkA: 1, pass1: 2, walkB: 3, pass2: 4, actA: 5, actB: 6, up: 7, blink: 8, ko: 9, upWalkA: 10, upPass: 11, upWalkB: 12 };

/** fase de piernas de un fotograma (los de cargar reutilizan el ciclo de paso) */
const legPhase = (f: number) => (f >= 10 ? [1, 2, 3][f - 10] : f);
const armsUpFrame = (f: number) => f === 7 || f >= 10;
export const CHAR_SIZE = 32;

interface Ctx {
  R: Raster; ox: number; oy: number; L: CharLook; f: number;
  skin: Ramp; top: Ramp; pants: Ramp; boots: Ramp; hair: Ramp; hat: Ramp; glove: Ramp;
}

const WHITE = '#f8f8ff';

function boot(c: Ctx, x: number, y: number, dark = 0) {
  const { R } = c;
  R.blob(x, y - 1, 3.3, 2.2, c.boots, { bias: 0.05 - dark });
  R.rect(Math.round(x - 3), Math.round(y + 0.5), 7, 1, c.boots[0]);
}

function eyes(c: Ctx, x0: number, x1: number, eT: number, single = false) {
  const { R, f, L } = c;
  const eye = L.eye ?? '#1b1428';
  const draw = (x: number, pupilDx: number) => {
    if (f === 8) { R.rect(x, eT + 1, 2, 1, c.skin[1]); return; }
    if (f === 9) {
      R.p(x - 1, eT, '#2a1020'); R.p(x + 1, eT, '#2a1020'); R.p(x, eT + 1, '#2a1020'); R.p(x - 1, eT + 2, '#2a1020'); R.p(x + 1, eT + 2, '#2a1020');
      return;
    }
    if (L.alien) {
      R.blob(x + 0.8, eT + 1.4, 2.2, 2.7, RAMPS.dark);
      R.p(x, eT, '#ffffff');
      return;
    }
    R.rect(x, eT, 2, 3, WHITE);
    R.rect(x + pupilDx, eT + 1, 1, 2, eye);
  };
  draw(x0, 1);
  if (!single) draw(x1, 0);
}

function glassesFront(c: Ctx, hy: number, eT: number) {
  const { R, L, ox } = c;
  if (!L.glasses) return;
  if (L.glassesOn === 'forehead') {
    R.rect(ox + 10, hy - 4, 12, 2, L.glasses);
    R.p(ox + 11, hy - 4, '#ffffff'); R.p(ox + 18, hy - 4, '#ffffff');
    return;
  }
  const dark = L.glasses === '#14101c';
  for (const x of [ox + 11, ox + 18]) {
    R.rect(x, eT - 1, 4, 1, L.glasses); R.rect(x, eT + 3, 4, 1, L.glasses);
    R.rect(x, eT, 1, 3, L.glasses); R.rect(x + 3, eT, 1, 3, L.glasses);
    for (let j = 0; j < 3; j++) for (let i = 1; i < 3; i++) R.blend(x + i, eT + j, dark ? '#14101c' : L.glasses, dark ? 0.85 : 0.35);
    if (dark) R.p(x + 1, eT, '#8a8ab8');
  }
  R.rect(ox + 15, eT, 3, 1, L.glasses);
}

/** Pelo o tocado visto de frente (dir 0) o de espaldas (dir 1). */
function headwear(c: Ctx, dir: 0 | 1, hy: number) {
  const { R, L, ox, oy } = c;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const clipTop: [number, number] = [oy, Y(hy - 1)];
  const hairCap = () => {
    if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
    else {
      R.blob(X(16), Y(hy - 2.5), 7.3, 5.2, c.hair, { clipY: clipTop });
      for (const x of [10, 11, 12, 14, 15, 17, 18, 20, 21]) R.set(X(x), Y(hy - 1), col(c.hair[2]));
      for (const x of [10, 12, 20, 21]) R.set(X(x), Y(hy), col(c.hair[1]));
      R.rect(X(9), Y(hy - 1), 2, 4, c.hair[2]); R.rect(X(21), Y(hy - 1), 2, 4, c.hair[2]);
    }
  };
  switch (L.hat) {
    case 'cap':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      R.blob(X(16), Y(hy - 3), 7.4, 4.8, c.hat, { clipY: [oy, Y(hy - 2)] });
      R.rect(X(9), Y(hy - 2), 14, 1, c.hat[2]);
      if (dir === 0) {
        R.shadeRect(X(7), Y(hy - 1), 18, 2, c.hat, (u, v) => 0.46 - v * 0.26 + (u < 0.2 ? 0.1 : 0), 1);
        R.rect(X(14), Y(hy - 6), 4, 2, L.emblem ?? c.hat[6]);
        R.p(X(14), Y(hy - 6), '#ffffff');
        R.rect(X(9), Y(hy + 1), 1, 3, c.hair[2]); R.rect(X(22), Y(hy + 1), 1, 3, c.hair[2]);
      } else R.rect(X(13), Y(hy - 1), 6, 1, c.hat[1]);
      break;
    case 'captain':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      R.shadeRect(X(8), Y(hy - 7), 16, 5, RAMPS.white, (u) => 0.92 - u * 0.35, 2);
      R.rect(X(8), Y(hy - 2), 16, 2, '#1f2a5a');
      if (dir === 0) {
        R.shadeRect(X(8), Y(hy), 16, 2, RAMPS.dark, (u, v) => 0.7 - v * 0.4 - u * 0.2);
        R.rect(X(14), Y(hy - 6), 4, 3, '#ffd23f'); R.p(X(14), Y(hy - 6), '#fff6c0');
        R.rect(X(9), Y(hy + 2), 1, 3, c.hair[3]); R.rect(X(22), Y(hy + 2), 1, 3, c.hair[3]);
      }
      break;
    case 'chef':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      R.blob(X(11.5), Y(hy - 5), 4.6, 3.6, RAMPS.white);
      R.blob(X(20.5), Y(hy - 5), 4.6, 3.6, RAMPS.white);
      R.blob(X(16), Y(hy - 6.2), 5.2, 4.2, RAMPS.white, { spec: true });
      R.shadeRect(X(9), Y(hy - 3), 14, 3, RAMPS.white, (u, v) => 0.78 - u * 0.3 - v * 0.15);
      break;
    case 'hardhat':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      R.blob(X(16), Y(hy - 2.5), 8, 5.6, c.hat, { clipY: [oy, Y(hy - 1)], spec: true });
      R.shadeRect(X(6), Y(hy - 1), 20, 2, c.hat, (u, v) => 0.56 - v * 0.3 - u * 0.15, 1);
      R.rect(X(16), Y(hy - 7), 1, 5, c.hat[5]);
      break;
    case 'helmet':
      R.blob(X(16), Y(hy - 1.5), 8.1, 7.1, c.hat, { clipY: [oy, Y(hy + 1)], spec: true });
      if (dir === 0) {
        R.shadeRect(X(9), Y(hy), 14, 2, RAMPS.cyan, (u) => 0.9 - u * 0.45);
        R.rect(X(9), Y(hy + 2), 1, 3, '#2a2a1a'); R.rect(X(22), Y(hy + 2), 1, 3, '#2a2a1a');
      } else R.rect(X(11), Y(hy + 1), 10, 1, c.hat[1]);
      break;
    case 'sunhat':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      else hairCap();
      R.blob(X(16), Y(hy - 2), 11.5, 2.8, c.hat);
      R.blob(X(16), Y(hy - 4.5), 6.2, 3.7, c.hat, { clipY: [oy, Y(hy - 2)] });
      R.rect(X(10), Y(hy - 3), 12, 1, '#e84a7a');
      break;
    case 'medic':
      hairCap();
      R.shadeRect(X(10), Y(hy - 7), 12, 4, RAMPS.white, (u) => 0.88 - u * 0.3, 1);
      R.rect(X(15), Y(hy - 7), 2, 4, '#e83a4a'); R.rect(X(14), Y(hy - 6), 4, 2, '#e83a4a');
      break;
    case 'beanie':
      if (dir === 1) R.blob(X(16), Y(hy), 6.9, 6.7, c.hair, { clipY: [oy, Y(hy + 4)] });
      R.blob(X(16), Y(hy - 2.5), 7.7, 5.4, c.hat, { clipY: [oy, Y(hy - 1)] });
      R.shadeRect(X(8), Y(hy - 2), 16, 2, c.hat, (u) => 0.5 - u * 0.25);
      for (let x = 9; x < 24; x += 2) R.p(X(x), Y(hy - 2), c.hat[1]);
      R.blob(X(16), Y(hy - 7.5), 2.1, 2.1, c.hat, { spec: true });
      break;
    case 'alien':
      R.line(X(13), Y(hy - 5), X(11), Y(1), c.skin[2]);
      R.line(X(19), Y(hy - 5), X(21), Y(1), c.skin[2]);
      R.blob(X(11), Y(1.5), 1.7, 1.7, RAMPS.yellow, { spec: true });
      R.blob(X(21), Y(1.5), 1.7, 1.7, RAMPS.yellow, { spec: true });
      break;
    case 'bald':
      R.rect(X(13), Y(hy - 5), 3, 1, c.skin[5]);
      break;
    case 'bun':
      hairCap();
      R.blob(X(16), Y(hy - 7), 3.4, 2.6, c.hair, { spec: true });
      break;
    case 'slick':
      hairCap();
      if (dir === 0) R.rect(X(13), Y(hy - 6), 1, 4, c.hair[4]);
      break;
    case 'long':
      hairCap();
      R.shadeRect(X(8), Y(hy - 1), 3, 10, c.hair, (u, v) => 0.6 - v * 0.3);
      R.shadeRect(X(21), Y(hy - 1), 3, 10, c.hair, (u, v) => 0.45 - v * 0.3);
      break;
    default:
      hairCap();
  }
}

function headwearSide(c: Ctx, hy: number) {
  const { R, L, ox, oy } = c;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const hairSide = () => {
    R.blob(X(15.5), Y(hy - 2.5), 7, 5.2, c.hair, { clipY: [oy, Y(hy - 1)] });
    R.shadeRect(X(10), Y(hy - 2), 4, 6, c.hair, (u, v) => 0.6 - v * 0.3, 1);
    R.rect(X(15), Y(hy), 2, 3, c.hair[2]);
  };
  switch (L.hat) {
    case 'cap':
      R.shadeRect(X(10), Y(hy - 1), 4, 5, c.hair, (u, v) => 0.5 - v * 0.2, 1);
      R.blob(X(15.5), Y(hy - 3), 7.2, 4.7, c.hat, { clipY: [oy, Y(hy - 2)] });
      R.rect(X(9), Y(hy - 2), 14, 1, c.hat[2]);
      R.shadeRect(X(17), Y(hy - 1), 10, 2, c.hat, (u, v) => 0.5 - v * 0.3, 1);
      R.rect(X(17), Y(hy - 6), 3, 2, L.emblem ?? c.hat[6]);
      break;
    case 'captain':
      R.shadeRect(X(9), Y(hy - 7), 15, 5, RAMPS.white, (u) => 0.9 - u * 0.35, 2);
      R.rect(X(9), Y(hy - 2), 15, 2, '#1f2a5a');
      R.shadeRect(X(18), Y(hy), 8, 2, RAMPS.dark, (u, v) => 0.6 - v * 0.4);
      R.rect(X(20), Y(hy - 6), 3, 3, '#ffd23f');
      break;
    case 'chef':
      R.blob(X(13), Y(hy - 5), 4.6, 3.6, RAMPS.white);
      R.blob(X(18), Y(hy - 6), 5, 4, RAMPS.white, { spec: true });
      R.shadeRect(X(10), Y(hy - 3), 13, 3, RAMPS.white, (u) => 0.75 - u * 0.3);
      break;
    case 'hardhat':
      R.blob(X(15.5), Y(hy - 2.5), 7.8, 5.6, c.hat, { clipY: [oy, Y(hy - 1)], spec: true });
      R.shadeRect(X(7), Y(hy - 1), 21, 2, c.hat, (u, v) => 0.55 - v * 0.3, 1);
      break;
    case 'helmet':
      R.blob(X(15.5), Y(hy - 1.5), 7.9, 7.1, c.hat, { clipY: [oy, Y(hy + 1)], spec: true });
      R.shadeRect(X(18), Y(hy), 6, 2, RAMPS.cyan, (u) => 0.9 - u * 0.4);
      break;
    case 'sunhat':
      hairSide();
      R.blob(X(16), Y(hy - 2), 11.5, 2.6, c.hat);
      R.blob(X(15.5), Y(hy - 4.5), 6, 3.6, c.hat, { clipY: [oy, Y(hy - 2)] });
      R.rect(X(10), Y(hy - 3), 12, 1, '#e84a7a');
      break;
    case 'medic':
      hairSide();
      R.shadeRect(X(10), Y(hy - 7), 12, 4, RAMPS.white, (u) => 0.88 - u * 0.3, 1);
      R.rect(X(15), Y(hy - 7), 2, 4, '#e83a4a'); R.rect(X(14), Y(hy - 6), 4, 2, '#e83a4a');
      break;
    case 'beanie':
      R.blob(X(15.5), Y(hy - 2.5), 7.6, 5.4, c.hat, { clipY: [oy, Y(hy - 1)] });
      R.shadeRect(X(8), Y(hy - 2), 16, 2, c.hat, (u) => 0.5 - u * 0.25);
      R.blob(X(14), Y(hy - 7.5), 2, 2, c.hat, { spec: true });
      break;
    case 'alien':
      R.line(X(18), Y(hy - 5), X(20), Y(1), c.skin[2]);
      R.blob(X(20), Y(1.5), 1.7, 1.7, RAMPS.yellow, { spec: true });
      break;
    case 'bald':
      R.rect(X(15), Y(hy - 5), 3, 1, c.skin[5]);
      break;
    case 'bun':
      hairSide();
      R.blob(X(11), Y(hy - 4), 3, 2.6, c.hair, { spec: true });
      break;
    case 'long':
      hairSide();
      R.shadeRect(X(10), Y(hy), 4, 9, c.hair, (u, v) => 0.5 - v * 0.3);
      break;
    default:
      hairSide();
  }
  if (L.glasses) {
    const eT = Math.round(hy);
    if (L.glassesOn === 'forehead') R.rect(X(17), Y(hy - 4), 6, 2, L.glasses);
    else { R.rect(X(18), Y(eT - 1), 5, 1, L.glasses); R.rect(X(18), Y(eT + 3), 5, 1, L.glasses); R.rect(X(22), Y(eT), 1, 3, L.glasses); for (let j = 0; j < 3; j++) R.blend(X(19), Y(eT + j), L.glasses, 0.5); }
  }
}

function torsoDetails(c: Ctx, x0: number, w: number, ty: number, torsoH: number, side: boolean) {
  const { R, L, ox, oy } = c;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  if (L.armor) {
    const ar = rampOf(L.armor, 6);
    R.shadeRect(X(x0 + 1), Y(ty + 1), w - 2, 7, ar, (u, v) => 0.8 - u * 0.5 - v * 0.2, 2);
    if (!side) { R.blob(X(x0), Y(ty + 1), 2.6, 2, ar, { spec: true }); R.blob(X(x0 + w - 1), Y(ty + 1), 2.6, 2, ar); }
  }
  if (L.coat && !side) {
    for (let j = ty + 8; j < ty + torsoH; j++) R.set(X(16), Y(j), col(c.top[1]));
    R.line(X(13), Y(ty), X(15), Y(ty + 4), c.top[2]);
    R.line(X(19), Y(ty), X(17), Y(ty + 4), c.top[2]);
  }
  if (L.zip && !side) {
    for (let j = ty + 1; j < ty + 9; j++) R.set(X(16), Y(j), col(c.top[2]));
    R.p(X(16), Y(ty + 2), '#c8d0e8');
  }
  if (L.collar && !side) { R.rect(X(13), Y(ty), 6, 1, L.collar); R.rect(X(14), Y(ty + 1), 4, 1, L.collar); }
  if (L.stripe) {
    const sr = rampOf(L.stripe, 4, 0.4);
    R.shadeRect(X(x0), Y(ty + 4), w, 2, sr, (u) => 0.95 - u * 0.55, 0, 0.5);
    R.p(X(x0 + 1), Y(ty + 4), '#ffffff');
  }
  if (L.belt) {
    R.rect(X(x0), Y(ty + 9), w, 2, L.belt);
    R.rect(X(x0), Y(ty + 9), w, 1, rampOf(L.belt, 4)[2]);
    if (!side) { R.rect(X(15), Y(ty + 9), 2, 2, '#e8c860'); R.p(X(15), Y(ty + 9), '#fff4b0'); }
    else R.rect(X(x0 + w - 3), Y(ty + 9), 2, 2, '#a88a3a');
  }
  if (L.badge && !side) { R.rect(X(11), Y(ty + 2), 2, 2, L.badge); R.p(X(11), Y(ty + 2), '#ffffff'); }
  if (!side && !L.coat && !L.armor) {
    R.rect(X(18), Y(ty + 6), 3, 1, c.top[2]);
  }
}

function drawHuman(c: Ctx, dir: 0 | 1 | 2) {
  const { R, L, ox, oy, f } = c;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const lf0 = legPhase(f);
  const walkA = lf0 === 1, walkB = lf0 === 3, pass = lf0 === 2 || lf0 === 4;
  const act = f === 5 || f === 6;
  const up = armsUpFrame(f);
  const bob = pass ? -1 : 0;
  const ty = 12 + bob;
  const torsoH = L.coat ? 15 : 12;
  const hy = 7.5 + bob + (L.alien ? 0.5 : 0);
  const headR = L.alien ? 7.3 : 6.6;

  if (dir === 2) {
    // ── lateral (mirando a la derecha) ──
    const hip = ty + 10;
    let ff = 17.5, bf = 14.5, fy = 29, by = 29;
    if (walkA) { ff = 21; bf = 11; }
    else if (walkB) { ff = 12; bf = 20.5; fy = 28; }
    else if (pass) { ff = 16.5; bf = 15.5; by = 27; }
    // brazo trasero
    const bs = { x: 15, y: ty + 2.5 };
    let bh = { x: 15, y: ty + 10 };
    if (up) bh = { x: 14, y: 3 + bob };
    else if (walkA) bh = { x: 12.5, y: ty + 10 };
    else if (walkB) bh = { x: 19, y: ty + 9 };
    else if (act) bh = { x: 22, y: ty + 7 + (f === 6 ? 1 : 0) };
    R.capsule(X(bs.x), Y(bs.y), X(bh.x), Y(bh.y), 1.9, c.top, -0.18);
    R.blob(X(bh.x), Y(bh.y + 1), 1.9, 1.9, c.glove, { bias: -0.15 });
    // piernas
    R.capsule(X(15.5), Y(hip), X(bf), Y(by - 2), 2.2, c.pants, -0.16);
    boot(c, X(bf + 1), Y(by), 0.15);
    R.capsule(X(16.5), Y(hip), X(ff), Y(fy - 2), 2.3, c.pants);
    boot(c, X(ff + 1), Y(fy));
    // torso
    R.shadeRect(X(11), Y(ty), 11, torsoH, c.top, (u, v) => 0.78 - u * 0.36 - v * 0.15 + (v < 0.12 ? 0.1 : 0), 3);
    torsoDetails(c, 11, 11, ty, torsoH, true);
    // cabeza
    R.rect(X(15), Y(ty - 1), 3, 2, c.skin[2]);
    R.blob(X(16.5), Y(hy), headR - 0.4, headR - 0.2, c.skin, { bias: 0.04 });
    R.blob(X(23), Y(hy + 1.5), 1.3, 1.1, c.skin);
    R.blob(X(13.6), Y(hy + 1), 1.4, 1.9, c.skin, { bias: -0.08 });
    const eT = Math.round(hy);
    if (!L.alien) R.rect(X(18), Y(eT - 2), 3, 1, c.hair[1]);
    eyes(c, X(19), 0, Y(eT), true);
    if (f === 9) R.line(X(19), Y(eT + 4), X(21), Y(eT + 5), c.skin[0]);
    else R.rect(X(20), Y(eT + 4), 2, 1, c.skin[1]);
    headwearSide(c, hy);
    // brazo delantero
    const fs = { x: 16, y: ty + 2.5 };
    let fh = { x: 16.5, y: ty + 10 };
    if (up) fh = { x: 17.5, y: 3 + bob };
    else if (walkA) fh = { x: 19.5, y: ty + 9 };
    else if (walkB) fh = { x: 13, y: ty + 10 };
    else if (act) fh = { x: 25, y: ty + 6 + (f === 6 ? 1.5 : 0) };
    R.capsule(X(fs.x), Y(fs.y), X(fh.x), Y(fh.y), 2, c.top, 0.02);
    R.blob(X(fh.x), Y(fh.y + 1), 2, 2, c.glove);
    return;
  }

  // ── frente (0) y espalda (1) ──
  const hip = ty + 10;
  const lf = 29 + (walkA ? 1 : walkB ? -2 : 0);
  const rf = 29 + (walkB ? 1 : walkA ? -2 : 0);
  const ls = { x: 8.8, y: ty + 2.5 }, rs = { x: 23.2, y: ty + 2.5 };
  let lh = { x: 8.3, y: ty + 10 }, rh = { x: 23.7, y: ty + 10 };
  if (up) { lh = { x: 7.5, y: 3 + bob }; rh = { x: 24.5, y: 3 + bob }; }
  else if (walkA) { lh = { x: 8.6, y: ty + 9 }; rh = { x: 23.4, y: ty + 11 }; }
  else if (walkB) { lh = { x: 8.6, y: ty + 11 }; rh = { x: 23.4, y: ty + 9 }; }
  else if (act) { const k = f === 6 ? 1 : 0; lh = { x: 12.5, y: ty + 11 + k }; rh = { x: 19.5, y: ty + 11 + k }; }
  const arms = (bias: number) => {
    R.capsule(X(ls.x), Y(ls.y), X(lh.x), Y(lh.y), 2, c.top, 0.04 + bias);
    R.capsule(X(rs.x), Y(rs.y), X(rh.x), Y(rh.y), 2, c.top, -0.1 + bias);
    R.blob(X(lh.x), Y(lh.y + 1), 2, 2, c.glove, { bias });
    R.blob(X(rh.x), Y(rh.y + 1), 2, 2, c.glove, { bias: bias - 0.06 });
  };
  if (dir === 1 && act) arms(-0.15);
  R.capsule(X(13), Y(hip), X(13), Y(lf - 2), 2.3, c.pants);
  R.capsule(X(19), Y(hip), X(19), Y(rf - 2), 2.3, c.pants, -0.06);
  boot(c, X(13), Y(lf));
  boot(c, X(19), Y(rf), 0.05);
  R.shadeRect(X(9), Y(ty), 14, torsoH, c.top, (u, v) => 0.8 - u * 0.5 - v * 0.15 + (v < 0.12 ? 0.12 : 0), 3);
  if (dir === 0) torsoDetails(c, 9, 14, ty, torsoH, false);
  else {
    if (L.stripe) R.shadeRect(X(9), Y(ty + 4), 14, 2, rampOf(L.stripe, 4, 0.4), (u) => 0.9 - u * 0.55, 0, 0.5);
    if (L.belt) R.rect(X(9), Y(ty + 9), 14, 2, L.belt);
    R.rect(X(16), Y(ty + 1), 1, 7, c.top[2]);
  }
  if (!(dir === 1 && act)) arms(0);
  // cabeza
  R.rect(X(14), Y(ty - 1), 4, 2, c.skin[2]);
  R.blob(X(16), Y(hy), headR, headR - 0.1, c.skin, { bias: 0.04 });
  if (dir === 0) {
    R.blob(X(9.4), Y(hy + 1), 1.4, 1.9, c.skin, { bias: -0.05 });
    R.blob(X(22.6), Y(hy + 1), 1.4, 1.9, c.skin, { bias: -0.12 });
    const eT = Math.round(hy);
    if (!L.alien) { R.rect(X(11), Y(eT - 2), 3, 1, c.hair[1]); R.rect(X(19), Y(eT - 2), 3, 1, c.hair[1]); }
    eyes(c, X(12), X(19), Y(eT));
    R.set(X(16), Y(eT + 2), col(c.skin[2]));
    if (f === 9) { R.p(X(15), Y(eT + 4), c.skin[0]); R.p(X(16), Y(eT + 5), c.skin[0]); R.p(X(17), Y(eT + 4), c.skin[0]); }
    else R.rect(X(15), Y(eT + 4), 3, 1, c.skin[1]);
    R.blend(X(11), Y(eT + 3), '#ff6a7a', 0.3); R.blend(X(21), Y(eT + 3), '#ff6a7a', 0.3);
    headwear(c, 0, hy);
    glassesFront(c, Y(hy), Y(eT));
  } else {
    headwear(c, 1, hy);
  }
}

function drawRobot(c: Ctx, dir: 0 | 1 | 2) {
  const { R, ox, oy, f, L } = c;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const lp = legPhase(f);
  const upR = armsUpFrame(f);
  const bob = lp === 2 || lp === 4 ? -1 : 0;
  const eye = L.eye ?? '#4ff0ff';
  // orugas
  R.shadeRect(X(8), Y(25), 16, 5, RAMPS.dark, (u, v) => 0.6 - v * 0.4, 2);
  for (let x = 9 + ((lp & 1) ? 1 : 0); x < 23; x += 3) { R.p(X(x), Y(26), '#4a5070'); R.p(X(x), Y(28), '#2a3048'); }
  // cuerpo
  const bx = dir === 2 ? 10 : 9, bw = dir === 2 ? 12 : 14;
  R.box3d(X(bx), Y(12 + bob), bw, 4, 10, RAMPS.steel, RAMPS.metal, { r: 2 });
  if (dir !== 1) {
    R.blob(X(dir === 2 ? 19 : 16), Y(20 + bob), 2, 2, RAMPS.cyan, { spec: true });
    R.rect(X(bx + 2), Y(23 + bob), bw - 4, 1, '#ffd23f');
  } else R.rect(X(13), Y(18 + bob), 6, 3, '#2a3048');
  // brazos
  const hands: [number, number][] = f === 5 || f === 6 ? [[11, 24], [21, 24]] : upR ? [[8, 4], [24, 4]] : [[7, 21 + (f === 1 ? -1 : f === 3 ? 1 : 0)], [25, 21 + (f === 3 ? -1 : f === 1 ? 1 : 0)]];
  if (dir === 2) {
    const h = f === 5 || f === 6 ? [26, 18] : upR ? [17, 4] : [17 + (f === 1 ? 2 : f === 3 ? -2 : 0), 22];
    R.capsule(X(16), Y(15 + bob), X(h[0]), Y(h[1]), 1.4, RAMPS.metal);
    R.blob(X(h[0]), Y(h[1] + 1), 1.8, 1.6, RAMPS.steel);
  } else {
    R.capsule(X(9), Y(15 + bob), X(hands[0][0]), Y(hands[0][1]), 1.4, RAMPS.metal);
    R.capsule(X(23), Y(15 + bob), X(hands[1][0]), Y(hands[1][1]), 1.4, RAMPS.metal, -0.1);
    R.blob(X(hands[0][0]), Y(hands[0][1] + 1), 1.8, 1.6, RAMPS.steel);
    R.blob(X(hands[1][0]), Y(hands[1][1] + 1), 1.8, 1.6, RAMPS.steel);
  }
  // cabeza
  R.blob(X(16), Y(7 + bob), 6.6, 5.6, RAMPS.steel, { spec: true });
  R.line(X(16), Y(1 + bob), X(16), Y(2 + bob), '#3a4260');
  R.blob(X(16), Y(1 + bob), 1.3, 1.3, RAMPS.red, { spec: true });
  if (dir === 0) {
    R.shadeRect(X(10), Y(6 + bob), 12, 4, RAMPS.dark, (u, v) => 0.5 - v * 0.3, 1);
    if (f === 8) { R.rect(X(12), Y(8 + bob), 2, 1, eye); R.rect(X(18), Y(8 + bob), 2, 1, eye); }
    else if (f === 9) { R.p(X(12), Y(7 + bob), '#ff4d5a'); R.p(X(13), Y(8 + bob), '#ff4d5a'); R.p(X(18), Y(7 + bob), '#ff4d5a'); R.p(X(19), Y(8 + bob), '#ff4d5a'); }
    else { R.rect(X(12), Y(7 + bob), 2, 2, eye); R.rect(X(18), Y(7 + bob), 2, 2, eye); R.p(X(12), Y(7 + bob), '#ffffff'); }
  } else if (dir === 2) {
    R.shadeRect(X(16), Y(6 + bob), 7, 4, RAMPS.dark, (u, v) => 0.5 - v * 0.3, 1);
    if (f !== 8) R.rect(X(19), Y(7 + bob), 2, 2, f === 9 ? '#ff4d5a' : eye);
  } else {
    for (let x = 12; x < 21; x += 2) R.p(X(x), Y(8 + bob), '#3a4260');
  }
}

export function drawCharacter(R: Raster, ox: number, oy: number, L: CharLook, dir: 0 | 1 | 2, f: number) {
  const c: Ctx = {
    R, ox, oy, L, f,
    skin: rampOf(L.skin, 6, 0.5),
    top: rampOf(L.top, 7),
    pants: rampOf(L.pants, 6),
    boots: rampOf(L.boots, 5, 0.55),
    hair: rampOf(L.hair, 6),
    hat: rampOf(L.hatC ?? L.hair, 7),
    glove: L.gloves ? rampOf(L.gloves, 5) : rampOf(L.skin, 6, 0.5),
  };
  if (L.robot) drawRobot(c, dir);
  else drawHuman(c, dir);
}

/** Hoja de sprites completa de un personaje: 3 direcciones × CHAR_FRAMES fotogramas de 32×32 (diseño). */
export function characterSheet(L: CharLook): HTMLCanvasElement {
  const n = 3 * CHAR_FRAMES;
  const sheet = new Raster(CHAR_SIZE * n, CHAR_SIZE);
  for (let d = 0; d < 3; d++) {
    for (let f = 0; f < CHAR_FRAMES; f++) {
      const r = new Raster(CHAR_SIZE, CHAR_SIZE);
      drawCharacter(r, 0, 0, L, d as 0 | 1 | 2, f);
      r.grade({ sat: 0.86, dark: 0.93, grime: 0.12, tint: '#10141c', seed: d * 10 + f });
      r.rimLight('#f4f8ff', 0.2);
      r.outline('#05040a', 0.72);
      sheet.blit(r, (d * CHAR_FRAMES + f) * CHAR_SIZE, 0);
    }
  }
  return sheet.toCanvas();
}
