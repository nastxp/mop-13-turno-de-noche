import { MAP_H, MAP_W, TILE } from '../config';
import { Tile, type ShipMap } from '../world/ShipMap';
import type { AlertInfo } from '../systems/EmergencySystem';
import type { GameScene } from '../scenes/GameScene';

/** Minimapa de la nave con tripulación, criaturas, fuego e incidencias. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;

  constructor(public canvas: HTMLCanvasElement, public s: number) {
    canvas.width = MAP_W * s;
    canvas.height = MAP_H * s;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  setMap(map: ShipMap) {
    const s = this.s;
    const c = document.createElement('canvas');
    c.width = MAP_W * s;
    c.height = MAP_H * s;
    const g = c.getContext('2d')!;
    g.fillStyle = '#05040c';
    g.fillRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const t = map.tile(tx, ty);
        if (t === Tile.Void) continue;
        if (t === Tile.Wall) g.fillStyle = '#3a4260';
        else {
          const rid = map.roomAt[map.idx(tx, ty)];
          const room = rid ? map.room(rid) : null;
          g.fillStyle = t === Tile.Door ? '#8a94b8' : room ? shadeHex(room.accent, -0.72) : '#1c2034';
          if (map.propAt[map.idx(tx, ty)]) g.fillStyle = shadeHex(room?.accent ?? '#555', -0.55);
        }
        g.fillRect(tx * s, ty * s, s, s);
      }
    }
    this.base = c;
  }

  draw(w: GameScene, alerts: AlertInfo[], pinned: string | null) {
    const g = this.ctx;
    const s = this.s;
    if (!this.base) return;
    g.drawImage(this.base, 0, 0);
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    const P = (x: number, y: number) => [Math.round((x / TILE) * s), Math.round((y / TILE) * s)];
    for (const d of w.map.doors) {
      if (!d.locked) continue;
      g.fillStyle = '#ff4d5a';
      for (const t of d.tiles) g.fillRect(t.tx * s, t.ty * s, s, s);
    }
    for (const f of w.emerg.fires.values()) {
      g.fillStyle = blink ? '#ff8a3d' : '#ffd23f';
      g.fillRect(f.tx * s, f.ty * s, s, s);
    }
    const dot = Math.max(2, Math.round(s * 0.9));
    for (const c of w.crew) {
      if (!c.alive || c.hidden) continue;
      const [x, y] = P(c.x, c.y);
      g.fillStyle = c.state === 'knocked' ? (blink ? '#ff4d5a' : '#ffffff') : c.prof === 'inspector' ? '#b067ff' : '#e8e6f8';
      g.fillRect(x - 1, y - 1, dot, dot);
    }
    for (const c of w.creatures) {
      if (!c.alive || c.hidden) continue;
      const [x, y] = P(c.x, c.y);
      g.fillStyle = blink ? '#5dff9b' : '#1fae6c';
      g.fillRect(x - 1, y - 1, dot + 1, dot + 1);
    }
    // invitado: tripulación y criaturas que manda el anfitrión
    const nd = w.clientSync?.dots() ?? [];
    for (let i = 0; i + 2 < nd.length; i += 3) {
      const [x, y] = P(nd[i], nd[i + 1]);
      const k = nd[i + 2];
      g.fillStyle = k === 3 ? (blink ? '#5dff9b' : '#1fae6c') : k === 1 ? (blink ? '#ff4d5a' : '#ffffff') : k === 2 ? '#b067ff' : '#e8e6f8';
      g.fillRect(x - 1, y - 1, dot + (k === 3 ? 1 : 0), dot + (k === 3 ? 1 : 0));
    }
    for (const a of alerts) {
      if (!a.x && !a.y) continue;
      const [x, y] = P(a.x, a.y);
      const col = a.sev === 3 ? '#ff4d5a' : a.sev === 2 ? '#ff8a3d' : '#ffd23f';
      g.strokeStyle = col;
      g.lineWidth = 1;
      if (blink || a.id === pinned) g.strokeRect(x - s - 0.5, y - s - 0.5, s * 2 + 1, s * 2 + 1);
      if (a.id === pinned) {
        g.strokeStyle = '#ffd23f';
        g.strokeRect(x - s * 2 - 0.5, y - s * 2 - 0.5, s * 4 + 1, s * 4 + 1);
      }
    }
    // todos los conserjes (en multijugador, los compañeros en cian)
    for (const p of w.players) {
      if (!p.active || (p.dead && !p.isLocal)) continue;
      const [x, y] = P(p.x, p.y);
      g.fillStyle = '#000';
      g.fillRect(x - 2, y - 2, dot + 2, dot + 2);
      g.fillStyle = p.isLocal ? '#ffd23f' : '#4ff0ff';
      g.fillRect(x - 1, y - 1, dot, dot);
    }
  }
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; gg *= 1 + amt; b *= 1 + amt; }
  else { r += (255 - r) * amt; gg += (255 - gg) * amt; b += (255 - b) * amt; }
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(gg)}${h(b)}`;
}
