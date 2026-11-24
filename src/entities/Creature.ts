import Phaser from 'phaser';
import { sortDepth, TILE } from '../config';
import { Actor } from './Actor';
import { audio } from '../systems/AudioManager';
import { bus } from '../core/EventBus';
import { norm } from '../core/util';
import { HD } from '../gfx/sprites';
import { RESIDUES, type ResidueId } from '../data/residues';
import type { Dirt } from '../systems/ContaminationSystem';
import type { Prop, Fixture } from '../world/ShipMap';
import type { GameScene } from '../scenes/GameScene';
import type { Crew } from './Crew';
import type { Player } from './Player';

export type SpeciesId = 'glorp' | 'invasor' | 'babosa' | 'rata' | 'insecto' | 'rogue';

interface SpeciesDef {
  name: string;
  tex: string;
  fw: number;
  hp: number;
  speed: number;
  hostile: boolean;
  eats: boolean;
  trail?: ResidueId;
  trailDist: number;
  flees: boolean;
  /** se puede capturar con la aspiradora sin aturdir */
  smallCapture: boolean;
  trap: boolean;
  deathDirt: ResidueId[];
  label: string;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  glorp: { name: 'Glorp', tex: 'glorp', fw: 32, hp: 3, speed: 30, hostile: false, eats: true, trail: 'baba', trailDist: 30, flees: true, smallCapture: false, trap: true, deathDirt: ['baba'], label: 'Criatura alienígena' },
  invasor: { name: 'Rasgador', tex: 'invasor', fw: 32, hp: 4, speed: 58, hostile: true, eats: false, trailDist: 0, flees: false, smallCapture: false, trap: false, deathDirt: ['acido', 'restos'], label: 'Rasgador hostil' },
  babosa: { name: 'Babosa gigante', tex: 'babosa', fw: 40, hp: 6, speed: 16, hostile: false, eats: true, trail: 'baba', trailDist: 12, flees: false, smallCapture: false, trap: false, deathDirt: ['baba', 'restos'], label: 'Babosa gigante' },
  rata: { name: 'Roedor de chatarra', tex: 'rata', fw: 24, hp: 2, speed: 62, hostile: false, eats: true, trailDist: 0, flees: true, smallCapture: true, trap: true, deathDirt: ['sangre'], label: 'Roedor de chatarra' },
  insecto: { name: 'Insecto devoracables', tex: 'insecto', fw: 16, hp: 1, speed: 44, hostile: false, eats: false, trailDist: 0, flees: false, smallCapture: true, trap: true, deathDirt: ['restos'], label: 'Enjambre de insectos' },
  rogue: { name: 'Aspiradora rebelde', tex: 'rogue', fw: 24, hp: 3, speed: 40, hostile: true, eats: false, trailDist: 0, flees: false, smallCapture: false, trap: false, deathDirt: ['escombros', 'polvo'], label: 'Aspiradora rebelde' },
};

/** daño al conserje, daño a la tripulación, recarga entre mordiscos, embestida y segundos de rabia al ser atacado */
const ATTACK: Record<SpeciesId, { dmg: number; crew: number; cd: number; lunge: boolean; rage: number; verb: string }> = {
  glorp: { dmg: 6, crew: 12, cd: 1.15, lunge: true, rage: 10, verb: 'placaje de glorp' },
  invasor: { dmg: 8, crew: 16, cd: 0.9, lunge: true, rage: 14, verb: 'zarpazo de rasgador' },
  babosa: { dmg: 7, crew: 14, cd: 1.5, lunge: false, rage: 12, verb: 'babosa furiosa' },
  rata: { dmg: 4, crew: 8, cd: 0.6, lunge: true, rage: 8, verb: 'mordisco de rata' },
  insecto: { dmg: 2, crew: 4, cd: 0.45, lunge: false, rage: 9, verb: 'picadura' },
  rogue: { dmg: 5, crew: 12, cd: 1, lunge: true, rage: 12, verb: 'embestida de aspiradora' },
};

type CState = 'emerge' | 'wander' | 'seek' | 'eat' | 'flee' | 'chase' | 'chew' | 'hiding' | 'escape' | 'captured' | 'dying' | 'gone';

