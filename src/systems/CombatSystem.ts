import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { HD } from '../gfx/sprites';
import { ROOM_NAMES } from '../data/rooms';
import { NPC_LINES } from '../data/lines';
import type { Crew } from '../entities/Crew';
import type { ProfessionId } from '../data/crew';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

interface Bolt { x: number; y: number; vx: number; vy: number; life: number; owner: Crew; sprite: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }

export interface Corpse {
  id: number;
  x: number;
  y: number;
  name: string;
  prof: ProfessionId;
  sprite: Phaser.GameObjects.Sprite;
  carried: boolean;
  room: RoomId | null;
  t: number;
  covered: boolean;
}

/** Combate visible entre seguridad y la fauna alienígena, muertes y cadáveres que retirar. */
export class CombatSystem {
  bolts: Bolt[] = [];
  corpses: Corpse[] = [];
  private nextId = 1;
  private combatRooms = new Set<RoomId>();

  constructor(private w: GameScene) {}

  shoot(from: Crew, tx: number, ty: number) {
    const w = this.w;
    const sx = from.x + (from.facing === 'left' ? -5 : from.facing === 'right' ? 5 : 0), sy = from.y - 7;
    const ang = Math.atan2(ty - sy, tx - sx) + (Math.random() - 0.5) * 0.12;
    const sprite = w.add.image(sx, sy, 'fx_bolt').setScale(HD).setRotation(ang).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
    const glow = w.add.image(sx, sy, 'fx_glow').setScale(0.35).setTint(0x5af0ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setAlpha(0.6);
    this.bolts.push({ x: sx, y: sy, vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260, life: 0.7, owner: from, sprite, glow });
    w.fx.muzzle(sx + Math.cos(ang) * 6, sy + Math.sin(ang) * 6);
    audio.sfx('laser');
    const room = w.map.roomAtPx(from.x, from.y);
    if (room) this.combatRooms.add(room);
    w.stats.shots++;
  }

  private killBolt(i: number) {
    const b = this.bolts[i];
    b.sprite.destroy();
    b.glow.destroy();
    this.bolts.splice(i, 1);
  }

  update(dt: number) {
    const w = this.w;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      let dead = b.life <= 0;
      for (let s = 0; s < 2 && !dead; s++) {
        b.x += b.vx * dt / 2;
        b.y += b.vy * dt / 2;
        for (const c of w.creatures) {
          if (!c.alive || c.hidden) continue;
          if (Math.hypot(c.x - b.x, c.y - 5 - b.y) < 8 * Math.max(1, c.size * 0.8)) {
            const n = Math.hypot(b.vx, b.vy) || 1;
            c.damage(1, 'crew', b.vx / n, b.vy / n, b.owner);
            w.fx.sparks(b.x, b.y, 4);
            dead = true;
            break;
          }
        }
        if (dead) break;
        if (w.bosses.active && w.bosses.hitTest(b.x, b.y)) { w.bosses.hit('bolt', 3); w.fx.sparks(b.x, b.y, 4); dead = true; break; }
        for (const c of w.crew) {
          if (c === b.owner || !c.available || !c.organic) continue;
          if (Math.hypot(c.x - b.x, c.y - 6 - b.y) < 5 && Math.random() < 0.08) {
            c.damage(12, 'combate');
            c.say('¡¡Que soy de los tuyos!!', true);
            dead = true;
            break;
          }
        }
        for (const p of w.players) {
          if (!dead && p.active && !p.dead && Math.hypot(p.x - b.x, p.y - 6 - b.y) < 6 && Math.random() < 0.1) {
            p.hurt(3, 'fuego amigo');
            p.say('¡Eh! ¡Que soy el conserje!', true);
            dead = true;
          }
        }
        if (!dead && w.map.isSolidPx(b.x, b.y + 4)) {
          dead = true;
          w.fx.sparks(b.x, b.y, 6);
          audio.sfx('spark');
          const n = Math.hypot(b.vx, b.vy) || 1;
          const bx = b.x - (b.vx / n) * 6, by = b.y - (b.vy / n) * 6 + 6;
          w.dirt.add('hollin', bx, by, 0.25, { merge: true });
          const tx = Math.floor(b.x / TILE), ty = Math.floor((b.y + 4) / TILE);
          const prop = w.map.inb(tx, ty) ? w.map.propAt[w.map.idx(tx, ty)] : null;
          if (prop && Math.random() < 0.3) {
            w.dirt.add('escombros', bx, by + 2, 0.5);
            if ((prop.kind === 'vending' || prop.kind === 'coffee') && !prop.state.broken && Math.random() < 0.25) {
              prop.state.broken = true;
              prop.sprite?.setFrame(1);
              w.dirt.add(prop.kind === 'coffee' ? 'cafe' : 'comida', bx, by + 6, 0.9);
              w.stats.propsDestroyed++;
            }
          }
        }
      }
      b.sprite.setPosition(b.x, b.y);
      b.glow.setPosition(b.x, b.y);
      if (dead) this.killBolt(i);
    }
    // fin de combates: aviso para empezar a limpiar
    if (this.combatRooms.size && !w.creatures.some((c) => c.alive && c.sp.hostile)) {
      if (w.t - (w.lastInvasionT ?? -99) < 120) w.announce('invasionOver');
      this.combatRooms.clear();
    }
    for (const c of this.corpses) {
      if (c.carried) continue;
      c.t += dt;
      if (!c.covered && c.t > 4) {
        c.covered = true;
        c.sprite.setTexture('fx_bodybag').setAngle(0).setOrigin(0.5, 0.8);
      }
    }
  }

