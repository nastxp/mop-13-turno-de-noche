import Phaser from 'phaser';
import { DEPTH, MAP_W, TILE } from '../config';
import { bus } from '../core/EventBus';
import { clamp } from '../core/util';
import { RESIDUES, type ResidueId } from '../data/residues';
import { HD } from '../gfx/sprites';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export interface Dirt {
  id: number;
  type: ResidueId;
  x: number;
  y: number;
  amount: number;
  room: RoomId | null;
  key: number;
  sprite: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  art: boolean;
  electrified: boolean;
  bornT: number;
  /** esconde una nota del conserje legendario */
  secret?: boolean;
}

export interface Surface {
  slippery: number;
  slow: number;
  conductive: boolean;
  flammable: boolean;
  electrified: boolean;
  tracks: ResidueId | null;
  disgust: number;
  water: number;
  corrosive: boolean;
}

export type RemoveReason = 'player' | 'creature' | 'fire' | 'space' | 'other';

/** residuo tal y como viaja por la red (alta en el invitado) */
export interface NetDirt { id: number; type: ResidueId; x: number; y: number; a: number; fr: number; an: number; fl: 0 | 1; art?: 0 | 1; vx?: number; vy?: number }

const MAX_DIRT = 460;

/** Residuos persistentes: existen físicamente hasta que algo los elimina o transforma. */
export class ContaminationSystem {
  list: Dirt[] = [];
  /** id → residuo (el id es también el identificador de red) */
  byId = new Map<number, Dirt>();
  private grid = new Map<number, Dirt[]>();
  private nextId = 1;
  private cleanCache = new Map<RoomId, number>();
  private cacheT = 0;
  private elecT = 0;
  private wasZeroG = false;

  constructor(private w: GameScene) {}

  private keyOf(x: number, y: number) { return Math.floor(y / TILE) * MAP_W + Math.floor(x / TILE); }

  private bucket(d: Dirt) {
    let a = this.grid.get(d.key);
    if (!a) this.grid.set(d.key, (a = []));
    a.push(d);
  }

  private unbucket(d: Dirt) {
    const a = this.grid.get(d.key);
    if (!a) return;
    const i = a.indexOf(d);
    if (i >= 0) a.splice(i, 1);
  }

  private rekey(d: Dirt) {
    const k = this.keyOf(d.x, d.y);
    if (k !== d.key) {
      this.unbucket(d);
      d.key = k;
      this.bucket(d);
      d.room = this.w.map.roomAtPx(d.x, d.y);
    }
  }

