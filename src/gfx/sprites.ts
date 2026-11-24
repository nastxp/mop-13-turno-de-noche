import Phaser from 'phaser';
import { makeCanvas, outlineRegion, Pen, hash2, rgba } from './pixel';
import { col, rampOf, RAMPS, Raster } from './raster';
import { characterSheet, CHAR_FRAMES } from './characters';
import { bodyBagCanvas, ghostCanvas, glorpSheet, insectSheet, invaderSheet, moldQueenSheet, ratSheet, slugSheet, vacuumBotSheet, vacuumKingSheet } from './creatures';
import { propSheetHD } from './props';
import { ARCHETYPES, playerLook, type CharLook } from '../data/crew';
import { PROP_DEFS, type PropKind } from '../data/rooms';
import { RESIDUES, RESIDUE_IDS, type ResidueDef } from '../data/residues';
import type { EmoteId } from '../types';

/** Densidad de las texturas: cada píxel de mundo son 2·Raster.SCALE texeles (4 con SCALE = 2). */
export const HD = 1 / (2 * Raster.SCALE);
export { CHAR_FRAMES };

const OL = '#141022';
export const EMOTES: EmoteId[] = ['alert', 'question', 'anger', 'sweat', 'disgust', 'heart', 'zzz', 'note', 'fear', 'dizzy', 'sparkle', 'dots'];
export const ICONS: Record<string, string> = {};

type Tex = Phaser.Textures.TextureManager;

/** Hoja horizontal: fw/fh en unidades de diseño; el lienzo puede estar a mayor densidad. */
function addSheet(tex: Tex, key: string, canvas: HTMLCanvasElement, fw: number, fh: number, count: number) {
  if (tex.exists(key)) tex.remove(key);
  const k = canvas.height / fh;
  const t = tex.addCanvas(key, canvas)!;
  for (let i = 0; i < count; i++) t.add(i, 0, Math.round(i * fw * k), 0, Math.round(fw * k), Math.round(fh * k));
  return t;
}

function single(tex: Tex, key: string, r: Raster, outline = true) {
  if (outline) r.outline('#08060f', 0.7);
  addSheet(tex, key, r.toCanvas(), r.w, r.h, 1);
}

// ───────────────────────────── PERSONAJES ─────────────────────────────

export function genPlayerTexture(tex: Tex, look: CharLook) {
  addSheet(tex, 'char_player', characterSheet(look), 32, 32, 3 * CHAR_FRAMES);
}

function genCharacters(tex: Tex, playerLookNow: CharLook) {
  genPlayerTexture(tex, playerLookNow);
  for (const a of Object.values(ARCHETYPES)) addSheet(tex, `char_${a.id}`, characterSheet(a.look), 32, 32, 3 * CHAR_FRAMES);
}

function genCreatures(tex: Tex) {
  addSheet(tex, 'glorp', glorpSheet(false), 32, 32, 6);
  addSheet(tex, 'glorp_big', glorpSheet(true), 32, 32, 6);
  addSheet(tex, 'invasor', invaderSheet(), 32, 32, 6);
  addSheet(tex, 'babosa', slugSheet(), 40, 24, 4);
  addSheet(tex, 'rata', ratSheet(), 24, 24, 4);
  addSheet(tex, 'insecto', insectSheet(), 16, 16, 2);
  addSheet(tex, 'rogue', vacuumBotSheet(true), 24, 20, 2);
  addSheet(tex, 'cleanbot', vacuumBotSheet(false), 24, 20, 2);
  addSheet(tex, 'reina', moldQueenSheet(), 64, 64, 3);
  addSheet(tex, 'rey', vacuumKingSheet(), 56, 48, 3);
  addSheet(tex, 'fx_bodybag', bodyBagCanvas(), 32, 18, 1);
  addSheet(tex, 'fx_ghost', ghostCanvas(), 20, 24, 1);
}

// ───────────────────────────── EMOTICONOS ─────────────────────────────

function genEmotes(tex: Tex) {
  const S = 22;
  const out = new Raster(S * EMOTES.length, S);
  EMOTES.forEach((e, i) => {
    const r = new Raster(S, S);
    r.shadeRect(1, 0, 20, 17, RAMPS.white, (u, v) => 0.95 - v * 0.15, 5);
    r.rect(9, 17, 4, 1, '#eaf0f8'); r.rect(10, 18, 2, 2, '#eaf0f8');
    switch (e) {
      case 'alert': r.shadeRect(9, 2, 4, 8, RAMPS.red, (u) => 0.8 - u * 0.3, 1); r.blob(11, 13, 2, 2, RAMPS.red, { spec: true }); break;
      case 'question':
        r.rect(7, 3, 8, 2, '#2a7ae8'); r.rect(13, 5, 2, 3, '#2a7ae8'); r.rect(10, 8, 4, 2, '#2a7ae8'); r.rect(10, 10, 2, 2, '#2a7ae8'); r.blob(11, 14, 1.5, 1.5, RAMPS.cyan); break;
      case 'anger':
        for (const [x, y, dx, dy] of [[5, 3, 1, 1], [16, 3, -1, 1], [5, 14, 1, -1], [16, 14, -1, -1]]) r.line(x, y, x + dx * 3, y + dy * 3, '#e8203a');
        r.blob(11, 9, 2, 2, RAMPS.red); break;
      case 'sweat': r.blob(11, 10, 4, 5, RAMPS.glass, { spec: true }); r.line(11, 3, 11, 5, '#56b0c4'); break;
      case 'disgust':
        r.blob(11, 9, 6, 6, rampOf('#8fdc4a', 6), { spec: true });
        r.rect(8, 7, 2, 2, '#14101c'); r.rect(13, 7, 2, 2, '#14101c');
        for (let x = 7; x < 16; x++) r.p(x, 12 + ((x >> 1) & 1), '#14101c'); break;
      case 'heart': r.blob(8, 7, 3.5, 3.5, rampOf('#ff5d9e', 6)); r.blob(14, 7, 3.5, 3.5, rampOf('#ff5d9e', 6)); for (let j = 0; j < 6; j++) r.rect(5 + j, 8 + j, 12 - j * 2, 1, '#ff5d9e'); r.p(7, 6, '#ffffff'); break;
      case 'zzz': for (const [x, y, s] of [[4, 3, 6], [12, 8, 5]]) { r.rect(x, y, s, 1, '#2a7ae8'); r.line(x + s - 1, y, x, y + s - 1, '#2a7ae8'); r.rect(x, y + s - 1, s, 1, '#2a7ae8'); } break;
      case 'note': r.rect(12, 3, 2, 9, '#2a2440'); r.rect(14, 3, 3, 2, '#2a2440'); r.blob(10, 12, 3, 2.2, RAMPS.dark); break;
      case 'fear': r.blob(11, 8, 6, 5.5, RAMPS.white); r.rect(7, 7, 3, 3, '#14101c'); r.rect(12, 7, 3, 3, '#14101c'); r.rect(8, 13, 6, 2, '#eaf0f8'); r.p(9, 14, '#14101c'); r.p(11, 14, '#14101c'); r.p(13, 14, '#14101c'); break;
      case 'dizzy': for (const [x, y] of [[6, 5], [15, 7], [9, 12]]) { r.rect(x - 2, y, 5, 1, '#f8b828'); r.rect(x, y - 2, 1, 5, '#f8b828'); r.p(x, y, '#ffffff'); } break;
      case 'sparkle': r.rect(10, 2, 2, 13, '#f8b828'); r.rect(4, 8, 14, 2, '#f8b828'); r.blob(11, 9, 2, 2, RAMPS.yellow); r.p(17, 3, '#4ff0ff'); r.p(4, 14, '#4ff0ff'); break;
      case 'dots': for (const x of [6, 11, 16]) r.blob(x, 9, 1.6, 1.6, RAMPS.dark); break;
    }
    r.outline('#08060f', 0.8);
    out.blit(r, i * S, 0);
  });
  addSheet(tex, 'emote', out.toCanvas(), S, S, EMOTES.length);
}