  killCrew(c: Crew, cause: string) {
    const w = this.w;
    const room = c.room();
    c.say(w.rng.pick(NPC_LINES.dying), true);
    c.state = 'dead';
    c.task = null;
    c.releaseSpot();
    c.hidden = true;
    c.sprite.setVisible(false);
    c.shadow.setVisible(false);
    c.emote.setVisible(false);
    c.cup.setVisible(false);
    w.stats.deaths++;
    w.stats.deathNames.push(c.name);
    if (c.organic) {
      w.dirt.add('sangre', c.x, c.y + 3, 1);
      w.dirt.add('sangre', c.x + (Math.random() - 0.5) * 14, c.y + 6, 0.5);
    }
    const sprite = w.add.sprite(c.x, c.y - 2, `char_${c.prof}`, 9).setScale(HD).setAngle(90).setDepth(sortDepth(c.y) - 0.002);
    const corpse: Corpse = { id: this.nextId++, x: c.x, y: c.y, name: c.name, prof: c.prof, sprite, carried: false, room, t: 0, covered: false };
    this.corpses.push(corpse);
    const ghost = w.add.image(c.x, c.y - 10, 'fx_ghost').setScale(HD).setDepth(DEPTH.overlay).setAlpha(0.85);
    w.tweens.add({ targets: ghost, y: c.y - 46, alpha: 0, duration: 2600, ease: 'Sine.easeOut', onComplete: () => ghost.destroy() });
    audio.sfx('death');
    for (const o of w.crew) if (o !== c && o.available && Math.hypot(o.x - c.x, o.y - c.y) < 80) { o.fear += 30; o.remember('death'); }
    w.announce('corpse', {}, { room: room ?? 'pasillo' });
    w.stats.story.push(`${c.name} cayó en ${ROOM_NAMES[room ?? 'pasillo']} (${cause})`);
    bus.emit('npc:dead', c, cause);
    w.time.delayedCall(60000, () => { if (!w.over) w.spawnReplacement(c.prof); });
  }

  corpseNear(x: number, y: number, r = 16): Corpse | null {
    let best: Corpse | null = null, bd = r;
    for (const c of this.corpses) {
      if (c.carried) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  pickUp(c: Corpse) {
    c.carried = true;
    c.sprite.setVisible(false);
  }

  deliver(c: Corpse) {
    const i = this.corpses.indexOf(c);
    if (i >= 0) this.corpses.splice(i, 1);
    c.sprite.destroy();
    this.w.stats.bodiesRecovered++;
    this.w.announce('bodyDelivered');
    audio.sfx('ok');
  }

  dropAt(c: Corpse, x: number, y: number) {
    c.carried = false;
    c.x = x; c.y = y;
    c.room = this.w.map.roomAtPx(x, y);
    c.sprite.setVisible(true).setPosition(x, y - 2).setDepth(sortDepth(y) - 0.002);
  }

  /** penalización de limpieza de los cuerpos sin retirar en una sala */
  corpseScore(room: RoomId): number {
    let s = 0;
    for (const c of this.corpses) if (!c.carried && c.room === room) s += 3;
    return s;
  }

  destroyAll() {
    for (const b of this.bolts) { b.sprite.destroy(); b.glow.destroy(); }
    for (const c of this.corpses) c.sprite.destroy();
    this.bolts = [];
    this.corpses = [];
  }
}