  add(type: ResidueId, x: number, y: number, amount: number, opts: { merge?: boolean; art?: boolean } = {}): Dirt | null {
    // en el invitado la suciedad solo llega del anfitrión
    if (this.w.netRole === 'client') return null;
    const m = this.w.map;
    if (m.isSolidPx(x, y)) {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      let found = false;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1]]) {
        if (m.isWalkable(tx + dx, ty + dy) && m.isFloorish(tx + dx, ty + dy)) {
          const c = m.tileCenter(tx + dx, ty + dy);
          x = c.x + (x - (tx * TILE + 8)) * 0.3;
          y = c.y - 2;
          found = true;
          break;
        }
      }
      if (!found) return null;
    }
    if (opts.merge !== false) {
      const ex = this.near(x, y, type === 'baba' || type === 'huellas' ? 11 : 8).find((d) => d.type === type && !d.art);
      if (ex) {
        ex.amount = Math.min(1.5, ex.amount + amount);
        this.refresh(ex);
        return ex;
      }
    }
    if (this.list.length >= MAX_DIRT) {
      const ex = this.near(x, y, 24).find((d) => d.type === type);
      if (ex) { ex.amount = Math.min(1.5, ex.amount + amount); this.refresh(ex); return ex; }
      return null;
    }
    const def = RESIDUES[type];
    const d = this.create(this.nextId++, type, x, y, Math.min(1.5, amount), Math.floor(Math.random() * 3),
      def.style === 'prints' ? 0 : Math.floor(Math.random() * 4) * 90, Math.random() < 0.5, !!opts.art);
    if (this.w.ship?.zeroG) { d.vx = (Math.random() - 0.5) * 12; d.vy = (Math.random() - 0.5) * 12; }
    bus.emit('dirt:add', d);
    return d;
  }

  /** crea el residuo y sus sprites (los sprites de suciedad nunca se replican: viaja el dato) */
  private create(id: number, type: ResidueId, x: number, y: number, amount: number, frame: number, angle: number, flip: boolean, art: boolean): Dirt {
    const def = RESIDUES[type];
    const { sprite, glow } = this.w.netLocal(() => {
      const sprite = this.w.add.image(Math.round(x), Math.round(y), `dirt_${type}`, frame)
        .setDepth(DEPTH.dirt + (id % 200) / 1000).setAngle(angle).setFlipX(flip);
      const glow = def.glow ? this.w.add.image(x, y, 'fx_glow').setTint(def.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setScale(HD) : undefined;
      return { sprite, glow };
    });
    const d: Dirt = {
      id, type, x, y, amount, room: this.w.map.roomAtPx(x, y), key: this.keyOf(x, y),
      sprite, glow, vx: 0, vy: 0, art, electrified: false, bornT: this.w.t,
    };
    this.list.push(d);
    this.byId.set(id, d);
    this.bucket(d);
    this.refresh(d);
    sprite.setScale(0.2 * HD);
    this.w.tweens.add({ targets: sprite, scale: this.scaleFor(d), duration: 180, ease: 'Back.easeOut' });
    return d;
  }

  /** INVITADO: alta de un residuo recibido del anfitrión */
  netAdd(n: NetDirt) {
    if (this.byId.has(n.id)) return;
    const d = this.create(n.id, n.type, n.x, n.y, n.a, n.fr, n.an, !!n.fl, !!n.art);
    d.vx = n.vx ?? 0; d.vy = n.vy ?? 0;
  }

  /** INVITADO: cambio de cantidad, posición o deriva */
  netUpdate(id: number, x: number, y: number, a: number, vx: number, vy: number) {
    const d = this.byId.get(id);
    if (!d) return;
    d.amount = a; d.vx = vx; d.vy = vy;
    if (Math.abs(d.x - x) > 0.5 || Math.abs(d.y - y) > 0.5) {
      d.x = x; d.y = y;
      d.sprite.setPosition(Math.round(x), Math.round(y));
      d.glow?.setPosition(x, y);
      this.rekey(d);
    }
    this.refresh(d);
    this.cleanCache.clear();
  }

  /** INVITADO: baja de un residuo */
  netRemove(id: number) {
    const d = this.byId.get(id);
    if (d) this.remove(d, 'other');
  }

  private scaleFor(d: Dirt) { return (0.55 + 0.45 * Math.min(1.3, d.amount)) * HD; }

  refresh(d: Dirt) {
    const a = clamp(d.amount, 0, 1.5);
    d.sprite.setAlpha(0.3 + 0.7 * Math.min(1, a));
    if (!this.w.tweens.isTweening(d.sprite)) d.sprite.setScale(this.scaleFor(d));
    if (d.glow) d.glow.setAlpha(0.12 + 0.25 * Math.min(1, a));
  }

  remove(d: Dirt, reason: RemoveReason) {
    const i = this.list.indexOf(d);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.byId.delete(d.id);
    this.unbucket(d);
    d.sprite.destroy();
    d.glow?.destroy();
    if (reason === 'player') {
      this.w.secrets?.onDirtRemoved(d);
      if (this.w.ship?.zeroG) this.w.stats.floatingCollected++;
      const st = this.w.stats;
      st.residuesRemoved++;
      st.removedByType[d.type] = (st.removedByType[d.type] ?? 0) + 1;
    }
    bus.emit('dirt:removed', d, reason);
  }

  near(x: number, y: number, r: number): Dirt[] {
    const out: Dirt[] = [];
    const t0x = Math.floor((x - r) / TILE), t1x = Math.floor((x + r) / TILE);
    const t0y = Math.floor((y - r) / TILE), t1y = Math.floor((y + r) / TILE);
    const r2 = r * r;
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const a = this.grid.get(ty * MAP_W + tx);
        if (!a) continue;
        for (const d of a) if ((d.x - x) ** 2 + (d.y - y) ** 2 <= r2) out.push(d);
      }
    }
    return out;
  }

  surfaceAt(x: number, y: number): Surface {
    const s: Surface = { slippery: 0, slow: 0, conductive: false, flammable: false, electrified: false, tracks: null, disgust: 0, water: 0, corrosive: false };
    for (const d of this.near(x, y, 10)) {
      const def = RESIDUES[d.type];
      const reach = 5 + 4 * Math.min(1, d.amount);
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist > reach) continue;
      const k = Math.min(1, d.amount);
      s.slippery = Math.max(s.slippery, def.slippery * k);
      s.slow = Math.max(s.slow, def.slow * k);
      if (def.conductive && d.amount > 0.25) s.conductive = true;
      if (def.flammable) s.flammable = true;
      if (d.electrified) s.electrified = true;
      if (def.tracks && d.amount > 0.3) s.tracks = d.type;
      s.disgust += def.disgust * k;
      if (d.type === 'agua') s.water += d.amount;
      if (def.corrosive && d.amount > 0.2) s.corrosive = true;
    }
    return s;
  }

  /** Limpieza de una sala en % (100 = impecable). */
  roomClean(room: RoomId): number {
    const c = this.cleanCache.get(room);
    if (c !== undefined) return c;
    let score = 0;
    for (const d of this.list) if (d.room === room) score += RESIDUES[d.type].weight * Math.min(1.2, d.amount);
    score += this.w.combat?.corpseScore(room) ?? 0;
    // curva suave: cada mancha limpiada se nota y una sala con pocas manchas ya ronda el 80-90 %
    const v = 100 * Math.exp(-score / 12);
    this.cleanCache.set(room, v);
    return v;
  }

  invalidate() { this.cleanCache.clear(); }

  globalClean(): number {
    let sum = 0, wsum = 0;
    for (const r of this.w.map.rooms) {
      const wgt = r.id === 'pasillo' ? 0.7 : 1;
      sum += this.roomClean(r.id) * wgt;
      wsum += wgt;
    }
    return sum / wsum;
  }

  /** Residuo más grave que queda (para la evaluación). */
  worst(): Dirt | null {
    let best: Dirt | null = null, bs = 0;
    for (const d of this.list) {
      const s = RESIDUES[d.type].weight * d.amount;
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }

  /** Arrastra residuos hacia un punto (brecha en el casco). */
  pullToward(x: number, y: number, r: number, strength: number, dt: number, room: RoomId) {
    for (const d of this.near(x, y, r)) {
      if (d.room !== room) continue;
      const dx = x - d.x, dy = y - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 11) {
        this.w.fx.gasPuff(d.x, d.y);
        this.remove(d, 'space');
        this.w.stats.expelled++;
        bus.emit('dirt:expelled');
        continue;
      }
      const f = (strength * (1 - dist / r) * dt) / dist;
      const nx = d.x + dx * f, ny = d.y + dy * f;
      if (!this.w.map.isSolidPx(nx, ny)) { d.x = nx; d.y = ny; d.sprite.setPosition(Math.round(nx), Math.round(ny)); d.glow?.setPosition(nx, ny); this.rekey(d); }
    }
  }

  update(dt: number) {
    this.cacheT -= dt;
    if (this.cacheT <= 0) { this.cacheT = 0.5; this.cleanCache.clear(); }
    const zeroG = this.w.ship.zeroG;
    if (zeroG && !this.wasZeroG) {
      for (const d of this.list) { d.vx = (Math.random() - 0.5) * 14; d.vy = (Math.random() - 0.5) * 14; }
    }
    if (!zeroG && this.wasZeroG) {
      for (const d of this.list) { d.vx = 0; d.vy = 0; d.sprite.setPosition(Math.round(d.x), Math.round(d.y)); d.glow?.setPosition(d.x, d.y); }
    }
    this.wasZeroG = zeroG;
    if (zeroG) {
      const t = this.w.t;
      for (const d of this.list) {
        const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
        if (this.w.map.isSolidPx(nx, d.y)) d.vx *= -1; else d.x = nx;
        if (this.w.map.isSolidPx(d.x, ny)) d.vy *= -1; else d.y = ny;
        const bob = Math.sin(t * 2 + d.id) * 3 - 5;
        d.sprite.setPosition(Math.round(d.x), Math.round(d.y + bob));
        d.sprite.setDepth(DEPTH.fx - 1);
        d.glow?.setPosition(d.x, d.y + bob);
        this.rekey(d);
      }
    } else if (this.list.length && this.list[0].sprite.depth === DEPTH.fx - 1) {
      for (const d of this.list) d.sprite.setDepth(DEPTH.dirt + (d.id % 200) / 1000);
    }
    // charcos electrificados junto a paneles rotos
    this.elecT -= dt;
    if (this.elecT <= 0) {
      this.elecT = 0.5;
      for (const d of this.list) d.electrified = false;
      for (const f of this.w.map.fixtures) {
        if (f.kind !== 'panel' || !f.broken) continue;
        const c = this.w.map.tileCenter(f.spot.tx, f.spot.ty);
        for (const d of this.near(c.x, c.y, 44)) if (RESIDUES[d.type].conductive && d.amount > 0.2) d.electrified = true;
      }
    }
    for (const d of this.list) {
      if (d.electrified && Math.random() < dt * 1.2) this.w.fx.sparks(d.x + (Math.random() - 0.5) * 10, d.y - 2, 2);
    }
  }

  destroyAll() {
    for (const d of this.list) { d.sprite.destroy(); d.glow?.destroy(); }
    this.list = [];
    this.byId.clear();
    this.grid.clear();
  }
}