// ───────────────────────────── HERRAMIENTAS ─────────────────────────────

function mopSheet(key: string, tex: Tex, golden: boolean) {
  const out = new Raster(64, 32);
  for (let f = 0; f < 2; f++) {
    const r = new Raster(32, 32);
    r.capsule(16, 0, 16, 21, 1.5, golden ? RAMPS.yellow : RAMPS.wood);
    r.shadeRect(13, 20, 7, 3, RAMPS.steel, (u) => 0.8 - u * 0.4, 1);
    const strand = golden ? RAMPS.cyan : f === 0 ? RAMPS.white : rampOf('#a89a6a', 6);
    for (let i = 0; i < 10; i++) r.capsule(11 + i, 23, 9.5 + i * 1.3, 29 + (i % 3), 0.9, strand, (i % 2) * -0.1);
    r.outline('#08060f', 0.7);
    out.blit(r, f * 32, 0);
  }
  addSheet(tex, key, out.toCanvas(), 32, 32, 2);
}

function genTools(tex: Tex) {
  mopSheet('tool_fregona', tex, false);
  mopSheet('tool_superfregona', tex, true);
  { const r = new Raster(28, 18); r.capsule(5, 9, 17, 9, 5, rampOf('#c8283a', 7)); r.rect(8, 6, 6, 6, '#f2f0ff'); r.rect(9, 8, 4, 2, '#e83a4a'); r.capsule(18, 9, 25, 9, 2, RAMPS.steel); r.rect(5, 14, 4, 4, '#2a2440'); single(tex, 'tool_espuma', r); }
  { const r = new Raster(32, 20); r.shadeRect(2, 3, 15, 13, RAMPS.yellow, (u, v) => 0.85 - u * 0.3 - v * 0.3, 3); r.shadeRect(5, 6, 7, 5, RAMPS.dark, () => 0.3, 1); r.capsule(17, 10, 24, 10, 2.4, RAMPS.metal); r.shadeRect(24, 6, 6, 9, RAMPS.metal, (u) => 0.6 - u * 0.3, 1); single(tex, 'tool_aspiradora', r); }
  { const r = new Raster(22, 22); r.shadeRect(6, 8, 10, 13, rampOf('#3ac8c0', 7), (u, v) => 0.8 - u * 0.4 - v * 0.2, 3); r.rect(8, 12, 6, 5, '#f2f0ff'); r.rect(10, 13, 2, 3, '#2aa850'); r.rect(9, 14, 4, 1, '#2aa850'); r.shadeRect(7, 3, 9, 5, RAMPS.white, (u) => 0.8 - u * 0.3, 1); r.capsule(15, 4, 20, 4, 1.2, RAMPS.white); r.rect(5, 6, 2, 6, '#c8d0e0'); single(tex, 'tool_desinfectante', r); }
  { const r = new Raster(30, 18); r.shadeRect(3, 5, 16, 9, RAMPS.white, (u, v) => 0.85 - u * 0.3 - v * 0.3, 3); r.cylinder(9, 2, 4, 1.4, 6, RAMPS.cyan); r.capsule(19, 9, 27, 9, 2, RAMPS.steel); r.blob(27, 9, 2, 2, RAMPS.cyan, { spec: true }); r.rect(6, 13, 4, 5, '#2a2440'); single(tex, 'tool_crio', r); }
  { const r = new Raster(20, 16); r.box3d(2, 3, 16, 5, 7, RAMPS.steel, RAMPS.metal); for (let x = 4; x < 16; x += 3) r.rect(x, 2, 2, 2, '#c8d0e0'); r.rect(8, 8, 4, 2, '#e83a4a'); single(tex, 'tool_trampa', r); }
  { const r = new Raster(24, 20); r.cylinder(12, 7, 9, 3.5, 5, RAMPS.metal, RAMPS.steel); r.blob(12, 6, 2, 1.4, RAMPS.cyan); r.rect(4, 12, 16, 1, '#ffd23f'); single(tex, 'tool_robot', r); }
}

// ───────────────────────────── MOBILIARIO ─────────────────────────────

function propVariants(kind: PropKind) {
  return kind === 'bed' ? 4 : kind === 'locker' ? 3 : kind === 'barrel' ? 2 : 1;
}

