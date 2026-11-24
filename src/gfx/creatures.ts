import { col, rampOf, RAMPS, Raster, type Ramp } from './raster';

/** Hojas de sprites HD de criaturas, robots y jefes. Todas miran a la derecha (se voltean en juego). */

function sheet(fw: number, fh: number, n: number, draw: (r: Raster, f: number) => void): HTMLCanvasElement {
  const out = new Raster(fw * n, fh);
  for (let f = 0; f < n; f++) {
    const r = new Raster(fw, fh);
    draw(r, f);
    r.grade({ sat: 0.82, dark: 0.86, grime: 0.12, tint: '#06140e' });
    r.rimLight('#eafff4', 0.4);
    r.outline('#020304', 0.75);
    out.blit(r, f * fw, 0);
  }
  return out.toCanvas();
}

function eyeball(r: Raster, x: number, y: number, rad: number, state: 'normal' | 'angry' | 'stun', look = 0) {
  r.blob(x, y, rad, rad, RAMPS.white, { spec: true });
  if (state === 'stun') {
    r.line(x - 1.5, y - 1.5, x + 1.5, y + 1.5, '#14101c');
    r.line(x + 1.5, y - 1.5, x - 1.5, y + 1.5, '#14101c');
  } else {
    r.rect(Math.round(x - 1 + look), Math.round(y - 0.5), 2, 2, state === 'angry' ? '#e8203a' : '#14101c');
    if (state === 'angry') r.line(x - rad, y - rad, x + rad, y - rad + 1.5, '#14101c');
  }
}

/** Glorp: gelatina alienígena. 0-1 reposo, 2-3 movimiento, 4 furia, 5 aturdido */
export function glorpSheet(big: boolean) {
  const ramp: Ramp = big ? RAMPS.purple : RAMPS.slime;
  return sheet(32, 32, 6, (r, f) => {
    const squish = f === 1 || f === 3;
    const cx = 16 + (f === 2 || f === 3 ? 1 : 0);
    const cy = squish ? 23 : 22;
    const rx = squish ? 11 : 9.5, ry = squish ? 6 : 7.5;
    r.blob(cx, cy, rx, ry, ramp, { spec: true });
    for (let y = Math.floor(cy - ry * 0.4); y < cy + ry * 0.4; y++)
      for (let x = Math.floor(cx - rx * 0.45); x < cx + rx * 0.3; x++) {
        const nx = (x - cx + rx * 0.08) / (rx * 0.45), ny = (y - cy) / (ry * 0.4);
        if (nx * nx + ny * ny < 1) r.blend(x, y, ramp[ramp.length - 2], 0.25);
      }
    r.blob(cx + rx - 2, cy + ry - 1, 1.5, 2, ramp);
    if (big) for (let i = 0; i < 4; i++) r.line(cx - 6 + i * 4, cy - ry + 1, cx - 5 + i * 4, cy - ry - 2, ramp[5]);
    const top = cy - ry;
    r.capsule(cx - 3, top + 2, cx - 5, top - 4, 1.3, ramp);
    r.capsule(cx + 3, top + 2, cx + 5, top - 4, 1.3, ramp);
    const st = f === 5 ? 'stun' : f === 4 ? 'angry' : 'normal';
    eyeball(r, cx - 5.5, top - 5, 3, st, f === 2 || f === 3 ? 1 : 0);
    eyeball(r, cx + 5.5, top - 5, 3, st, f === 2 || f === 3 ? 1 : 0);
    if (f === 4) {
      r.shadeRect(cx - 4, cy - 1, 8, 4, RAMPS.red, (u, v) => 0.2 + v * 0.1, 1);
      for (let x = cx - 3; x < cx + 4; x += 2) r.p(x, cy - 1, '#ffffff');
    } else r.rect(cx - 2, cy + 1, 4, 1, '#0a2a1e');
  });
}

