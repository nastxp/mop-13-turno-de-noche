import { col, rampOf, RAMPS, Raster } from './raster';
import { PROP_DEFS, type PropKind } from '../data/rooms';
import { drawText } from './font';

/** Número de fotogramas de cada mueble (estados: parpadeo, roto, encendido…) */
export const PROP_FRAMES: Partial<Record<PropKind, number>> = {
  console: 2, holoTable: 2, gravityGen: 3, coffee: 2, counter: 2, toilet: 3, vent: 2, bin: 2,
  tank: 2, reactor: 3, reactorConsole: 2, medkit: 2, vending: 2, medPod: 2, medScanner: 2, plantBed: 2, secretLocker: 2,
};

const RED = rampOf('#c8283a', 7);
const WOOD_L = rampOf('#c8a070', 7);
const COPPER = rampOf('#c27a3a', 7);
const TERRA = rampOf('#b0603a', 6);

/** Adaptador para reutilizar la fuente 3x5 sobre un ráster */
const penOf = (r: Raster) => ({ p: (x: number, y: number, c: string) => r.p(x, y, c) }) as any;

function bolts(r: Raster, x: number, y: number, w: number, h: number) {
  for (const [bx, by] of [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) {
    r.p(bx, by, '#c8d0e8'); r.p(bx + 1, by + 1, '#262b42');
  }
}

function leaf(r: Raster, cx: number, cy: number, s: number) {
  r.blob(cx, cy, s, s * 0.7, RAMPS.leaf, { spec: true });
}

export function drawPropHD(kind: PropKind, f: number, r: Raster, W: number, H: number, variant: number) {
  const fy = PROP_DEFS[kind].up * 2;
  switch (kind) {
    case 'console': {
      r.box3d(2, fy + 4, W - 4, 10, 16, RAMPS.steel, RAMPS.metal, { r: 2 });
      r.blob(9, fy + 9, 2.2, 1.6, RAMPS.red, { spec: true });
      r.blob(15, fy + 9, 2.2, 1.6, RAMPS.yellow, { spec: true });
      r.blob(21, fy + 9, 2.2, 1.6, RAMPS.green, { spec: true });
      r.rect(30, fy + 8, 14, 2, '#1a1f30'); r.rect(30 + (f ? 8 : 3), fy + 7, 3, 4, '#c8d0e8');
      for (let x = 6; x < W - 6; x += 4) r.rect(x, fy + 20, 2, 6, '#2a3048');
      r.shadeRect(8, 0, W - 16, fy + 6, RAMPS.dark, (u, v) => 0.5 - v * 0.2, 2);
      r.screen(11, 3, W - 22, fy - 2, f ? RAMPS.green : RAMPS.cyan, f * 5 + variant);
      r.rect(W / 2 - 3, fy + 4, 6, 2, '#262b40');
      break;
    }
    case 'captainChair': {
      const red = RED;
      r.shadeRect(7, 1, 18, 26, red, (u, v) => 0.75 - u * 0.4 - v * 0.25, 4);
      r.shadeRect(10, 3, 12, 8, red, (u, v) => 0.9 - u * 0.3 - v * 0.2, 3);
      r.box3d(3, fy + 6, 26, 8, 10, red, rampOf('#7a1420', 6), { r: 3 });
      r.capsule(4, fy + 6, 4, fy + 14, 2, RAMPS.metal); r.capsule(28, fy + 6, 28, fy + 14, 2, RAMPS.metal);
      r.rect(15, fy + 24, 2, 6, '#3a4260');
      r.rect(9, fy + 29, 14, 2, '#2a3048');
      r.rect(14, 5, 4, 3, '#ffd23f');
      break;
    }
    case 'holoTable': {
      r.box3d(2, fy + 6, W - 4, 12, 14, RAMPS.steel, RAMPS.metal, { r: 4 });
      for (let x = 8; x < W - 8; x += 10) r.rect(x, fy + 21, 5, 2, f ? '#5ae8f0' : '#13889a');
      const cx = W / 2, cy = 12 + (f ? 1 : 0);
      for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 22; x <= cx + 22; x++) {
        const nx = (x - cx) / 22, ny = (y - cy) / 10;
        const d = nx * nx + ny * ny;
        if (d < 1) r.blend(x, y, '#4ff0ff', 0.12 + (d > 0.85 ? 0.35 : 0) + ((y & 1) ? 0 : 0.06));
      }
      r.blob(cx, cy, 6, 6, RAMPS.hologram, { spec: true });
      for (let i = 0; i < 3; i++) r.blend(cx - 14 + i * 12 + (f ? 2 : 0), cy + 5 - i * 3, '#ffffff', 0.9);
      r.line(cx - 22, cy, cx + 22, cy, '#7cf0f8');
      break;
    }
    case 'gravityGen': {
      r.box3d(2, fy + 22, W - 4, 12, 30, RAMPS.steel, RAMPS.metal, { r: 3 });
      r.blob(32, 26, 27, 19, rampOf('#3c1a66', 6));
      r.blob(32, 26, 19, 13, RAMPS.dark);
      const core = f === 2 ? rampOf('#3a3050', 5) : RAMPS.purple;
      r.blob(32, 26, 10, 7, core, { spec: f !== 2 });
      if (f !== 2) {
        for (let a = 0; a < 6; a++) {
          const ang = a + f * 0.5;
          r.blend(32 + Math.cos(ang) * 22, 26 + Math.sin(ang) * 15, '#ddc2ff', 0.9);
        }
      }
      r.blob(10, fy + 40, 3, 3, f === 2 ? RAMPS.red : RAMPS.green, { spec: true });
      r.blob(54, fy + 40, 3, 3, f === 2 ? RAMPS.red : RAMPS.green, { spec: true });
      bolts(r, 4, fy + 34, W - 8, 16);
      break;
    }
    case 'plant': {
      r.cylinder(16, fy + 12, 9, 3, 14, TERRA, rampOf('#5a2a1a', 5));
      r.capsule(16, fy + 10, 16, 14, 1.2, RAMPS.leaf);
      leaf(r, 10, 14, 6); leaf(r, 22, 13, 6); leaf(r, 16, 7, 7); leaf(r, 9, 22, 5); leaf(r, 23, 22, 5);
      break;
    }
    case 'coffee': {
      const body = rampOf(f ? '#4a3434' : '#3a3044', 7);
      r.shadeRect(4, 2, 24, H - 6, body, (u, v) => 0.7 - u * 0.4 - v * 0.2, 3);
      r.shadeRect(5, 3, 22, 6, body, (u) => 0.9 - u * 0.3, 2);
      r.screen(8, 11, 8, 5, f ? RAMPS.red : RAMPS.green, 2);
      r.blob(22, 13, 1.8, 1.8, f ? RAMPS.dark : RAMPS.red, { spec: true });
      r.shadeRect(8, 20, 16, 16, RAMPS.dark, (u, v) => 0.15 + v * 0.15, 2);
      if (!f) { r.cylinder(16, 28, 4, 1.5, 6, RAMPS.white); r.rect(13, 28, 6, 1, '#6b3f1f'); }
      else { r.line(9, 5, 14, 12, '#ffd23f'); r.line(14, 12, 11, 18, '#ffd23f'); r.rect(10, H - 8, 8, 2, '#6b3f1f'); }
      r.shadeRect(6, H - 10, 20, 4, RAMPS.steel, (u) => 0.7 - u * 0.3, 1);
      break;
    }
    case 'counter': {
      r.box3d(2, fy - 2, W - 4, 16, 18, RAMPS.steel, RAMPS.metal, { r: 2 });
      for (let i = 0; i < 3; i++) {
        const x = 14 + i * 36;
        r.blob(x, fy + 5, 7, 3.5, RAMPS.dark);
        r.blob(x, fy + 5, 4, 2, f ? RAMPS.orange : rampOf('#3a3a48', 4));
        if (f) for (let k = 0; k < 5; k++) r.blend(x - 4 + k * 2, fy + 2, '#ffd27a', 0.8);
      }
      r.cylinder(82, fy - 8, 9, 3, 10, RAMPS.steel);
      r.blob(46, fy + 3, 8, 3.5, RAMPS.dark, { spec: true });
      r.capsule(54, fy + 3, 62, fy + 1, 1.2, RAMPS.dark);
      for (let x = 8; x < W - 8; x += 12) r.rect(x, fy + 20, 8, 1, '#2a3048');
      break;
    }
    case 'table': {
      r.box3d(2, fy + 2, W - 4, 18, 6, WOOD_L, RAMPS.wood, { r: 3 });
      r.blob(14, fy + 10, 6, 3.6, RAMPS.white, { spec: true }); r.blob(14, fy + 10, 3, 1.8, RAMPS.orange);
      r.cylinder(46, fy + 6, 3, 1.2, 5, RAMPS.white); r.p(46, fy + 6, '#6b3f1f');
      r.rect(6, fy + 26, 3, 6, '#3a2010'); r.rect(W - 9, fy + 26, 3, 6, '#3a2010');
      break;
    }
    case 'toilet': {
      r.box3d(7, 2, 18, 5, 12, RAMPS.ceramic, RAMPS.ceramic, { r: 2 });
      r.blob(16, 4, 2, 1, RAMPS.steel, { spec: true });
      r.blob(16, fy + 12, 11, 9.5, RAMPS.ceramic, { spec: true });
      r.blob(16, fy + 11, 7.5, 5.5, f ? rampOf('#6d6a2a', 5) : RAMPS.glass, { spec: !f });
      if (f) { r.p(13, fy + 9, '#a8a85a'); r.p(19, fy + 12, '#3a3810'); r.p(10, 6, '#141022'); r.p(22, 4, '#141022'); r.p(24, 8, '#141022'); }
      if (f === 2) { r.blob(4, fy + 24, 4, 2.5, rampOf('#6d6a2a', 5)); r.blob(27, fy + 22, 4.5, 3, rampOf('#6d6a2a', 5)); }
      break;
    }
    case 'sink': {
      r.shadeRect(6, 0, 20, 14, RAMPS.glass, (u, v) => 0.75 - u * 0.4 - v * 0.2, 2);
      r.line(9, 2, 13, 8, '#e4fbff');
      r.box3d(3, fy + 2, 26, 10, 8, RAMPS.ceramic, RAMPS.ceramic, { r: 3 });
      r.blob(16, fy + 7, 8, 3.2, RAMPS.glass, { spec: true });
      r.capsule(16, fy - 2, 16, fy + 4, 1.4, RAMPS.steel);
      r.rect(14, fy + 20, 4, 10, '#a2afc4');
      break;
    }
    case 'vent': {
      r.shadeRect(2, 4, 28, 24, RAMPS.metal, (u, v) => 0.6 - v * 0.3, 2);
      for (let y = 7; y < 26; y += 3) { r.rect(5, y, 22, 1, '#0a0a14'); r.rect(5, y + 1, 22, 1, '#3a4260'); }
      if (f) { r.blob(11, 15, 2, 2, RAMPS.slime, { spec: true }); r.blob(21, 15, 2, 2, RAMPS.slime, { spec: true }); }
      break;
    }
    case 'bin': {
      r.cylinder(16, 6, 10, 3, H - 12, RAMPS.metal, RAMPS.steel);
      r.rect(8, 14, 16, 1, '#262b40');
      r.blob(16, 18, 2, 1.2, f ? RAMPS.red : RAMPS.green, { spec: true });
      if (f) {
        r.blob(11, 4, 4, 3, RAMPS.white, { spec: true }); r.shadeRect(17, 1, 5, 6, RAMPS.red, (u) => 0.7 - u * 0.3, 1);
        r.blob(23, 5, 3, 1.5, RAMPS.yellow);
      }
      break;
    }
    case 'tank': {
      r.cylinder(16, 8, 11, 3.2, H - 22, RAMPS.glass, RAMPS.steel);
      for (let y = 14; y < H - 14; y++) for (let x = 7; x < 26; x++) r.blend(x, y, '#2ac98a', 0.35);
      r.blob(16, 30, 4.5, 6, rampOf('#0e5a3e', 5));
      r.blob(16, 22, 3.5, 3, rampOf('#0e5a3e', 5));
      for (let i = 0; i < 4; i++) r.blob(9 + ((i * 7 + f * 3) % 14), 50 - ((i * 11 + f * 9) % 34), 1.2, 1.2, RAMPS.white);
      r.line(8, 12, 8, H - 16, '#d8fff0');
      r.box3d(4, 0, 24, 4, 6, RAMPS.steel, RAMPS.metal, { r: 2 });
      r.box3d(3, H - 14, 26, 4, 10, RAMPS.steel, RAMPS.metal, { r: 2 });
      break;
    }
    case 'bench': {
      r.box3d(2, fy + 2, W - 4, 14, 14, RAMPS.white, RAMPS.steel, { r: 2 });
      r.blob(12, fy - 2, 4, 5, RAMPS.glass, { spec: true }); r.blob(12, fy, 3, 3, RAMPS.purple);
      r.capsule(12, fy - 9, 12, fy - 5, 1.2, RAMPS.glass);
      r.blob(30, fy, 5, 4, RAMPS.glass, { spec: true }); r.blob(30, fy + 1, 3.6, 2.5, RAMPS.green);
      r.shadeRect(52, fy - 6, 6, 10, RAMPS.glass, (u) => 0.7 - u * 0.3, 1); r.rect(53, fy - 1, 4, 4, '#e83a4a');
      r.box3d(70, fy - 6, 12, 4, 8, RAMPS.steel, RAMPS.metal); r.capsule(76, fy - 12, 78, fy - 4, 1.5, RAMPS.metal);
      r.rect(40, fy + 6, 10, 6, '#f2f0ff'); r.rect(41, fy + 7, 7, 1, '#7a86ad'); r.rect(41, fy + 9, 5, 1, '#7a86ad');
      break;
    }
    case 'reactor': {
      const hot = f === 2;
      r.box3d(0, fy + 18, W, 12, 32, RAMPS.steel, RAMPS.metal, { r: 3 });
      for (let x = 4; x < W - 4; x += 8) { r.rect(x, fy + 32, 4, 4, '#ffd23f'); r.rect(x + 4, fy + 32, 4, 4, '#1a1a22'); }
      r.cylinder(32, 6, 17, 5, fy + 14, RAMPS.metal, RAMPS.steel);
      const glow = hot ? RAMPS.orange : RAMPS.hologram;
      r.shadeRect(22, 12, 20, fy + 2, glow, (u, v) => (f === 1 ? 0.95 : 0.8) - Math.abs(u - 0.4) * 0.6 - v * 0.1, 2);
      for (let y = 18; y < fy + 12; y += 8) r.rect(16, y, 32, 2, '#1a1f30');
      for (const x of [6, 54]) r.capsule(x, 18, x, fy + 18, 3.5, COPPER);
      bolts(r, 4, fy + 22, W - 8, 24);
      break;
    }
    case 'reactorConsole': {
      r.box3d(3, fy - 2, 26, 8, 24, RAMPS.steel, RAMPS.metal, { r: 2 });
      r.shadeRect(7, 0, 18, fy, RAMPS.white, (u, v) => 0.85 - u * 0.2 - v * 0.2, 2);
      r.line(16, fy - 3, f ? 23 : 10, 4, f ? '#e83a4a' : '#1fae5c');
      for (let a = 0; a < 5; a++) r.p(9 + a * 3.5, 5 + Math.abs(2 - a), '#3a4260');
      r.blob(9, fy + 12, 2.4, 2, f ? RAMPS.red : RAMPS.green, { spec: true }); r.blob(22, fy + 12, 2.4, 2, RAMPS.yellow, { spec: true });
      break;
    }
    case 'pipes': {
      r.box3d(0, H - 14, W, 4, 10, RAMPS.steel, RAMPS.metal);
      const ramps = [RAMPS.steel, COPPER, RAMPS.metal];
      for (let i = 0; i < 3; i++) {
        const x = 10 + i * 21;
        r.capsule(x, 0, x, H - 12, 5, ramps[i]);
        r.blob(x, 14 + i * 8, 6, 3, RED, { spec: true });
        r.rect(x - 6, 30 + i * 4, 12, 3, '#262b40');
      }
      r.blob(52, 10, 5, 5, RAMPS.white, { spec: true }); r.line(52, 10, 55, 7, '#e83a4a');
      break;
    }
    case 'barrel': {
      const fuel = variant % 2 === 1;
      r.cylinder(16, 6, 12, 3.5, H - 14, fuel ? rampOf('#c84a1a', 7) : rampOf('#2a2438', 7), fuel ? rampOf('#e86a2a', 7) : rampOf('#3a3450', 7));
      r.rect(4, 14, 24, 3, '#ffd23f'); r.rect(4, H - 14, 24, 3, '#ffd23f');
      for (let i = 0; i < 6; i++) r.rect(10 + i, 22 + (i >> 1), 12 - i * 2, 1, '#ffd23f');
      r.p(16, 24, '#e83a4a'); r.p(15, 25, '#e83a4a'); r.p(17, 25, '#e83a4a');
      break;
    }
    case 'toolrack': {
      r.shadeRect(2, 0, W - 4, H - 14, rampOf('#8a6a42', 6), (u, v) => 0.6 - u * 0.2 - v * 0.2, 2);
      for (let y = 4; y < H - 18; y += 5) for (let x = 6; x < W - 6; x += 5) r.p(x, y, '#4a3420');
      r.capsule(12, 6, 12, 26, 1.6, RAMPS.steel); r.blob(12, 6, 3.5, 2.5, RAMPS.steel);
      r.capsule(26, 8, 26, 24, 1.8, rampOf('#5a3a1e', 5)); r.shadeRect(21, 6, 10, 5, RAMPS.metal, () => 0.6, 1);
      r.capsule(40, 6, 40, 16, 1.2, RAMPS.steel); r.capsule(40, 16, 40, 26, 2, RED);
      r.shadeRect(48, 6, 10, 18, RAMPS.steel, (u) => 0.8 - u * 0.4); for (let y = 8; y < 24; y += 2) r.p(48, y, '#262b40');
      r.box3d(0, H - 16, W, 6, 10, RAMPS.steel, RAMPS.metal, { r: 1 });
      r.rect(20, H - 6, 8, 1, '#c8d0e8'); r.rect(40, H - 6, 8, 1, '#c8d0e8');
      break;
    }
    case 'bed': {
      const blanket = rampOf(['#5a6ad8', '#d85a8a', '#4ab89a', '#d8a04a'][variant % 4], 7);
      r.shadeRect(1, 2, 30, H - 6, RAMPS.metal, (u, v) => 0.55 - u * 0.2, 3);
      r.shadeRect(3, 4, 26, H - 12, RAMPS.white, (u, v) => 0.88 - u * 0.2 - v * 0.1, 3);
      r.blob(16, 12, 10, 5, RAMPS.white, { spec: true });
      r.shadeRect(3, 22, 26, H - 30, blanket, (u, v) => 0.75 - u * 0.35 - v * 0.15, 2);
      r.rect(3, 22, 26, 2, blanket[5]);
      r.line(8, 30, 22, 34, blanket[2]);
      break;
    }
    case 'locker': {
      const col0 = rampOf(['#5a7a9a', '#7a6a9a', '#5a8a7a'][variant % 3], 7);
      r.box3d(2, 2, 28, 4, H - 8, RAMPS.steel, col0, { r: 2 });
      r.rect(15, 8, 1, H - 14, col0[1]);
      for (let y = 10; y < 22; y += 3) { r.rect(5, y, 8, 1, col0[1]); r.rect(19, y, 8, 1, col0[1]); }
      r.rect(11, 32, 2, 4, '#d6def0'); r.rect(19, 32, 2, 4, '#d6def0');
      r.rect(6, 44, 6, 3, '#f2f0ff');
      break;
    }
    case 'medkit': {
      r.box3d(4, 2, 24, 4, 20, RAMPS.white, RAMPS.ceramic, { r: 2 });
      const cr = f ? '#8a8a9a' : '#e83a4a';
      r.rect(14, 8, 4, 12, cr); r.rect(10, 12, 12, 4, cr);
      r.rect(15, 26, 2, H - 34, '#7a86ad');
      r.box3d(6, H - 10, 20, 3, 5, RAMPS.steel, RAMPS.metal);
      break;
    }
    case 'station': {
      r.shadeRect(0, 0, W, H - 4, RAMPS.metal, (u, v) => 0.4 - v * 0.1, 2);
      for (const y of [16, 30]) r.box3d(2, y, W - 4, 3, 2, RAMPS.steel, RAMPS.metal);
      const bottles = [RAMPS.cyan, RAMPS.green, rampOf('#ff5d9e', 6), RAMPS.purple];
      bottles.forEach((b, i) => { r.cylinder(7 + i * 7, 6, 2.6, 1, 9, b); r.rect(6 + i * 7, 4, 3, 2, '#f2f0ff'); });
      for (let i = 0; i < 3; i++) { r.cylinder(40 + i * 7, 20, 3, 1, 9, RED); r.rect(39 + i * 7, 23, 3, 2, '#ffffff'); }
      r.cylinder(18, H - 22, 10, 3.5, 12, RAMPS.yellow);
      r.blob(18, H - 22, 7, 2, RAMPS.glass);
      r.capsule(22, 6, 18, H - 22, 1.4, RAMPS.wood);
      r.shadeRect(36, H - 22, 22, 12, RAMPS.dark, () => 0.3, 1);
      drawText(penOf(r), 38, H - 19, 'MOP', '#ffd23f');
      r.rect(51, H - 18, 4, 4, '#4ff0ff');
      break;
    }
    case 'chute': {
      r.shadeRect(0, 0, W, H - 4, RAMPS.metal, (u, v) => 0.5 - v * 0.2, 2);
      for (let x = 0; x < W; x += 6) { r.rect(x, 2, 3, 5, '#ffd23f'); r.rect(x + 3, 2, 3, 5, '#1a1a22'); }
      r.shadeRect(6, 12, 20, 22, RAMPS.dark, (u, v) => 0.05 + v * 0.25, 3);
      r.rect(6, 12, 20, 2, '#56618a');
      r.rect(14, H - 16, 4, 6, '#ffd23f'); r.rect(12, H - 12, 8, 2, '#ffd23f');
      break;
    }
    case 'vending': {
      const body = rampOf(f ? '#5a2a30' : '#b02838', 7);
      r.shadeRect(2, 0, 28, H - 4, body, (u, v) => 0.7 - u * 0.4 - v * 0.15, 3);
      r.shadeRect(5, 6, 16, H - 22, f ? RAMPS.dark : RAMPS.glass, (u, v) => 0.55 - u * 0.2 + (u + v < 0.3 ? 0.3 : 0), 1);
      if (!f) {
        const c = ['#ffd23f', '#5dff9b', '#ff5d9e', '#4ff0ff', '#ff8a3d'];
        for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) r.rect(7 + x * 5, 9 + y * 7, 3, 4, c[(x + y) % 5]);
        r.line(6, 30, 18, 8, '#ffffff');
      } else { r.line(6, 10, 18, 30, '#c8d0e0'); r.line(18, 12, 8, 26, '#c8d0e0'); }
      r.rect(23, 12, 4, 4, '#ffd23f'); r.rect(23, 18, 4, 1, '#1a1a22');
      r.shadeRect(6, H - 14, 16, 6, RAMPS.dark, () => 0.2, 1);
      break;
    }
    case 'medBed': {
      r.shadeRect(1, 2, 30, H - 6, RAMPS.steel, (u) => 0.6 - u * 0.2, 3);
      r.shadeRect(3, 4, 26, H - 12, RAMPS.white, (u, v) => 0.9 - u * 0.2 - v * 0.1, 3);
      r.blob(16, 12, 10, 5, RAMPS.white, { spec: true });
      r.shadeRect(3, 24, 26, H - 32, rampOf('#5ab8c8', 7), (u, v) => 0.75 - u * 0.35 - v * 0.15, 2);
      r.rect(1, 20, 2, 30, '#c8d0e0'); r.rect(29, 20, 2, 30, '#c8d0e0');
      break;
    }
    case 'medPod': {
      r.shadeRect(2, 2, 28, H - 6, RAMPS.white, (u, v) => 0.85 - u * 0.35 - v * 0.1, 10);
      r.shadeRect(6, 8, 20, H - 26, RAMPS.glass, (u, v) => 0.6 - u * 0.3 + (u < 0.2 ? 0.2 : 0), 8);
      if (f) { r.blob(16, 24, 5, 5, rampOf('#d8b090', 5)); r.shadeRect(10, 30, 12, 30, rampOf('#3a4a7a', 6), (u) => 0.6 - u * 0.3, 4); }
      r.blob(16, H - 12, 3, 2, f ? RAMPS.green : RAMPS.cyan, { spec: true });
      break;
    }
    case 'medScanner': {
      r.box3d(2, fy - 2, W - 4, 10, 22, RAMPS.white, RAMPS.ceramic, { r: 3 });
      r.shadeRect(8, 0, W - 16, fy + 2, RAMPS.dark, () => 0.3, 2);
      const g = '#5dff9b';
      let px = 10, py = 12;
      for (let x = 10; x < W - 10; x += 2) {
        const k = (x + f * 8) % 20;
        const y = k === 8 ? 4 : k === 10 ? 18 : k === 12 ? 8 : 12;
        r.line(px, py, x, y, g); px = x; py = y;
      }
      r.rect(W / 2 - 2, fy + 8, 4, 10, '#e83a4a'); r.rect(W / 2 - 5, fy + 11, 10, 4, '#e83a4a');
      break;
    }
    case 'medCabinet': {
      r.box3d(2, 2, 28, 4, H - 8, RAMPS.white, RAMPS.ceramic, { r: 2 });
      r.shadeRect(5, 10, 22, 26, RAMPS.glass, (u, v) => 0.65 - u * 0.3, 1);
      const cs = [RAMPS.red, RAMPS.cyan, RAMPS.yellow, RAMPS.green];
      for (let i = 0; i < 4; i++) { r.cylinder(9 + i * 5, 14, 1.8, 0.8, 6, cs[i]); r.cylinder(9 + i * 5, 26, 1.8, 0.8, 6, cs[3 - i]); }
      r.rect(14, 2, 4, 6, '#e83a4a'); r.rect(12, 4, 8, 2, '#e83a4a');
      break;
    }
    case 'plantBed': {
      r.box3d(2, fy, W - 4, 10, 16, RAMPS.soil, RAMPS.wood, { r: 2 });
      for (let x = 8; x < W - 8; x += 9) {
        leaf(r, x, fy - 2, 5); leaf(r, x + 4, fy - 6, 4.5);
        if ((x + variant) % 3 === 0) r.blob(x + 2, fy - 3, 1.8, 1.8, f ? RAMPS.red : RAMPS.orange, { spec: true });
      }
      r.shadeRect(4, 0, W - 8, 3, RAMPS.dark, () => 0.3);
      for (let x = 6; x < W - 6; x += 3) r.blend(x, 2, '#d080ff', 0.9);
      break;
    }
    case 'hydroTank': {
      r.cylinder(16, 8, 12, 3.5, H - 20, RAMPS.glass, RAMPS.steel);
      for (let y = 18; y < H - 12; y++) for (let x = 6; x < 27; x++) r.blend(x, y, '#3ad8a8', 0.4);
      for (let i = 0; i < 4; i++) r.blob(10 + i * 4, 50 - i * 9, 1.3, 1.3, RAMPS.white);
      r.capsule(28, 20, 31, 20, 2, RAMPS.steel);
      r.box3d(3, H - 12, 26, 3, 8, RAMPS.steel, RAMPS.metal);
      break;
    }
    case 'secretLocker': {
      const gold = RAMPS.yellow;
      r.box3d(2, 2, 28, 4, H - 8, gold, rampOf('#c8901a', 7), { r: 2 });
      r.rect(15, 8, 1, H - 14, '#7a4a0c');
      r.blob(16, 22, 5, 5, RAMPS.white, { spec: true });
      drawText(penOf(r), 11, 20, 'MOP', '#7a4a0c');
      if (f) for (const [x, y] of [[6, 10], [26, 14], [8, 40], [24, 44]]) { r.p(x, y, '#ffffff'); r.p(x - 1, y, '#fff6c8'); r.p(x + 1, y, '#fff6c8'); r.p(x, y - 1, '#fff6c8'); r.p(x, y + 1, '#fff6c8'); }
      break;
    }
  }
}

export function propSheetHD(kind: PropKind, variant: number): { canvas: HTMLCanvasElement; fw: number; fh: number; frames: number } {
  const d = PROP_DEFS[kind];
  const W = d.w * 32, H = d.h * 32 + d.up * 2;
  const frames = PROP_FRAMES[kind] ?? 1;
  const out = new Raster(W * frames, H);
  for (let f = 0; f < frames; f++) {
    const r = new Raster(W, H);
    drawPropHD(kind, f, r, W, H, variant);
    r.grade({ sat: 0.5, dark: 0.78, grime: 0.5, seed: variant * 13 + kind.length });
    r.rimLight('#cfe8ee', 0.22);
    r.outline('#020304', 0.7);
    out.blit(r, f * W, 0);
  }
  return { canvas: out.toCanvas(), fw: W, fh: H, frames };
}

export { col };