function genProps(tex: Tex) {
  for (const kind of Object.keys(PROP_DEFS) as PropKind[]) {
    const variants = propVariants(kind);
    for (let v = 0; v < variants; v++) {
      const s = propSheetHD(kind, v);
      addSheet(tex, variants > 1 ? `prop_${kind}_${v}` : `prop_${kind}`, s.canvas, s.fw, s.fh, s.frames);
    }
  }
}

export function propTextureKey(kind: PropKind, variant: number) {
  const variants = propVariants(kind);
  return variants > 1 ? `prop_${kind}_${variant % variants}` : `prop_${kind}`;
}

// ───────────────────── ELEMENTOS DE PARED Y PUERTAS ─────────────────────

function genFixtures(tex: Tex) {
  {
    const out = new Raster(128, 32);
    for (let f = 0; f < 4; f++) {
      const r = new Raster(32, 32);
      const grav = f >= 2, broken = f % 2 === 1;
      const body = grav ? rampOf('#4a3a6a', 7) : RAMPS.metal;
      r.box3d(4, 3, 24, 3, 24, RAMPS.steel, body, { r: 2 });
      if (!broken) {
        r.blob(10, 11, 2.2, 2.2, RAMPS.green, { spec: true });
        r.blob(17, 11, 2.2, 2.2, grav ? RAMPS.purple : RAMPS.yellow, { spec: true });
        r.screen(8, 16, 16, 7, RAMPS.cyan, f);
      } else {
        r.shadeRect(7, 7, 18, 19, RAMPS.dark, () => 0.15, 1);
        r.line(9, 9, 16, 24, '#e83a4a'); r.line(22, 9, 14, 22, '#ffd23f'); r.line(10, 12, 24, 17, '#4ff0ff');
        r.shadeRect(0, 6, 6, 20, body, (u) => 0.6 - u * 0.3, 1);
      }
      r.rect(14, 1, 4, 2, '#ffd23f');
      r.grade({ sat: 0.6, dark: 0.82, grime: 0.35, seed: f + 3 });
      r.rimLight('#cfe8ee', 0.2);
      r.outline('#020304', 0.65);
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'fix_panel', out.toCanvas(), 32, 32, 4);
  }
  {
    const out = new Raster(128, 32);
    for (let f = 0; f < 4; f++) {
      const r = new Raster(32, 32);
      r.capsule(0, 16, 32, 16, 6, RAMPS.steel);
      r.capsule(16, 4, 16, 28, 4.5, rampOf('#c27a3a', 7));
      r.blob(16, 6, 6, 3, rampOf('#c8283a', 7), { spec: true });
      if (f === 1) for (const [x, y] of [[8, 24], [9, 28], [23, 25], [21, 30]]) r.blob(x, y, 1.3, 1.6, RAMPS.glass, { spec: true });
      if (f === 2) { r.shadeRect(4, 10, 8, 12, rampOf('#d8d6c0', 5), (u) => 0.8 - u * 0.3, 1); r.rect(4, 14, 8, 1, '#a8a690'); }
      if (f === 3) { for (let x = 2; x < 30; x++) for (let y = 9; y < 24; y++) if (hash2(x, y, 4) < 0.5) r.blend(x, y, '#d8f4ff', 0.75); r.line(6, 12, 10, 20, '#ffffff'); }
      r.grade({ sat: 0.6, dark: 0.82, grime: 0.35, seed: f + 5 });
      r.rimLight('#cfe8ee', 0.2);
      r.outline('#020304', 0.6);
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'fix_pipe', out.toCanvas(), 32, 32, 4);
  }
  {
    const out = new Raster(96, 32);
    for (let f = 0; f < 3; f++) {
      const r = new Raster(32, 32);
      if (f < 2) {
        r.blob(16, 16, 12, 10, rampOf('#5a6590', 5));
        r.blob(16, 16, 10, 8, ['#020108', '#05040c']);
        for (let i = 0; i < 5; i++) r.p(9 + ((i * 7 + f * 3) % 15), 11 + ((i * 5 + f) % 10), i % 2 ? '#9fb4ff' : '#ffffff');
        for (const [x0, y0, x1, y1] of [[2, 4, 8, 9], [30, 5, 24, 10], [3, 28, 9, 22], [29, 27, 23, 21]]) r.line(x0, y0, x1, y1, '#8a94b8');
      } else {
        r.blob(16, 16, 14, 12, RAMPS.white, { spec: true });
        r.blob(8, 20, 5, 4, RAMPS.white); r.blob(24, 10, 5, 4, RAMPS.white, { spec: true });
      }
      r.grade({ sat: 0.6, dark: 0.82, grime: 0.35, seed: f + 5 });
      r.rimLight('#cfe8ee', 0.2);
      r.outline('#020304', 0.6);
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'fix_breach', out.toCanvas(), 32, 32, 3);
  }
  {
    // puerta horizontal: losa de cromo negro acanalada con canto de vértebras
    const out = new Raster(128, 32);
    for (let f = 0; f < 4; f++) {
      const r = new Raster(32, 32);
      const w = [32, 22, 12, 4][f];
      r.shadeRect(0, 0, w, 32, RAMPS.chrome, (u, v) => 0.5 - v * 0.2 - u * 0.08 + (Math.abs(((v * 32) % 4) - 2) < 0.6 ? 0.12 : 0));
      r.rect(0, 0, w, 1, '#9db4c6'); r.rect(0, 29, w, 3, '#05070a');
      if (w > 8) {
        for (let y = 3; y < 28; y += 4) r.blob(w - 3, y + 1.5, 2, 1.6, RAMPS.bone, { spec: true });
        r.forN(3, 12, Math.max(2, w - 10), 6, (X, Y, u) => (Math.floor((u * (w - 10) + Y * 0.5) / 2.5) % 2 ? col('#d08a1a') : col('#0a0806')));
        r.blob(5, 5, 1.2, 1.2, RAMPS.acid, { spec: true });
      }
      r.grade({ sat: 0.7, dark: 0.85, grime: 0.3, seed: f + 11 });
      r.rimLight('#cfe8ee', 0.25);
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'door_h', out.toCanvas(), 32, 32, 4);
  }
  {
    const out = new Raster(128, 32);
    for (let f = 0; f < 4; f++) {
      const r = new Raster(32, 32);
      const h = [32, 22, 12, 4][f];
      r.shadeRect(10, 0, 12, h, RAMPS.chrome, (u, v) => 0.6 - u * 0.35 + (Math.abs(((v * h) % 4) - 2) < 0.6 ? 0.1 : 0));
      r.rect(10, 0, 0.5, h, '#9db4c6');
      if (h > 8) for (let x = 11; x < 21; x += 3) r.blob(x + 1, h - 3, 1.4, 1.2, RAMPS.bone, { spec: true });
      r.grade({ sat: 0.7, dark: 0.85, grime: 0.3, seed: f + 17 });
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'door_v', out.toCanvas(), 32, 32, 4);
  }
}