/** «Rasgador»: invasor hostil. 0-1 caminar, 2-3 ataque, 4 herido, 5 muerto */
export function invaderSheet() {
  const body = RAMPS.chrome;
  const belly = RAMPS.bone;
  return sheet(32, 32, 6, (r, f) => {
    const dead = f === 5;
    const hurt = f === 4;
    const bias = hurt ? 0.25 : 0;
    if (dead) {
      r.capsule(8, 25, 22, 25, 5, body, -0.1);
      r.blob(25, 24, 5, 4, body);
      for (const [x0, x1] of [[10, 8], [14, 13], [18, 19], [21, 23]]) r.capsule(x0, 21, x1, 15, 1.2, body);
      r.p(26, 22, '#14101c'); r.p(28, 22, '#14101c'); r.p(27, 23, '#14101c');
      return;
    }
    const step = f === 1 ? 1 : 0;
    r.capsule(9, 18, 3, 13 + step, 2, body, bias);
    for (const [hx, hy, fx] of [[10, 21, step ? 7 : 11], [13, 21, step ? 15 : 11], [19, 20, step ? 17 : 22], [21, 20, step ? 24 : 20]] as [number, number, number][]) {
      r.capsule(hx, hy, fx, 29, 1.6, body, bias - 0.1);
    }
    r.capsule(9, 18, 21, 16, 5.4, body, bias);
    r.shadeRect(11, 19, 10, 3, belly, (u) => 0.6 - u * 0.2, 1);
    for (let i = 0; i < 4; i++) r.line(10 + i * 3, 13, 11 + i * 3, 9, i % 2 ? '#d8cfb4' : '#a89c80');
    for (let i = 0; i < 5; i++) r.lineN(9 + i * 2.6, 14.5, 9.6 + i * 2.6, 20.5, '#4a5c6c');
    for (let i = 0; i < 3; i++) r.blob(7 - i * 1.7, 17 - i * 1.4 + step * 0.3, 1.3, 1.1, RAMPS.bone);
    const attack = f === 2 || f === 3;
    const hx = attack ? 26 : 25;
    r.blob(hx, 14, 5.6, 4.6, body, { bias, spec: true });
    if (attack) {
      r.shadeRect(hx, 16, 7, 4, RAMPS.red, (u, v) => 0.2 + v * 0.2, 1);
      for (let x = hx; x < hx + 7; x += 2) { r.p(x, 16, '#ffffff'); r.p(x + 1, 19, '#ffffff'); }
    }
    r.blob(hx + 2, 12.5, 1.3, 0.9, RAMPS.amber, { spec: true }); r.blob(hx + 5, 12.5, 1.3, 0.9, RAMPS.amber, { spec: true });
    r.lineN(hx - 3, 10, hx + 4, 9, '#9db4c6');
  });
}

/** Babosa gigante: 4 fotogramas de reptación */
export function slugSheet() {
  const ramp = rampOf('#c8d84a', 7);
  const mantle = rampOf('#8aa83a', 6);
  return sheet(40, 24, 4, (r, f) => {
    const sq = f % 2 === 0 ? 0 : 1;
    r.blob(19, 16 + sq * 0.5, 16 - sq, 6 + sq * 0.5, ramp, { spec: true });
    r.blob(16, 12 + sq * 0.5, 9.5, 5, mantle, { spec: true });
    for (let i = 0; i < 4; i++) r.line(10 + i * 4, 9 + sq, 11 + i * 4, 15 + sq, mantle[1]);
    r.capsule(31, 13, 33, 5 + sq, 1.1, ramp);
    r.capsule(33, 13, 37, 6 + sq, 1.1, ramp);
    r.blob(33, 4 + sq, 1.7, 1.7, RAMPS.dark);
    r.blob(37, 5 + sq, 1.7, 1.7, RAMPS.dark);
    r.rect(34, 17, 3, 1, '#4a5a1a');
  });
}