/** Fauna alienígena y robots hostiles: cada especie con su comportamiento y sus debilidades. */
export class Creature extends Actor {
  sp: SpeciesDef;
  size: number;
  hp: number;
  state: CState = 'emerge';
  stateT = 0;
  path: { tx: number; ty: number }[] = [];
  pathI = 0;
  foamT = 0;
  freezeT = 0;
  noticed = false;
  slimeDist = 0;
  waterT = 0;
  biteCd = 0;
  /** furia tras recibir daño: persigue a su agresor sin huir */
  rageT = 0;
  rageTarget: Player | Crew | null = null;
  lungeT = 0;
  lungeCd = 0;
  spitCd = 0;
  thinkT = 0;
  eatTarget: Dirt | null = null;
  hideProp: Prop | null = null;
  chaseTarget: Player | Crew | null = null;
  chewTarget: Fixture | null = null;
  coat: Phaser.GameObjects.Image;
  bornAt: number;
  origin: string;
  /** dueño para la recompensa (soldado, conserje…) */
  lastHitBy: 'player' | 'crew' | 'other' = 'other';
  foamMul = 1;

  constructor(w: GameScene, public species: SpeciesId, x: number, y: number, size = 1, origin = 'la ventilación') {
    super(w, SPECIES[species].tex, x, y);
    this.sp = SPECIES[species];
    this.size = size;
    this.hp = Math.ceil(this.sp.hp * (species === 'glorp' ? 1 : size));
    this.origin = origin;
    this.label = this.sp.name;
    this.bornAt = w.t;
    this.coat = w.add.image(x, y, 'fx_foamcoat').setOrigin(0.5, 1).setVisible(false).setScale(HD);
    this.sprite.setScale(0.05);
    this.shadow.setSize(this.sp.fw * 0.4, 4);
    this.foamMul = w.memoryFoamResist ? 0.5 : 1;
    if (species !== 'glorp' && species !== 'babosa') { this.state = 'wander'; this.sprite.setScale(this.displayScale()); }
  }

  get alive() { return this.state !== 'captured' && this.state !== 'gone' && this.state !== 'dying'; }
  get aggressive() { return this.sp.hostile || (this.species === 'glorp' && this.size >= 1.45) || this.rageT > 0; }
  get stunned() { return this.foamT > 0 || this.stunT > 0 || this.freezeT > 0; }
  tile() { return { tx: Math.floor(this.x / TILE), ty: Math.floor(this.y / TILE) }; }

  displayScale() {
    if (this.species === 'glorp') return (this.size < 0.85 ? 0.75 : this.size < 1.45 ? 1 : this.size < 2.1 ? 1.5 : 2) * HD;
    return HD * Math.max(0.75, Math.min(1.6, this.size));
  }

  private goTo(tx: number, ty: number): boolean {
    const s = this.tile();
    const p = this.w.nav.findPath(s.tx, s.ty, tx, ty, { maxNodes: 1800 });
    if (!p) return false;
    this.path = p;
    this.pathI = 0;
    return true;
  }

  private follow(dt: number, speed: number): boolean {
    if (this.pathI >= this.path.length) { this.moving = false; return true; }
    const n = this.path[this.pathI];
    if (!this.w.map.isWalkable(n.tx, n.ty)) { this.path = []; return true; }
    const c = this.w.map.tileCenter(n.tx, n.ty);
    const d = norm(c.x - this.x, c.y - this.y);
    if (d.len < 2.5) { this.pathI++; return this.pathI >= this.path.length; }
    this.vx += (d.x * speed - this.vx) * Math.min(1, 10 * dt);
    this.vy += (d.y * speed - this.vy) * Math.min(1, 10 * dt);
    const pull = this.w.emerg.pullAt(this.x, this.y, this);
    this.move((this.vx + pull.x) * dt, (this.vy + pull.y) * dt);
    this.moving = true;
    const surf = this.w.dirt.surfaceAt(this.x, this.y);
    const wet = this.w.cleaning.wetAt(this.x, this.y);
    const slip = Math.max(surf.slippery, wet * 0.6);
    if (speed > 40 && slip > 0.3 && this.species !== 'insecto' && Math.random() < slip * 1.6 * dt) {
      this.stunT = 1.8;
      this.setEmote('dizzy', 1.8);
      audio.sfx('slip');
      this.w.floatText(this.x, this.y - 20, '¡Resbalón!', 'good');
      this.w.stats.creatureSlips++;
      bus.emit('creature:slip', this, wet > surf.slippery);
    }
    return false;
  }