// ───────────────────────────── SUCIEDAD ─────────────────────────────

function toHex(c: number) {
  return '#' + (c & 255).toString(16).padStart(2, '0') + ((c >> 8) & 255).toString(16).padStart(2, '0') + ((c >> 16) & 255).toString(16).padStart(2, '0');
}

export function drawResidueHD(r: Raster, def: ResidueDef, v: number) {
  const S = 40;
  const rnd = (i: number) => hash2(i, v * 31 + def.id.length * 7, def.id.charCodeAt(0) + def.id.charCodeAt(1));
  const ramp = rampOf(def.colors[0], 6, 0.55);
  const mask = new Uint8Array(S * S);
  const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && mask[y * S + x] === 1;
  const blob = (n: number, spread: number, rmin: number, rmax: number) => {
    for (let i = 0; i < n; i++) {
      const cx = 20 + (rnd(i * 3) - 0.5) * spread, cy = 20 + (rnd(i * 3 + 1) - 0.5) * spread * 0.8;
      const rr = rmin + rnd(i * 3 + 2) * (rmax - rmin);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x - cx) ** 2 + ((y - cy) * 1.2) ** 2 <= rr * rr) mask[y * S + x] = 1;
    }
  };
  const liquid = (alpha = 1) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inM(x, y)) continue;
      let edge = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) if (!inM(x + dx, y + dy)) edge++;
      let val = 0.55 - (y / S) * 0.2 - (x / S) * 0.1;
      if (edge) val -= 0.25;
      if (!inM(x - 2, y - 2) && inM(x + 1, y + 1) && !edge) val += 0.35;
      const c = r.rc(ramp, val, x, y, 0.7);
      if (alpha < 1) r.blend(x, y, toHex(c), alpha);
      else r.set(x, y, c);
    }
    let k = 0;
    for (let y = 2; y < S && k < 3; y += 3) for (let x = 2; x < S && k < 3; x += 3) {
      if (inM(x, y) && inM(x + 3, y + 1) && !inM(x - 3, y - 3) && rnd(200 + x + y) < 0.6) { r.rect(x + 1, y + 1, 3, 1, def.colors[2]); r.p(x + 1, y + 2, def.colors[2]); k++; }
    }
    for (let i = 0; i < 5; i++) {
      const a = rnd(50 + i) * Math.PI * 2, d = 14 + rnd(60 + i) * 4;
      r.blob(20 + Math.cos(a) * d, 20 + Math.sin(a) * d * 0.8, 1.4, 1.2, ramp);
    }
  };
  switch (def.style) {
    case 'splat': blob(4 + v, 16, 4.5, 9); liquid(def.id === 'agua' || def.id === 'mucosidad' ? 0.82 : 1); break;
    case 'chunks': {
      blob(3 + v, 12, 4, 8); liquid();
      const extra = def.id === 'comida' ? ['#f5d27a', '#c94a3a', '#6fae3a', '#f2f0ff'] : def.id === 'restos' ? ['#d8a8ff', '#3a1a52', '#ff8ab0'] : [def.colors[2], def.colors[1], '#d8a040'];
      for (let i = 0; i < 9; i++) r.blob(10 + rnd(200 + i) * 20, 10 + rnd(220 + i) * 20, 1.4 + rnd(240 + i), 1.2, rampOf(extra[i % extra.length], 4), { spec: true });
      break;
    }
    case 'speckle': {
      for (let i = 0; i < 60; i++) {
        const a = rnd(i) * Math.PI * 2, d = Math.sqrt(rnd(i + 99)) * 15;
        const x = 20 + Math.cos(a) * d, y = 20 + Math.sin(a) * d * 0.8;
        if (i % 5 === 0) r.blob(x, y, 1.6, 1.3, ramp); else r.p(x, y, [def.colors[0], def.colors[1], def.colors[2]][i % 3]);
      }
      break;
    }
    case 'prints': {
      const prints = v === 2 ? [[8, 6], [18, 16], [26, 26]] : [[10, 8], [22, 20]];
      prints.forEach(([x, y], i) => {
        const ox = i % 2 ? 2 : 0;
        r.shadeRect(x + ox, y, 6, 7, ramp, (u, vv) => 0.5 - vv * 0.2, 2);
        r.shadeRect(x + ox, y + 8, 6, 4, ramp, () => 0.35, 1);
      });
      break;
    }
    case 'foam':
      for (let i = 0; i < 8 + v * 2; i++) r.blob(10 + rnd(i) * 20, 10 + rnd(i + 40) * 18, 2.5 + rnd(i + 80) * 4, 2.5 + rnd(i + 80) * 4, RAMPS.white, { spec: true });
      break;
    case 'smudge':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - 20, (y - 20) * 1.2) / 16;
        const n = rnd(x * 40 + y);
        if (d < 1 && n > d * 0.85) r.set(x, y, r.rc(ramp, 0.25 + (1 - d) * 0.35 + (n > 0.85 ? 0.3 : 0), x, y));
      }
      break;
    case 'confetti': {
      const cs = ['#ff5d9e', '#4ff0ff', '#ffd23f', '#5dff9b', '#b067ff', '#ff8a3d'];
      for (let i = 0; i < 26; i++) {
        const a = rnd(i) * Math.PI * 2, d = Math.sqrt(rnd(i + 50)) * 16;
        r.rect(Math.round(20 + Math.cos(a) * d), Math.round(20 + Math.sin(a) * d * 0.8), i % 3 ? 2 : 3, i % 2 ? 1 : 2, cs[i % cs.length]);
      }
      break;
    }
    case 'trash':
      r.blob(10, 14, 4.5, 4, RAMPS.white, { spec: true }); r.line(8, 13, 12, 15, '#8f8ca0');
      r.cylinder(26 - v * 2, 18, 3, 1.2, 6, RAMPS.red); r.p(26 - v * 2, 18, '#d6def0');
      r.capsule(14, 28, 22, 27, 1.6, RAMPS.yellow); r.capsule(22, 27, 24, 24, 1.4, RAMPS.yellow);
      r.shadeRect(28, 8, 5, 4, RAMPS.white, () => 0.7, 1);
      if (v) r.shadeRect(6, 26, 6, 4, RAMPS.wood, () => 0.6, 1);
      break;
    case 'fuzz':
      blob(4 + v, 18, 5, 9);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (!inM(x, y)) continue;
        const n = rnd(x * 41 + y * 7);
        r.set(x, y, r.rc(ramp, 0.25 + n * 0.55, x, y, 1));
        if (n > 0.93) r.p(x, y, def.colors[2]);
      }
      for (let i = 0; i < 6; i++) r.blob(8 + rnd(i + 300) * 24, 8 + rnd(i + 330) * 24, 1.2, 1.2, RAMPS.dark);
      break;
    case 'eggs':
      for (let i = 0; i < 3 + v; i++) {
        const x = 12 + rnd(i) * 16, y = 14 + rnd(i + 9) * 12;
        r.blob(x, y, 4.2, 5.5, ramp, { spec: true });
        r.line(x - 2, y - 2, x + 1, y + 3, def.colors[1]);
      }
      break;
    case 'ice':
      blob(4 + v, 16, 6, 10);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inM(x, y)) r.blend(x, y, x + y < 32 ? '#e8f8ff' : '#a8d8f8', 0.85);
      for (let i = 0; i < 3; i++) r.line(8 + i * 8, 26 - i * 2, 14 + i * 8, 14 - i * 2, '#ffffff');
      r.line(12, 20, 28, 24, '#7ab8e0');
      break;
    case 'debris':
      for (let i = 0; i < 7 + v; i++) {
        const x = 8 + rnd(i) * 24, y = 8 + rnd(i + 20) * 24;
        r.shadeRect(Math.round(x), Math.round(y), 2 + Math.floor(rnd(i + 40) * 4), 2 + Math.floor(rnd(i + 60) * 3), RAMPS.steel, (u) => 0.75 - u * 0.4);
      }
      r.blob(20, 20, 2, 2, RAMPS.metal, { spec: true });
      break;
    case 'wires': {
      const cs = ['#e8a020', '#e83a4a', '#3a7ae8', '#5dff9b'];
      for (let i = 0; i < 4; i++) {
        let px = 8 + rnd(i) * 8, py = 10 + rnd(i + 5) * 20;
        for (let k = 0; k < 6; k++) { const nx = px + 4, ny = py + (rnd(i * 10 + k) - 0.5) * 8; r.line(px, py, nx, ny, cs[i]); px = nx; py = ny; }
        r.p(px, py, '#ffd27a');
      }
      break;
    }
    case 'swirl':
      for (let a = 0; a < 18; a += 0.12) {
        const rr = a * 0.85;
        r.blob(20 + Math.cos(a) * rr, 20 + Math.sin(a) * rr * 0.8, 1.6, 1.6, ramp);
      }
      r.blob(20, 20, 2.4, 2.4, rampOf('#c080ff', 5), { spec: true });
      break;
  }
}