/** Rata basurera: 0-1 correr, 2 con botín, 3 herida */
export function ratSheet() {
  const fur = rampOf('#7a7a8e', 6);
  return sheet(24, 24, 4, (r, f) => {
    const leg = f === 1 ? 1 : 0;
    r.line(6, 16, 1, 10 - leg, '#c88a9a');
    r.line(1, 10 - leg, 2, 8, '#c88a9a');
    r.blob(11, 15, 7, 5, fur, { bias: f === 3 ? 0.25 : 0, spec: true });
    r.blob(17.5, 12, 4.6, 4, fur, { bias: f === 3 ? 0.25 : 0 });
    r.blob(15, 7.5, 2.6, 2.6, fur);
    r.blob(15, 7.5, 1.3, 1.3, rampOf('#e88aa0', 4));
    r.rect(19, 11, 2, 2, '#ff3040'); r.p(19, 11, '#ffd0d0');
    r.blob(22, 13, 1.2, 1, rampOf('#ff8aa0', 3));
    for (const x of [7, 10, 13, 16]) r.rect(x + ((x / 3) % 2 ? leg : -leg), 19, 2, 2, '#4a4a5a');
    if (f === 2) { r.rect(21, 12, 4, 3, '#e8e6f0'); r.p(22, 13, '#ff5d6c'); }
  });
}

/** Insecto devoracables (enjambre) */
export function insectSheet() {
  const shell = rampOf('#7a3a2a', 6);
  return sheet(16, 16, 2, (r, f) => {
    for (const y of [6, 9, 12]) { r.line(4, y, 1, y + (f ? 1 : -1), '#2a1a14'); r.line(12, y, 15, y + (f ? -1 : 1), '#2a1a14'); }
    r.blob(8, 9, 4, 5.4, shell, { spec: true });
    r.rect(8, 5, 1, 8, shell[1]);
    if (f) { r.blend(3, 6, '#c8f0ff', 0.6); r.blend(12, 6, '#c8f0ff', 0.6); r.blend(2, 7, '#c8f0ff', 0.5); r.blend(13, 7, '#c8f0ff', 0.5); }
    r.blob(8, 3.5, 2.5, 2, shell);
    r.line(7, 2, 5, 0, '#2a1a14'); r.line(9, 2, 11, 0, '#2a1a14');
    r.p(7, 3, '#e8f040'); r.p(9, 3, '#e8f040');
  });
}

/** Aspiradora robótica: rebelde (LED rojo) o de limpieza (LED cian) */
export function vacuumBotSheet(rogue: boolean) {
  return sheet(24, 20, 2, (r, f) => {
    r.cylinder(12, 8, 10, 4, 5, rogue ? rampOf('#4a3a4a', 7) : RAMPS.metal, rogue ? rampOf('#6a5a6a', 7) : RAMPS.steel);
    r.rect(4, 13, 16, 1, rogue ? '#e83a4a' : '#ffd23f');
    const led = rogue ? (f ? '#ff2040' : '#801020') : (f ? '#5af0ff' : '#1a8aa0');
    r.blob(12, 7, 2.4, 1.6, [led, led, led]);
    r.p(11, 7, '#ffffff');
    if (rogue) { r.line(7, 5, 10, 6, '#14101c'); r.line(17, 5, 14, 6, '#14101c'); }
    r.rect(2 + f, 16, 3, 1, '#c8d0e0'); r.rect(19 - f, 16, 3, 1, '#c8d0e0');
  });
}

/** Reina del Moho (jefe): 3 fotogramas de pulso */
export function moldQueenSheet() {
  const base = rampOf('#4a6a32', 7);
  const cap = rampOf('#a8406a', 7);
  return sheet(64, 64, 3, (r, f) => {
    const p = f === 1 ? 1 : f === 2 ? -1 : 0;
    r.blob(32, 48, 27 + p, 13, base, { spec: true });
    for (let i = 0; i < 9; i++) r.blob(8 + i * 6, 54 + (i % 2) * 2, 3, 2.5, base);
    r.capsule(32, 46, 32, 26, 6, base);
    r.blob(19, 31, 10 + p, 6, cap, { spec: true });
    r.blob(45, 27, 12 + p, 7, cap, { spec: true });
    r.blob(32, 17, 10 + p, 7, cap, { spec: true });
    for (const [x, y] of [[16, 29], [22, 32], [42, 24], [48, 28], [29, 14], [35, 16]]) r.blob(x, y, 1.6, 1.4, RAMPS.white);
    r.blob(27, 34, 2.6, 3, RAMPS.yellow, { spec: true }); r.blob(37, 34, 2.6, 3, RAMPS.yellow, { spec: true });
    r.rect(26, 34, 2, 2, '#14101c'); r.rect(36, 34, 2, 2, '#14101c');
    r.shadeRect(27, 40, 10, 3 + Math.max(0, p), RAMPS.dark, () => 0.3, 1);
    for (const [x, y] of [[10, 44], [54, 42], [14, 52], [50, 52]]) r.blob(x, y, 3.5 + p * 0.6, 3.5 + p * 0.6, RAMPS.yellow, { spec: true });
  });
}

