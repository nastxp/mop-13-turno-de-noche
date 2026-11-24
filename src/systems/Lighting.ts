import Phaser from 'phaser';
import { DEPTH, TILE, WORLD_H, WORLD_W } from '../config';
import { ROOM_LIGHT, ROOM_TINT } from '../gfx/tiles';
import { HD } from '../gfx/sprites';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

/** Resolución del mapa de luz respecto al mundo (la luz es suave: media resolución + filtrado lineal). */
const RES = 0.5;
const MAX_BEACONS = 36;
const FOG_N = 14;
const DRIP_N = 10;

/** mezcla dos colores 0xRRGGBB */
function mixRGB(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface Fog { img: Phaser.GameObjects.Image; vx: number; vy: number; base: number }
interface Drip { img: Phaser.GameObjects.Image; ring: Phaser.GameObjects.Ellipse; x: number; y: number; y1: number; vy: number; state: 'off' | 'fall' | 'ring'; t: number }

/**
 * Iluminación de terror industrial: penumbra densa tintada por sala, charcos de luz bajo las lámparas
 * (que parpadean), haz de linterna del conserje, fuego, disparos, balizas rojas, niebla que solo se
 * ve cerca de la luz y goteras que caen del techo.
 * La penumbra se compone en DOS llamadas por fotograma (rellenos + borrado de luces).
 * Todos los objetos se crean en el constructor (no se replican en multijugador).
 */
export class Lighting {
  rt: Phaser.GameObjects.RenderTexture;
  private lights: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private rects: Phaser.GameObjects.Image[] = [];
  private rectsUsed = 0;
  private beacons: Phaser.GameObjects.Image[] = [];
  private beaconsUsed = 0;
  private fog: Fog[] = [];
  private drips: Drip[] = [];
  private dripT = 1;
  private flicker = new Map<number, number>();
  private t = 0;
  private frame = 0;

  constructor(private w: GameScene) {
    if (!w.textures.exists('__lw')) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 4, 4);
      w.textures.addCanvas('__lw', c);
    }
    this.rt = w.add.renderTexture(0, 0, Math.ceil(WORLD_W * RES), Math.ceil(WORLD_H * RES)).setOrigin(0).setDepth(DEPTH.light).setScale(1 / RES);
    this.rt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    for (let i = 0; i < MAX_BEACONS; i++) {
      this.beacons.push(w.add.image(0, 0, 'fx_glow').setTint(0xff1a30).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow + 0.2).setVisible(false));
    }
    // niebla baja: grandes manchas suaves bajo la penumbra (solo se aprecian junto a la luz)
    for (let i = 0; i < FOG_N; i++) {
      const img = w.add.image(Math.random() * WORLD_W, Math.random() * WORLD_H, 'fx_smoke')
        .setScale(9 + Math.random() * 8, 5 + Math.random() * 4).setDepth(DEPTH.light - 1).setAlpha(0).setTint(0x9fb8b4);
      this.fog.push({ img, vx: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4), vy: (Math.random() - 0.5) * 1.5, base: 0.05 + Math.random() * 0.05 });
    }
    // goteras
    for (let i = 0; i < DRIP_N; i++) {
      const img = w.add.image(0, 0, 'fx_drop').setScale(HD * 0.7, HD * 1.6).setTint(0xa8d4e0).setAlpha(0.85).setDepth(DEPTH.fx).setVisible(false);
      const ring = w.add.ellipse(0, 0, 6, 2.4).setStrokeStyle(0.5, 0xa8d4e0, 0.7).setFillStyle(0x000000, 0).setDepth(DEPTH.wet + 0.1).setVisible(false);
      this.drips.push({ img, ring, x: 0, y: 0, y1: 0, vy: 0, state: 'off', t: 0 });
    }
  }

  /** luz circular o elíptica (sx/sy) y orientada (rot) */
  private light(x: number, y: number, radius: number, strength: number, sx = 1, sy = 1, rot = 0) {
    let img = this.lights[this.used];
    if (!img) {
      img = this.w.make.image({ key: 'fx_light', add: false });
      this.lights.push(img);
    }
    this.used++;
    const k = (radius * 2 * RES) / 128;
    img.setPosition(x * RES, y * RES).setScale(k * sx, k * sy).setRotation(rot).setAlpha(Math.min(1, strength));
  }

  private rect(x: number, y: number, w: number, h: number, color: number, alpha: number) {
    let img = this.rects[this.rectsUsed];
    if (!img) {
      img = this.w.make.image({ key: '__lw', add: false }).setOrigin(0);
      this.rects.push(img);
    }
    this.rectsUsed++;
    img.setPosition(x * RES, y * RES).setDisplaySize(w * RES, h * RES).setTint(color).setAlpha(alpha);
  }

  private beacon(x: number, y: number, alpha: number) {
    const img = this.beacons[this.beaconsUsed];
    if (!img) return;
    this.beaconsUsed++;
    img.setVisible(true).setPosition(x, y).setScale(1.6).setAlpha(alpha);
  }

  private updateFog(dt: number) {
    const w = this.w;
    for (const f of this.fog) {
      const img = f.img;
      img.x += f.vx * dt;
      img.y += f.vy * dt;
      if (img.x < -80) img.x = WORLD_W + 60; else if (img.x > WORLD_W + 80) img.x = -60;
      if (img.y < -40) img.y = WORLD_H + 30; else if (img.y > WORLD_H + 40) img.y = -30;
      const room = w.map.roomAtPx(img.x, img.y);
      const target = room ? f.base * (0.6 + 0.4 * Math.sin(this.t * 0.3 + img.x * 0.01)) : 0;
      img.setAlpha(img.alpha + (target - img.alpha) * Math.min(1, dt * 0.8));
      if (room) img.setTint(mixRGB(0x8aa4a0, ROOM_LIGHT[room as RoomId], 0.35));
    }
  }

  private updateDrips(dt: number) {
    const w = this.w;
    this.dripT -= dt;
    if (this.dripT <= 0 && w.decor) {
      this.dripT = 0.4 + Math.random() * 1.4;
      const d = this.drips.find((x) => x.state === 'off');
      const lamps = w.decor.lamps;
      if (d && lamps.length) {
        // las goteras caen desde la cornisa, cerca de las lámparas (donde se ven)
        const l = lamps[Math.floor(Math.random() * lamps.length)];
        d.x = l.wx + (Math.random() - 0.5) * 40;
        d.y = l.wy - 2;
        d.y1 = l.wy + 14 + Math.random() * 30;
        if (!w.map.isSolidPx(d.x, d.y1)) {
          d.vy = 0;
          d.state = 'fall';
          d.img.setVisible(true).setPosition(d.x, d.y);
        }
      }
    }
    for (const d of this.drips) {
      if (d.state === 'fall') {
        d.vy += 260 * dt;
        d.y += d.vy * dt;
        d.img.setPosition(d.x, d.y);
        if (d.y >= d.y1) {
          d.state = 'ring';
          d.t = 0;
          d.img.setVisible(false);
          d.ring.setVisible(true).setPosition(d.x, d.y1).setScale(0.3);
        }
      } else if (d.state === 'ring') {
        d.t += dt;
        d.ring.setScale(0.3 + d.t * 2.4).setAlpha(Math.max(0, 0.8 - d.t * 1.4));
        if (d.t > 0.55) { d.state = 'off'; d.ring.setVisible(false); }
      }
    }
  }

  update(dt: number) {
    this.t += dt;
    this.updateFog(dt);
    this.updateDrips(dt);
    // 30 Hz es más que suficiente para la luz (salvo en el primer fotograma)
    this.frame++;
    if (this.frame > 2 && this.frame % 2 === 1) return;
    const w = this.w;
    const rt = this.rt;
    this.used = 0;
    this.rectsUsed = 0;
    this.beaconsUsed = 0;
    const night = 0.58;
    const pulse = (Math.sin(this.t * 5) + 1) / 2;
    const calm = w.attract;
    const threat = (w as any).netThreat as Set<RoomId> | undefined;
    for (const room of w.map.rooms) {
      const light = w.ship.roomLight(room.id);
      let a = night + (1 - light) * 0.5;
      if (room.panel?.broken && Math.random() < 0.06) a -= 0.25;
      a = Phaser.Math.Clamp(a, 0, 0.93);
      const x = (room.x - 1) * TILE, y = (room.y - 1) * TILE, rw = (room.w + 2) * TILE, rh = (room.h + 2) * TILE;
      this.rect(x, y, rw, rh, ROOM_TINT[room.id], a);
      // luces de emergencia rojas en salas con peligro
      const danger = threat ? threat.has(room.id) : w.emerg.roomThreat(room.id) > 0;
      if (!calm && danger) {
        this.rect(x, y, rw, rh, 0x6a0010, 0.06 + 0.12 * pulse);
        for (const l of w.decor.lamps) if (l.room === room.id) this.beacon(l.wx, l.wy + 6, 0.12 + 0.3 * pulse);
      }
    }
    for (let i = this.beaconsUsed; i < this.beacons.length; i++) this.beacons[i].setVisible(false);
    // lámparas de pared: punto brillante + charco de luz elíptico en el suelo (con parpadeos)
    w.decor.lamps.forEach((l, i) => {
      const room = w.map.room(l.room);
      let s = 0.62 * w.ship.roomLight(l.room);
      if (room.panel?.broken) s *= Math.random() < 0.15 ? 1 : 0.1;
      let fl = this.flicker.get(i) ?? 0;
      if (fl > 0) { fl -= 1 / 30; s *= Math.random() < 0.5 ? 0.15 : 0.7; }
      else if (Math.random() < 0.0015) fl = 0.15 + Math.random() * 0.5;
      this.flicker.set(i, fl);
      if (s > 0.03) {
        this.light(l.wx, l.wy + 4, 12, Math.min(1, s * 1.2));
        this.light(l.x, l.y + 6, 38, s * 0.8, 1.3, 0.75);
      }
    });
    // linternas de los conserjes: halo propio + haz en la dirección en que apuntan
    const players = w.players && w.players.length ? w.players : [w.player];
    for (const p of players) {
      if (!p || !p.active || p.hidden) continue;
      this.light(p.x, p.y - 6, 30, 0.85);
      const ang = Math.atan2(p.aim.y, p.aim.x);
      this.light(p.x + p.aim.x * 34, p.y - 4 + p.aim.y * 28, 34, 0.75, 1.6, 0.85, ang);
      this.light(p.x + p.aim.x * 66, p.y - 4 + p.aim.y * 54, 28, 0.35, 1.5, 0.9, ang);
    }
    // fuego
    for (const f of w.emerg.fires.values()) this.light(f.tx * TILE + 8, f.ty * TILE + 6, 30 + f.i * 14 + Math.random() * 4, 0.85);
    // aparatos luminosos
    for (const pr of w.map.props) {
      if (pr.kind === 'console' || pr.kind === 'holoTable' || pr.kind === 'tank' || pr.kind === 'vending' || pr.kind === 'medScanner' || pr.kind === 'hydroTank') {
        const room = w.map.room(pr.room);
        if (room.panel?.broken && Math.random() < 0.5) continue;
        this.light(pr.tx * TILE + pr.w * 8, pr.ty * TILE + 2, 18 + pr.w * 4, 0.45);
      } else if (pr.kind === 'reactor') {
        this.light(pr.tx * TILE + 16, pr.ty * TILE + 4, 54, w.emerg.overheating ? 0.95 : 0.7);
      } else if (pr.kind === 'gravityGen' && w.ship.gravity) {
        this.light(pr.tx * TILE + 16, pr.ty * TILE + 8, 28, 0.55);
      }
    }
    // residuos luminosos y criaturas
    let glowCount = 0;
    for (const d of w.dirt.list) {
      if (!d.glow || glowCount > 40) continue;
      glowCount++;
      this.light(d.x, d.y, 12, 0.35 * Math.min(1, d.amount));
    }
    for (const c of w.creatures) if (c.alive && !c.hidden) this.light(c.x, c.y - 6, c.species === 'invasor' ? 12 : 18, 0.45);
    // disparos láser, jefes y gadgets
    for (const b of w.combat.bolts) this.light(b.x, b.y, 18, 0.8);
    if (w.bosses.active) this.light(w.bosses.x, w.bosses.y - 12, 44, 0.6);
    for (const b of w.bots) this.light(b.x, b.y - 3, 10, b.broken ? 0.2 : 0.45);
    for (const s of w.secrets.socks) this.light(s.x, s.y, 8, 0.3);
    // luces que llegan por red (modo invitado)
    const extra = w.extraLights;
    if (extra) for (const e of extra) this.light(e.x, e.y, e.r, e.s);
    // chispas de paneles rotos
    for (const f of w.map.fixtures) {
      if (f.kind === 'panel' && f.broken && Math.random() < 0.4) this.light(f.tx * TILE + 8, f.ty * TILE + 14, 22, 0.8);
    }
    // composición: 1 llamada para la penumbra, 1 para recortar las luces
    rt.clear();
    rt.draw(this.rects.slice(0, this.rectsUsed));
    rt.erase(this.lights.slice(0, this.used));
  }
}