  private nearestProp(kinds: string[], maxD: number): Prop | null {
    let best: Prop | null = null, bd = maxD;
    for (const p of this.w.map.props) {
      if (!kinds.includes(p.kind) || !p.spots.length) continue;
      if (p.kind === 'toilet' && p.state.sealedT > this.w.t) continue;
      const c = this.w.map.tileCenter(p.tx, p.ty);
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** daño genérico (fregona, disparos, ácido…) */
  damage(n: number, from: 'player' | 'crew' | 'other', kx = 0, ky = 0, by: Player | Crew | null = null) {
    if (!this.alive || this.state === 'hiding' || this.state === 'emerge') return;
    this.hp -= n;
    this.lastHitBy = from;
    // reacción breve: un respingo, no un empujón que la aleje de la pelea
    this.stunT = Math.max(this.stunT, this.species === 'babosa' ? 0.1 : 0.2);
    if (kx || ky) { this.vx = kx * 50; this.vy = ky * 50; this.move(kx * 1.5, ky * 1.5); }
    this.sprite.setTintFill(0xffffff);
    this.w.time.delayedCall(70, () => this.sprite.clearTint());
    audio.sfx('squish');
    if (this.species === 'invasor' || this.species === 'glorp') this.w.dirt.add(this.species === 'invasor' ? 'acido' : 'baba', this.x + (Math.random() - 0.5) * 8, this.y + 2, 0.35);
    bus.emit('creature:hit', this, from);
    if (this.hp <= 0) {
      if (this.species === 'glorp' && from === 'player') {
        this.state = 'escape';
        const v = this.nearestProp(['vent', 'toilet'], 9999);
        if (v) this.goTo(v.spots[0].tx, v.spots[0].ty);
      } else this.die();
    } else if (from !== 'other') this.provoke(from, by);
  }

  /** ¿sigue siendo una presa alcanzable? */
  private validTarget(t: Player | Crew | null): t is Player | Crew {
    if (!t) return false;
    if (this.w.players.includes(t as Player)) { const p = t as Player; return p.active && !p.dead; }
    const c = t as Crew;
    return c.available && !c.hidden;
  }

  /** contraataque: quien le hace daño (o le rocía) pasa a ser su presa durante un rato */
  provoke(from: 'player' | 'crew', by: Player | Crew | null = null) {
    if (!this.alive || this.state === 'escape') return;
    const w = this.w;
    let t: Player | Crew | null = by;
    if (!t && from === 'player') t = w.nearestPlayer(this.x, this.y).p;
    if (!t && from === 'crew') {
      let bd = 260;
      for (const c of w.crew) {
        if (!c.available || c.hidden) continue;
        const d = Math.hypot(c.x - this.x, c.y - this.y) * (c.arch.role === 'combate' ? 0.5 : 1);
        if (d < bd) { bd = d; t = c; }
      }
    }
    if (!this.validTarget(t)) return;
    const calm = this.rageT <= 0;
    const atk = ATTACK[this.species];
    this.rageT = Math.max(this.rageT, atk.rage + Math.max(this.freezeT, this.foamT));
    this.rageTarget = t;
    this.chaseTarget = t;
    this.noticed = true;
    this.thinkT = Math.min(this.thinkT, 0.05);
    if (this.state === 'flee' || this.state === 'eat' || this.state === 'seek' || this.state === 'chew') { this.state = 'wander'; this.path = []; this.pathI = 0; }
    if (calm) {
      this.setEmote('anger', 1.5);
      audio.sfx('alien');
      // los insectos atacan en enjambre
      if (this.species === 'insecto') for (const o of w.creatures) {
        if (o !== this && o.species === 'insecto' && o.alive && o.rageT <= 0 && Math.hypot(o.x - this.x, o.y - this.y) < 90) { o.rageT = atk.rage; o.rageTarget = t; o.chaseTarget = t; o.thinkT = 0; }
      }
    }
  }

  whack(fromX: number, fromY: number) {
    const d = norm(this.x - fromX, this.y - fromY);
    const mopDmg = this.species === 'babosa' ? 0.5 : 1;
    this.damage(mopDmg, 'player', this.species === 'babosa' ? 0 : d.x, this.species === 'babosa' ? 0 : d.y, this.w.nearestPlayer(fromX, fromY).p);
    if (this.alive) this.setEmote('anger', 1.2);
    if (this.alive && this.w.spec === 'plagas') this.stunT = Math.max(this.stunT, 1.4);
  }

  foam(amount: number, byPlayer = false) {
    if (!this.alive || this.state === 'hiding') return;
    this.foamT = Math.min(6 * this.foamMul, this.foamT + amount * this.foamMul);
    if (this.species === 'insecto') { this.die(); return; }
    if (byPlayer) this.provoke('player');
  }

  freeze(amount: number, byPlayer = false) {
    if (!this.alive || this.state === 'hiding') return;
    this.freezeT = Math.min(7, this.freezeT + amount);
    if (byPlayer) this.provoke('player');
  }

  disinfect(amount: number) {
    if (!this.alive) return;
    if (this.species === 'insecto') { this.die(); return; }
    if (this.species === 'babosa') { this.damage(amount * 1.5, 'player'); return; }
    this.provoke('player');
    if (this.species === 'glorp') this.setEmote('disgust', 1);
  }

  capture(nx: number, ny: number) {
    if (!this.alive) return;
    this.state = 'captured';
    this.emote.setVisible(false);
    this.coat.setVisible(false);
    audio.sfx('capture');
    this.w.tweens.add({ targets: this.sprite, x: nx, y: ny, scale: 0, duration: 350, ease: 'Quad.easeIn', onComplete: () => this.sprite.setVisible(false) });
    this.shadow.setVisible(false);
    bus.emit('creature:captured', this);
  }

  /** muerte con restos en el suelo (para el conserje) */
  die() {
    if (this.state === 'dying' || this.state === 'gone' || this.state === 'captured') return;
    const w = this.w;
    this.state = 'dying';
    this.stateT = 0;
    this.moving = false;
    this.coat.setVisible(false);
    this.emote.setVisible(false);
    if (this.species === 'invasor') this.sprite.setFrame(5);
    audio.sfx(this.species === 'rogue' ? 'break' : 'squish');
    w.fx.splash(this.x, this.y - 4, this.species === 'invasor' ? 0xc8f03a : this.species === 'rogue' ? 0xc8d0e0 : 0x5df2a6);
    for (const r of this.sp.deathDirt) w.dirt.add(r, this.x + (Math.random() - 0.5) * 10, this.y + (Math.random() - 0.5) * 6, 0.8 * Math.max(0.6, this.size));
    if (this.species === 'invasor') w.dirt.add('acido', this.x + 8, this.y + 4, 0.6);
    bus.emit('creature:killed', this);
  }

  private split() {
    const w = this.w;
    if (w.creatures.filter((c) => c.alive && c.species === 'glorp').length >= 4) return;
    this.size *= 0.72;
    this.waterT = 0;
    const c = w.spawnCreature('glorp', this.x + 10, this.y, this.size, 'una gota de agua', true);
    c.state = 'wander';
    c.sprite.setScale(c.displayScale());
    audio.sfx('alien');
    bus.emit('creature:split', this);
  }

  private pickTarget(range: number): Player | Crew | null {
    const w = this.w;
    if (this.rageT > 0 && this.validTarget(this.rageTarget)) return this.rageTarget;
    let best: Player | Crew | null = null, bd = range;
    // los Rasgadores no consideran al conserje una amenaza… salvo que les dé con la fregona
    const provoked = this.species !== 'invasor' || this.lastHitBy === 'player';
    if (provoked) {
      for (const p of w.players) {
        if (!p.active || p.dead) continue;
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        if (d < (this.species === 'invasor' ? Math.min(60, bd) : bd)) { bd = d; best = p; }
      }
    }
    for (const c of w.crew) {
      if (!c.available || c.hidden || c.prof === 'robot') continue;
      let d = Math.hypot(c.x - this.x, c.y - this.y);
      if (this.species === 'invasor' && c.arch.role === 'combate') d *= 0.6;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  update(dt: number) {
    const w = this.w;
    if (this.state === 'gone' || this.state === 'captured') { this.coat.setVisible(false); return; }
    this.stateT += dt;
    this.biteCd -= dt;
    this.thinkT -= dt;
    this.lungeCd -= dt;
    this.spitCd -= dt;
    if (this.rageT > 0) {
      this.rageT -= dt;
      if (this.rageT <= 0 || !this.validTarget(this.rageTarget)) { this.rageT = 0; this.rageTarget = null; }
    }

    if (this.state === 'dying') {
      this.sprite.setAlpha(Math.max(0, 1 - Math.max(0, this.stateT - 1.5) / 1.2));
      if (this.stateT > 2.8) { this.state = 'gone'; this.sprite.setVisible(false); this.shadow.setVisible(false); }
      this.updateSprite(dt);
      if (this.species === 'invasor') this.sprite.setFrame(5);
      return;
    }

    if (this.state === 'hiding') {
      this.hidden = true;
      this.coat.setVisible(false);
      if (this.stateT > 7) {
        const candidates = w.map.props.filter((p) => (p.kind === 'vent' || p.kind === 'toilet') && p !== this.hideProp && p.spots.length && !(p.state.sealedT > w.t));
        if (!candidates.length) { this.stateT = 4; this.updateSprite(dt); return; }
        const p = w.rng.pick(candidates);
        const s = p.spots[0];
        const c = w.map.tileCenter(s.tx, s.ty);
        this.x = c.x; this.y = c.y;
        this.hidden = false;
        this.state = 'emerge';
        this.stateT = 0;
        this.sprite.setScale(0.05);
        if (p.kind === 'toilet') audio.sfx('flush');
        w.fx.splash(this.x, this.y, 0x5df2a6);
        bus.emit('creature:reappear', this, p);
      }
      this.updateSprite(dt);
      return;
    }

    const scaleTarget = this.displayScale();
    if (this.state === 'emerge') {
      this.sprite.setScale(Math.min(scaleTarget, 0.05 + this.stateT * 1.4 * HD));
      if (this.stateT > 0.8) { this.state = 'wander'; this.stateT = 0; }
      this.updateSprite(dt);
      this.setFrame();
      return;
    }
    this.sprite.setScale(scaleTarget);
    if (this.species === 'glorp') {
      const key = this.aggressive ? 'glorp_big' : 'glorp';
      if (this.sprite.texture.key !== key) this.sprite.setTexture(key, 0);
    }

    // inmovilizado (espuma o hielo)
    if (this.foamT > 0 || this.freezeT > 0) {
      const frozen = this.freezeT > 0;
      if (frozen) this.freezeT -= dt; else this.foamT -= dt;
      this.moving = false;
      this.vx = 0; this.vy = 0;
      if (this.coat.texture.key !== (frozen ? 'fx_icecoat' : 'fx_foamcoat')) this.coat.setTexture(frozen ? 'fx_icecoat' : 'fx_foamcoat');
      this.coat.setVisible(true).setPosition(Math.round(this.x), Math.round(this.y + 1)).setDepth(sortDepth(this.y) + 0.002).setScale(scaleTarget * (this.sp.fw / 32));
      this.updateSprite(dt);
      this.setFrame();
      return;
    }
    this.coat.setVisible(false);
    if (this.stunT > 0) {
      this.stunT -= dt;
      const damp = Math.max(0, 1 - dt * 6);
      this.vx *= damp; this.vy *= damp;
      this.move(this.vx * dt, this.vy * dt);
      this.updateSprite(dt);
      this.setFrame();
      return;
    }

    const dp = w.nearestPlayer(this.x, this.y).d;
    if (!this.noticed && dp < 75) {
      this.noticed = true;
      this.setEmote('alert', 1.2);
      audio.sfx('alien');
      bus.emit('creature:noticed', this);
    }

    if (this.thinkT <= 0 && this.state !== 'escape') {
      this.thinkT = this.rageT > 0 ? 0.3 : 0.5;
      this.think(dp);
    }

    const speed = this.sp.speed / Math.pow(Math.max(0.6, this.size), 0.3) * (w.dirt.surfaceAt(this.x, this.y).slow > 0.3 && this.species !== 'glorp' && this.species !== 'babosa' ? 0.5 : 1);
    switch (this.state) {
      case 'wander': this.follow(dt, speed * 0.75); break;
      case 'seek': {
        const arrived = this.follow(dt, speed);
        const t = this.eatTarget;
        if (!t || t.amount <= 0 || !w.dirt.list.includes(t)) { this.state = 'wander'; this.eatTarget = null; break; }
        if (arrived || Math.hypot(t.x - this.x, t.y - this.y) < 9) { this.state = 'eat'; this.stateT = 0; }
        break;
      }
      case 'eat': {
        const t = this.eatTarget;
        this.moving = false;
        this.acting = true;
        if (!t || !w.dirt.list.includes(t)) { this.state = 'wander'; break; }
        t.amount -= (this.species === 'rata' ? 0.9 : 0.5) * dt;
        w.dirt.refresh(t);
        if (Math.random() < dt * 3) w.fx.crumbs(t.x, t.y);
        if (t.amount <= 0.03) {
          const food = Math.max(0.3, RESIDUES[t.type].food);
          w.dirt.remove(t, 'creature');
          if (this.species === 'glorp') this.size = Math.min(2, this.size + 0.09 * food);
          this.eatTarget = null;
          this.state = 'wander';
          audio.sfx('gulp');
          bus.emit('creature:ate', this);
        }
        break;
      }
      case 'chew': {
        const f = this.chewTarget;
        this.moving = false;
        if (!f || f.broken) { this.state = 'wander'; this.chewTarget = null; break; }
        if (Math.random() < dt * 4) w.fx.sparks(this.x, this.y - 6, 2);
        if (this.stateT > 6) {
          w.emerg.breakPanel(f, 'insectos devorando el cableado', false);
          w.dirt.add('cables', this.x, this.y + 3, 0.8);
          this.state = 'wander';
          this.chewTarget = null;
        }
        break;
      }
      case 'flee': {
        const arrived = this.follow(dt, speed * 1.6);
        if (arrived && this.hideProp && (this.species === 'glorp' || this.species === 'rata')) {
          const c = w.map.tileCenter(this.hideProp.tx, this.hideProp.ty);
          if (Math.hypot(c.x - this.x, c.y - this.y) < 26) {
            this.state = 'hiding';
            this.stateT = 0;
            this.hidden = true;
            if (this.hideProp.kind === 'toilet') audio.sfx('flush');
            bus.emit('creature:hide', this, this.hideProp);
          } else this.state = 'wander';
        } else if (arrived) this.state = 'wander';
        break;
      }
      case 'chase': {
        const tgt = this.chaseTarget;
        if (!this.validTarget(tgt)) { this.state = 'wander'; break; }
        const atk = ATTACK[this.species];
        const enraged = this.rageT > 0;
        const dx = tgt.x - this.x, dy = tgt.y - this.y, dist = Math.hypot(dx, dy);
        const n = norm(dx, dy);
        const sp = speed * (enraged ? (this.species === 'babosa' ? 2.4 : 1.35) : 1.1);
        if (this.lungeT > 0) {
          // embestida: carrera recta hacia la presa
          this.lungeT -= dt;
          this.move(this.vx * dt, this.vy * dt);
          this.moving = true;
          this.acting = true;
        } else if (dist < 42) {
          // cuerpo a cuerpo: va directa, sin ruta, y a veces se lanza
          this.vx += (n.x * sp - this.vx) * Math.min(1, 10 * dt);
          this.vy += (n.y * sp - this.vy) * Math.min(1, 10 * dt);
          this.move(this.vx * dt, this.vy * dt);
          this.moving = true;
          if (atk.lunge && this.lungeCd <= 0 && dist > 12 && dist < 36) {
            this.lungeT = 0.2;
            this.lungeCd = 1.3 + Math.random() * 0.9;
            this.vx = n.x * (sp * 2.6 + 70);
            this.vy = n.y * (sp * 2.6 + 70);
            this.setEmote('anger', 0.6);
          }
        } else this.follow(dt, sp);
        const reach = (this.species === 'invasor' ? 15 : this.species === 'insecto' ? 9 : 13) * Math.max(1, this.size * 0.8);
        if (this.biteCd <= 0 && dist < reach) {
          const big = this.species === 'glorp' && this.size >= 1.45 ? 1.4 : 1;
          this.biteCd = atk.cd;
          this.lungeT = 0;
          this.acting = true;
          audio.sfx('bite');
          w.fx.splash(tgt.x, tgt.y - 6, 0xff4d5a);
          if (w.players.includes(tgt as Player)) (tgt as Player).hurt(Math.round(atk.dmg * big), atk.verb);
          else (tgt as Crew).damage(atk.crew * big, this.species === 'invasor' ? 'combate' : 'mordisco');
          // la presa sale despedida un poco y la criatura rebota para volver a la carga
          tgt.vx += n.x * 70; tgt.vy += n.y * 70;
          this.vx = -n.x * 45; this.vy = -n.y * 45;
          if (this.species === 'babosa') w.dirt.add('baba', tgt.x, tgt.y + 2, 0.3);
          if (this.species === 'invasor' && Math.random() < 0.4) w.dirt.add('acido', tgt.x + (Math.random() - 0.5) * 8, tgt.y + 3, 0.25);
        }
        // la babosa enfadada escupe baba a distancia
        if (this.species === 'babosa' && enraged && this.spitCd <= 0 && dist > 24 && dist < 95) {
          this.spitCd = 2.4 + Math.random();
          this.acting = true;
          const tx = tgt.x, ty = tgt.y;
          w.fx.splash(this.x + n.x * 8, this.y - 4 + n.y * 8, 0xc8d84a);
          audio.sfx('squish');
          w.time.delayedCall(280, () => {
            if (!this.alive) return;
            w.dirt.add('baba', tx, ty + 2, 0.45);
            w.fx.splash(tx, ty - 4, 0xc8d84a);
            if (this.validTarget(tgt) && Math.hypot(tgt.x - tx, tgt.y - ty) < 14) {
              if (w.players.includes(tgt as Player)) (tgt as Player).hurt(4, 'escupitajo de babosa');
              else (tgt as Crew).damage(6, 'mordisco');
            }
          });
        }
        if (!enraged && dist >= 42 && this.pathI >= this.path.length) this.state = 'wander';
        break;
      }
      case 'escape': {
        if (this.follow(dt, 70)) {
          this.state = 'gone';
          this.sprite.setVisible(false);
          this.shadow.setVisible(false);
          this.emote.setVisible(false);
          audio.sfx('flush');
          bus.emit('creature:fled', this);
          return;
        }
        break;
      }
    }

    // rastro viscoso
    if (this.moving && this.sp.trail) {
      this.slimeDist += Math.hypot(this.vx, this.vy) * dt;
      if (this.slimeDist > this.sp.trailDist) {
        this.slimeDist = 0;
        w.dirt.add(this.sp.trail, this.x, this.y + 1, (this.species === 'babosa' ? 0.4 : 0.16) * this.size, { merge: true });
      }
    }
    // agua: los Glorps se dividen; las aspiradoras rebeldes hacen cortocircuito
    const s = w.dirt.surfaceAt(this.x, this.y);
    if (this.species === 'glorp' && s.water > 0.25 && this.size >= 0.75) {
      this.waterT += dt;
      if (this.waterT > 2.2) this.split();
    } else if (this.species === 'rogue' && s.conductive) {
      w.fx.zap(this.x, this.y - 6);
      audio.sfx('zap');
      this.damage(3, 'other');
    } else this.waterT = Math.max(0, this.waterT - dt);
    // ácido: los cadáveres de Rasgador corroen
    this.updateSprite(dt);
    this.setFrame();
  }

  private think(dp: number) {
    const w = this.w;
    const p = w.nearestPlayer(this.x, this.y).p ?? w.player;
    // hostiles: cazan a la tripulación (y al conserje si se acerca)
    if (this.aggressive) {
      const tgt = this.pickTarget(this.species === 'invasor' ? 170 : 110) ?? (this.species === 'invasor' ? this.pickTarget(520) : null);
      if (tgt) {
        this.chaseTarget = tgt;
        if (this.state !== 'chase' || this.pathI >= this.path.length || w.rng.chance(0.5)) {
          if (this.goTo(Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE))) this.state = 'chase';
        }
        return;
      }
    }
    // insectos: buscan cables
    if (this.species === 'insecto' && this.state !== 'chew') {
      let best: Fixture | null = null, bd = 400;
      for (const f of w.map.fixtures) {
        if (f.kind !== 'panel' || f.broken) continue;
        const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        const c = w.map.tileCenter(best.spot.tx, best.spot.ty);
        if (Math.hypot(c.x - this.x, c.y - this.y) < 12) { this.state = 'chew'; this.chewTarget = best; this.stateT = 0; return; }
        if (this.pathI >= this.path.length || this.state !== 'seek') { this.goTo(best.spot.tx, best.spot.ty); this.state = 'wander'; }
        return;
      }
    }
    // huir del conserje
    if (this.sp.flees && this.rageT <= 0 && dp < (this.species === 'rata' ? 60 : 52) && this.state !== 'flee') {
      const hide = this.nearestProp(['vent', 'toilet'], 90);
      if (hide && w.rng.chance(0.6)) {
        this.hideProp = hide;
        const s = hide.spots[0];
        if (this.goTo(s.tx, s.ty)) { this.state = 'flee'; this.stateT = 0; }
      } else {
        const away = norm(this.x - p.x, this.y - p.y);
        const tx = Math.floor((this.x + away.x * 70) / TILE), ty = Math.floor((this.y + away.y * 70) / TILE);
        const room = w.map.roomAtPx(this.x, this.y) ?? 'pasillo';
        const tiles = w.map.room(room).floorTiles;
        let best = tiles[0], bd = 1e9;
        for (const t of tiles) { const d = (t.tx - tx) ** 2 + (t.ty - ty) ** 2; if (d < bd) { bd = d; best = t; } }
        this.hideProp = null;
        if (best && this.goTo(best.tx, best.ty)) { this.state = 'flee'; this.stateT = 0; }
      }
      this.setEmote('fear', 1);
      return;
    }
    if (this.state === 'wander' || (this.state === 'flee' && this.pathI >= this.path.length)) {
      if (this.sp.eats) {
        let best: Dirt | null = null, bd = 150;
        for (const d of w.dirt.near(this.x, this.y, 150)) {
          const def = RESIDUES[d.type];
          const f = this.species === 'babosa' ? 1 : this.species === 'rata' ? (d.type === 'basura' || d.type === 'comida' || d.type === 'restos' ? 1.5 : 0) : def.food;
          if (f <= 0) continue;
          const dd = Math.hypot(d.x - this.x, d.y - this.y) / f;
          if (dd < bd) { bd = dd; best = d; }
        }
        if (best) {
          this.eatTarget = best;
          if (this.goTo(Math.floor(best.x / TILE), Math.floor(best.y / TILE))) { this.state = 'seek'; return; }
        }
        // ratas: tumban papeleras llenas
        if (this.species === 'rata') {
          const bin = w.map.props.find((b) => b.kind === 'bin' && (b.state.fill ?? 0) > 30 && Math.hypot(b.tx * 16 - this.x, b.ty * 16 - this.y) < 120);
          if (bin && w.rng.chance(0.3)) {
            bin.state.fill = 0;
            bin.sprite?.setFrame(0);
            for (let i = 0; i < 3; i++) w.dirt.add('basura', bin.tx * 16 + 8 + w.rng.range(-14, 14), bin.ty * 16 + 20 + w.rng.range(-4, 10), 0.6);
            audio.sfx('break');
          }
        }
      }
      if (this.pathI >= this.path.length) {
        const room = w.map.roomAtPx(this.x, this.y) ?? 'pasillo';
        const rr = w.rng.chance(this.species === 'rogue' || this.species === 'rata' ? 0.4 : 0.15) ? w.rng.pick(w.map.rooms).id : room;
        const t = w.rng.pick(w.map.room(rr).floorTiles);
        this.goTo(t.tx, t.ty);
        this.state = 'wander';
      }
    }
  }

  private setFrame() {
    let f = 0;
    const sp = this.species;
    if (sp === 'glorp') {
      if (this.stunned) f = 5; else if (this.state === 'chase') f = 4; else if (this.moving) f = 2 + (Math.floor(this.animT * 6) % 2); else f = Math.floor(this.animT * 2.5) % 2;
    } else if (sp === 'invasor') {
      if (this.stunned) f = 4; else if (this.acting && this.biteCd > 0.7) f = 2 + (Math.floor(this.animT * 8) % 2); else f = Math.floor(this.animT * (this.moving ? 8 : 2)) % 2;
    } else if (sp === 'babosa') f = Math.floor(this.animT * 4) % 4;
    else if (sp === 'rata') f = this.stunned ? 3 : this.state === 'eat' ? 2 : Math.floor(this.animT * 10) % 2;
    else f = Math.floor(this.animT * 12) % 2;
    this.acting = false;
    this.sprite.setFrame(f);
    this.sprite.setFlipX(this.vx < -3);
    this.sprite.setAngle(0);
  }

  destroy() {
    super.destroy();
    this.coat.destroy();
  }
}