/** Rey Aspirador (jefe): 0 normal, 1 aspirando, 2 dañado */
export function vacuumKingSheet() {
  const body = rampOf('#5a4a6a', 8);
  return sheet(56, 48, 3, (r, f) => {
    r.cylinder(28, 14, 20, 6, 22, body, rampOf('#7a6a8a', 8));
    for (let x = 10; x < 46; x += 6) { r.rect(x, 34, 3, 2, '#ffd23f'); r.rect(x + 3, 34, 3, 2, '#14101c'); }
    r.shadeRect(14, 26, 28, 6, RAMPS.dark, (u, v) => 0.2 + v * 0.1, 2);
    for (let x = 16; x < 40; x += 3) r.p(x, 26, '#c8d0e0');
    r.shadeRect(15, 16, 26, 4, RAMPS.dark, () => 0.2, 1);
    const eye = f === 2 ? '#ff8a3a' : '#ff2040';
    r.rect(18, 17, 6, 2, eye); r.rect(32, 17, 6, 2, eye);
    r.line(17, 15, 24, 17, '#14101c'); r.line(39, 15, 32, 17, '#14101c');
    r.capsule(46, 22, 54, 10, 3, RAMPS.metal);
    r.blob(54, 8, 3.5, 3, RAMPS.steel);
    r.blob(28, 9, 5, 2.5, rampOf('#ff4d5a', 5), { spec: true });
    if (f === 1) for (let i = 0; i < 6; i++) r.blend(18 + i * 4, 30 + (i % 2), '#c8f0ff', 0.6);
    if (f === 2) { r.line(20, 22, 26, 30, '#ffe24a'); r.line(36, 20, 30, 28, '#ffe24a'); r.blob(44, 12, 3, 3, RAMPS.dark); }
  });
}

/** Cadáver tapado con manta térmica (la tripulación caída) */
export function bodyBagCanvas() {
  const r = new Raster(32, 18);
  const bag = rampOf('#3a4a7a', 6);
  r.shadeRect(2, 3, 28, 12, bag, (u, v) => 0.75 - u * 0.3 - v * 0.3, 5);
  r.blob(6, 9, 4.5, 5, bag, { spec: true });
  for (let x = 10; x < 28; x += 4) r.line(x, 4, x, 14, bag[1]);
  r.rect(14, 3, 2, 12, '#ffd23f');
  r.outline('#08060f', 0.7);
  return r.toCanvas();
}

/** Alma de dibujos animados que sube al morir alguien (tono cómico) */
export function ghostCanvas() {
  const r = new Raster(20, 24);
  const g = ['#6a7aa8', '#9aa8d0', '#c8d4ee', '#eef4ff', '#ffffff'];
  r.blob(10, 9, 7, 7.5, g, { spec: true });
  r.shadeRect(3, 9, 14, 9, g, (u, v) => 0.85 - u * 0.3 - v * 0.2);
  for (let x = 3; x < 17; x += 4) r.blob(x + 2, 18, 2, 2, g);
  r.rect(7, 8, 2, 3, '#2a2a4a'); r.rect(12, 8, 2, 3, '#2a2a4a');
  r.rect(9, 13, 2, 2, '#2a2a4a');
  r.outline('#08060f', 0.5);
  return r.toCanvas();
}

export { col };