function genDirt(tex: Tex) {
  for (const id of RESIDUE_IDS) {
    const def = RESIDUES[id];
    const out = new Raster(120, 40);
    for (let v = 0; v < 3; v++) {
      const r = new Raster(40, 40);
      drawResidueHD(r, def, v);
      out.blit(r, v * 40, 0);
    }
    addSheet(tex, `dirt_${id}`, out.toCanvas(), 40, 40, 3);
  }
}

// ───────────────────────────── EFECTOS ─────────────────────────────

function radial(size: number, stops: [number, string][]) {
  const { c, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, cc] of stops) g.addColorStop(o, cc);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function genFx(tex: Tex) {
  const put = (key: string, c: HTMLCanvasElement) => { if (tex.exists(key)) tex.remove(key); tex.addCanvas(key, c); };
  put('fx_light', radial(128, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]));
  put('fx_glow', radial(64, [[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
  put('fx_smoke', radial(16, [[0, 'rgba(200,200,215,0.85)'], [0.6, 'rgba(150,150,170,0.5)'], [1, 'rgba(120,120,140,0)']]));
  put('fx_mist', radial(16, [[0, 'rgba(200,255,240,0.9)'], [0.6, 'rgba(120,230,210,0.45)'], [1, 'rgba(90,200,190,0)']]));
  const R = (w: number, h: number, draw: (r: Raster) => void, key: string, outline = true) => { const r = new Raster(w, h); draw(r); single(tex, key, r, outline); };
  R(4, 4, (r) => r.rect(0, 0, 4, 4, '#ffffff'), 'fx_px', false);
  R(6, 6, (r) => { r.rect(2, 0, 2, 6, '#fff6a0'); r.rect(0, 2, 6, 2, '#fff6a0'); r.rect(2, 2, 2, 2, '#ffffff'); }, 'fx_spark', false);
  R(12, 12, (r) => r.blob(6, 6, 5, 5, RAMPS.white, { spec: true }), 'fx_foam', false);
  R(10, 10, (r) => { r.rect(4, 0, 2, 10, '#ffffff'); r.rect(0, 4, 10, 2, '#ffffff'); r.p(2, 2, '#ffffff'); r.p(7, 7, '#ffffff'); r.p(7, 2, '#ffffff'); r.p(2, 7, '#ffffff'); }, 'fx_star', false);
  R(4, 4, (r) => r.rect(0, 0, 4, 4, '#ffffff'), 'fx_drop', false);
  R(48, 32, (r) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) { const nx = (x - 24) / 22, ny = (y - 16) / 13; if (nx * nx + ny * ny < 1) r.blend(x, y, '#c8ecff', 0.26); }
    r.rect(14, 10, 7, 1, '#ffffff'); r.rect(28, 19, 5, 1, '#ffffff');
  }, 'fx_wet', false);
  R(20, 22, (r) => { r.blob(10, 14, 8, 7, rampOf('#2a4a2a', 6), { spec: true }); r.shadeRect(7, 4, 6, 6, rampOf('#2a4a2a', 6), () => 0.5, 2); r.rect(8, 2, 4, 3, '#ffd23f'); }, 'fx_bag');
  R(10, 12, (r) => { r.cylinder(5, 3, 3.5, 1.3, 7, RAMPS.white); r.rect(3, 3, 4, 1, '#6b3f1f'); r.capsule(9, 6, 9, 8, 1, RAMPS.white); }, 'fx_cup');
  R(14, 16, (r) => { r.capsule(4, 6, 4, 2, 1.2, RAMPS.steel); r.capsule(10, 6, 10, 2, 1.2, RAMPS.steel); r.line(4, 1, 10, 1, '#c8d0e0'); r.shadeRect(1, 6, 12, 9, RAMPS.red, (u, v) => 0.8 - u * 0.3 - v * 0.2, 2); r.rect(6, 9, 2, 3, '#14101c'); }, 'fx_lock');
  R(52, 44, (r) => { r.shadeRect(0, 0, 52, 44, RAMPS.yellow, (u, v) => 0.75 - u * 0.2 - v * 0.2, 2); r.clear(6, 6, 40, 32); for (let x = 3; x < 49; x += 5) r.p(x, 2, '#fffbe0'); }, 'fx_frame', false);
  R(32, 32, (r) => { r.blob(16, 23, 13, 9, RAMPS.white, { spec: true }); r.blob(9, 14, 5, 5, RAMPS.white); r.blob(22, 12, 5, 5, RAMPS.white, { spec: true }); }, 'fx_foamcoat');
  R(32, 32, (r) => { for (let y = 6; y < 31; y++) for (let x = 3; x < 29; x++) r.blend(x, y, '#c8f0ff', 0.6); r.line(6, 26, 14, 8, '#ffffff'); r.line(18, 28, 24, 14, '#ffffff'); r.rect(3, 6, 26, 1, '#ffffff'); }, 'fx_icecoat', false);
  R(16, 24, (r) => { r.line(10, 0, 4, 12, '#fff6a0'); r.line(4, 12, 12, 12, '#fff6a0'); r.line(12, 12, 6, 23, '#fff6a0'); r.line(11, 0, 5, 12, '#ffffff'); }, 'fx_zap');
  R(18, 18, (r) => { const c = '#ffffff'; r.rect(0, 0, 5, 2, c); r.rect(0, 0, 2, 5, c); r.rect(13, 0, 5, 2, c); r.rect(16, 0, 2, 5, c); r.rect(0, 16, 5, 2, c); r.rect(0, 13, 2, 5, c); r.rect(13, 16, 5, 2, c); r.rect(16, 13, 2, 5, c); }, 'fx_reticle', false);
  R(14, 4, (r) => { r.rect(0, 1, 14, 2, '#5af0ff'); r.rect(2, 1, 10, 2, '#e8ffff'); }, 'fx_bolt', false);
  R(12, 12, (r) => { r.rect(5, 0, 2, 12, '#ffe24a'); r.rect(0, 5, 12, 2, '#ffe24a'); r.blob(6, 6, 3, 3, RAMPS.yellow); }, 'fx_flash', false);
  R(14, 12, (r) => { r.shadeRect(2, 0, 6, 9, RAMPS.white, (u) => 0.85 - u * 0.3, 1); r.shadeRect(2, 7, 11, 5, RAMPS.white, (u) => 0.8 - u * 0.3, 2); for (let y = 1; y < 9; y += 3) r.rect(2, y, 6, 1, '#e83a4a'); }, 'fx_sock');
  R(12, 14, (r) => { r.shadeRect(1, 1, 10, 12, rampOf('#e9e4cf', 5), (u, v) => 0.8 - v * 0.2, 1); for (let y = 4; y < 12; y += 2) r.rect(3, y, 6, 1, '#7a6a4a'); }, 'fx_note');
  {
    const out = new Raster(64, 24);
    for (let f = 0; f < 2; f++) {
      const r = new Raster(32, 24);
      r.box3d(4, 8, 24, 5, 8, RAMPS.steel, RAMPS.metal, { r: 2 });
      if (f === 0) { for (let x = 6; x < 26; x += 3) r.rect(x, 4, 2, 5, '#c8d0e0'); r.rect(13, 13, 6, 2, '#e83a4a'); }
      else { for (let x = 6; x < 26; x += 3) r.rect(x, 7, 2, 2, '#c8d0e0'); r.rect(13, 13, 6, 2, '#5dff9b'); }
      r.outline('#08060f', 0.7);
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'fx_trap', out.toCanvas(), 32, 24, 2);
  }
  {
    const out = new Raster(128, 40);
    const layers: [string, number, number][] = [['#a0141a', 11, 34], ['#e8401a', 9, 28], ['#ff8a2a', 7, 21], ['#ffd24a', 4.5, 14], ['#fff6c8', 2.4, 7]];
    for (let f = 0; f < 4; f++) {
      const r = new Raster(32, 40);
      layers.forEach(([c, rx, hgt], li) => {
        for (let y = 0; y < 40; y++) {
          const t = (39 - y) / hgt;
          if (t > 1.12) continue;
          const wob = Math.sin(y * 0.45 + f * 1.6 + li * 0.8) * 1.8 * Math.min(1, t * 1.5);
          const w = rx * (t < 0.3 ? 0.72 + t : Math.max(0, 1.28 - t));
          if (w <= 0.3) continue;
          r.rect(Math.round(16 - w + wob), y, Math.max(1, Math.round(w * 2)), 1, c);
        }
      });
      for (let i = 0; i < 3; i++) r.p(8 + ((i * 7 + f * 5) % 16), 4 + ((i * 5 + f * 3) % 12), '#ffd24a');
      out.blit(r, f * 32, 0);
    }
    addSheet(tex, 'fx_fire', out.toCanvas(), 32, 40, 4);
  }
}

// ───────────────────────────── ICONOS (interfaz) ─────────────────────────────

function icon(name: string, draw: (P: Pen) => void, outline = true) {
  const { c, ctx } = makeCanvas(16, 16);
  draw(new Pen(ctx));
  if (outline) outlineRegion(ctx, 0, 0, 16, 16, OL);
  ICONS[name] = c.toDataURL();
}

function iconFromTexture(name: string, canvas: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, size = 32) {
  // coordenadas de diseño → texeles nativos; el icono se genera a doble tamaño para pantallas densas
  const S = Raster.SCALE;
  sx *= S; sy *= S; sw *= S; sh *= S; size *= 2;
  const { c, ctx } = makeCanvas(size, size);
  const k = Math.min(size / sw, size / sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, sx, sy, sw, sh, (size - sw * k) / 2, (size - sh * k) / 2, sw * k, sh * k);
  ICONS[name] = c.toDataURL();
}

function genIcons(tex: Tex) {
  icon('fire', (P) => { P.ellipse(8, 11, 5, 4, '#ff4d2a'); P.r(6, 3, 3, 6, '#ff4d2a'); P.r(9, 5, 2, 4, '#ff4d2a'); P.ellipse(8, 11, 3, 3, '#ffb12a'); P.r(7, 7, 2, 3, '#ffb12a'); P.ellipse(8, 12, 1, 1, '#fff2a0'); });
  icon('breach', (P) => { P.ellipse(8, 8, 5, 5, '#04030a'); P.p(7, 7, '#fff'); P.p(9, 9, '#9fb4ff'); P.line(1, 2, 4, 5, '#bfe6ff'); P.line(14, 3, 11, 6, '#bfe6ff'); P.line(2, 14, 5, 11, '#bfe6ff'); });
  icon('panel', (P) => { P.r(3, 2, 10, 12, '#5a6280'); P.line(9, 3, 6, 8, '#ffd23f'); P.line(6, 8, 10, 8, '#ffd23f'); P.line(10, 8, 7, 13, '#ffd23f'); });
  icon('gravity', (P) => { P.ellipse(8, 9, 6, 4, '#b067ff'); P.ellipse(8, 9, 3, 2, '#2a1a40'); P.r(7, 1, 2, 4, '#f2f0ff'); P.p(6, 2, '#f2f0ff'); P.p(9, 2, '#f2f0ff'); });
  icon('pipe', (P) => { P.r(1, 5, 14, 4, '#9aa4c0'); P.r(1, 5, 14, 1, '#d6def0'); P.r(6, 9, 2, 2, '#4aa3e8'); P.r(6, 12, 2, 2, '#4aa3e8'); });
  icon('toilet', (P) => { P.r(4, 2, 8, 5, '#e8eef8'); P.ellipse(8, 10, 5, 4, '#e8eef8'); P.ellipse(8, 9, 3, 2, '#6d6a2a'); });
  icon('creature', (P) => { P.ellipse(8, 11, 6, 4, '#5df2a6'); P.r(4, 2, 3, 3, '#fff'); P.r(9, 2, 3, 3, '#fff'); P.p(5, 3, '#141022'); P.p(10, 3, '#141022'); P.line(5, 5, 6, 7, '#1fae6c'); P.line(10, 5, 9, 7, '#1fae6c'); P.r(7, 12, 3, 1, '#0b3d2a'); });
  icon('invasor', (P) => { P.ellipse(7, 9, 6, 4, '#5a2a7a'); P.ellipse(12, 7, 3, 3, '#5a2a7a'); P.r(12, 6, 2, 1, '#ffe24a'); P.line(2, 13, 3, 15, '#5a2a7a'); P.line(10, 13, 11, 15, '#5a2a7a'); P.line(4, 5, 5, 2, '#d8a8ff'); P.line(8, 5, 9, 2, '#d8a8ff'); });
  icon('reactor', (P) => { P.disc(8, 8, 6, '#ffd23f'); P.disc(8, 8, 2, '#141022'); P.r(7, 2, 2, 4, '#141022'); P.line(3, 11, 5, 9, '#141022'); P.line(13, 11, 11, 9, '#141022'); });
  icon('rescue', (P) => { P.r(2, 2, 12, 12, '#f2f0ff'); P.r(7, 3, 2, 10, '#ff3d4a'); P.r(3, 7, 10, 2, '#ff3d4a'); });
  icon('corpse', (P) => { P.r(2, 6, 12, 6, '#3a4a7a'); P.ellipse(4, 9, 2, 3, '#3a4a7a'); P.r(8, 6, 1, 6, '#ffd23f'); P.p(12, 3, '#c8d4ee'); P.p(13, 2, '#c8d4ee'); });
  icon('inspector', (P) => { P.r(3, 2, 10, 13, '#c8a070'); P.r(4, 4, 8, 10, '#f2f0ff'); P.r(6, 1, 4, 3, '#7a86ad'); for (let y = 6; y < 13; y += 2) P.r(5, y, 6, 1, '#7a86ad'); P.r(5, 6, 1, 1, '#ff3d4a'); });
  icon('power', (P) => { P.r(2, 4, 11, 8, '#d6def0'); P.r(13, 6, 2, 4, '#d6def0'); P.r(3, 5, 3, 6, '#ff3d4a'); });
  icon('storm', (P) => { P.ellipse(8, 6, 6, 4, '#7a6ab0'); P.line(8, 9, 6, 13, '#ffd23f'); P.line(6, 13, 9, 13, '#ffd23f'); P.line(9, 13, 7, 15, '#ffd23f'); });
  icon('party', (P) => { P.line(3, 13, 9, 5, '#ff5d9e'); P.line(4, 13, 10, 6, '#ff5d9e'); P.p(11, 3, '#ffd23f'); P.p(13, 6, '#4ff0ff'); P.p(9, 2, '#5dff9b'); P.p(14, 2, '#b067ff'); });
  icon('art', (P) => { P.r(1, 2, 14, 12, '#ffd23f'); P.r(3, 4, 10, 8, '#3a2a50'); P.ellipse(8, 8, 3, 2, '#5df2a6'); });
  icon('bin', (P) => { P.r(4, 3, 8, 11, '#6f7a9a'); P.r(3, 2, 10, 2, '#a9b4d4'); P.r(5, 0, 6, 2, '#f2f0ff'); });
  icon('virus', (P) => { P.disc(8, 8, 4, '#8fdc4a'); for (const [x, y] of [[8, 2], [8, 14], [2, 8], [14, 8], [4, 4], [12, 12], [12, 4], [4, 12]]) P.p(x, y, '#5a9a2a'); P.p(7, 7, '#e8ffd0'); });
  icon('moho', (P) => { P.ellipse(8, 10, 6, 4, '#6a8a4a'); P.ellipse(5, 7, 3, 2, '#a8406a'); P.ellipse(11, 6, 3, 2, '#a8406a'); P.p(5, 6, '#fff'); P.p(11, 5, '#fff'); });
  icon('rata', (P) => { P.ellipse(7, 10, 5, 3, '#7a7a8e'); P.ellipse(12, 8, 3, 3, '#7a7a8e'); P.disc(11, 4, 1, '#e88aa0'); P.p(13, 7, '#ff3040'); P.line(2, 10, 1, 6, '#c88a9a'); });
  icon('insecto', (P) => { P.ellipse(8, 9, 3, 4, '#7a3a2a'); P.line(4, 7, 1, 6, '#2a1a14'); P.line(12, 7, 15, 6, '#2a1a14'); P.line(4, 11, 1, 12, '#2a1a14'); P.line(12, 11, 15, 12, '#2a1a14'); P.p(7, 5, '#e8f040'); P.p(9, 5, '#e8f040'); });
  icon('egg', (P) => { P.ellipse(6, 9, 3, 4, '#c8a0e8'); P.ellipse(11, 10, 3, 4, '#c8a0e8'); P.p(5, 7, '#fff'); P.p(10, 8, '#fff'); });
  icon('boss', (P) => { P.disc(8, 8, 6, '#5a2a7a'); P.r(4, 6, 3, 2, '#ffe24a'); P.r(9, 6, 3, 2, '#ffe24a'); P.r(5, 11, 6, 2, '#e83a4a'); P.p(6, 11, '#fff'); P.p(9, 11, '#fff'); });
  icon('alarm', (P) => { P.disc(8, 9, 5, '#e8c020'); P.r(7, 5, 2, 5, '#141022'); P.p(7, 12, '#141022'); P.p(8, 12, '#141022'); });
  icon('dark', (P) => { P.disc(8, 8, 6, '#2a2440'); P.ctx.clearRect(9, 2, 6, 6); P.p(12, 10, '#ffd23f'); });
  icon('task', (P) => { P.r(2, 2, 12, 12, '#f2f0ff'); P.r(3, 3, 10, 10, '#2a3048'); P.line(5, 8, 7, 10, '#5dff9b'); P.line(7, 10, 11, 5, '#5dff9b'); });
  icon('coin', (P) => { P.disc(8, 8, 6, '#ffd23f'); P.disc(8, 8, 4, '#c98f12'); P.r(7, 5, 3, 1, '#ffd23f'); P.r(6, 6, 1, 4, '#ffd23f'); P.r(7, 10, 3, 1, '#ffd23f'); });
  icon('secret', (P) => { P.r(3, 2, 10, 12, '#ffd23f'); P.r(4, 3, 8, 10, '#c98f12'); P.disc(8, 8, 2, '#fff6c8'); });
  icon('shield', (P) => { P.r(3, 2, 10, 7, '#4a6a44'); P.ellipse(8, 9, 5, 5, '#4a6a44'); P.r(7, 4, 2, 7, '#a8d890'); P.r(5, 6, 6, 2, '#a8d890'); });
  icon('cloro', (P) => {
    P.r(2, 4, 12, 10, '#9aa4c0'); P.r(2, 4, 12, 2, '#d6def0'); P.r(3, 7, 10, 4, '#141022'); P.r(4, 8, 3, 2, '#4ff0ff'); P.r(9, 8, 3, 2, '#4ff0ff');
    P.r(7, 1, 2, 3, '#7a86ad'); P.r(6, 0, 4, 1, '#ff4d5a'); P.r(5, 12, 6, 1, '#56618a');
  });
  const t = (key: string) => tex.get(key).getSourceImage() as HTMLCanvasElement;
  iconFromTexture('fregona', t('tool_fregona'), 0, 0, 32, 32);
  iconFromTexture('superfregona', t('tool_superfregona'), 0, 0, 32, 32);
  iconFromTexture('espuma', t('tool_espuma'), 0, 0, 28, 18);
  iconFromTexture('aspiradora', t('tool_aspiradora'), 0, 0, 32, 20);
  iconFromTexture('desinfectante', t('tool_desinfectante'), 0, 0, 22, 22);
  iconFromTexture('crio', t('tool_crio'), 0, 0, 30, 18);
  iconFromTexture('trampa', t('tool_trampa'), 0, 0, 20, 16);
  iconFromTexture('robot', t('tool_robot'), 0, 0, 24, 20);
  iconFromTexture('mop13', t('char_player'), 0, 0, 32, 18, 48);
}

export function refreshPlayerIcon(tex: Tex) {
  const c = tex.get('char_player').getSourceImage() as HTMLCanvasElement;
  iconFromTexture('mop13', c, 0, 0, 32, 18, 48);
}

// ───────────────────────────── ENTRADA ─────────────────────────────

export function generateAllTextures(scene: Phaser.Scene, look: CharLook = playerLook()) {
  const tex = scene.textures;
  genCharacters(tex, look);
  genCreatures(tex);
  genEmotes(tex);
  genTools(tex);
  genProps(tex);
  genFixtures(tex);
  genDirt(tex);
  genFx(tex);
  genIcons(tex);
}

/** Fotograma de personaje según dirección, modo y tiempo. */
export function charFrame(facing: 'down' | 'up' | 'left' | 'right', mode: 'idle' | 'walk' | 'act' | 'up' | 'upwalk' | 'ko', t: number, blink = false): number {
  const d = facing === 'down' ? 0 : facing === 'up' ? 1 : 2;
  let f = 0;
  if (mode === 'ko') return 9;
  if (mode === 'walk') f = [1, 2, 3, 4][Math.floor(t * 9) % 4];
  else if (mode === 'act') f = 5 + (Math.floor(t * 7) % 2);
  else if (mode === 'up') f = 7;
  else if (mode === 'upwalk') f = [10, 11, 12, 11][Math.floor(t * 9) % 4];
  else if (blink) f = 8;
  return d * CHAR_FRAMES + f;
}

export { rgba, col };
