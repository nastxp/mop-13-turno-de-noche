import Phaser from 'phaser';
import { sortDepth, TILE } from '../config';
import { Actor } from './Actor';
import { audio } from '../systems/AudioManager';
import { bus } from '../core/EventBus';
import { clamp, facingFromVec, norm } from '../core/util';
import { HD } from '../gfx/sprites';
import { ACTIVITIES, ARCHETYPES, type ActivityDef, type CrewArchetype, type Need, type ProfessionId } from '../data/crew';
import { NPC_LINES } from '../data/lines';
import { RESIDUES, type ResidueId } from '../data/residues';
import type { Spot } from '../world/ShipMap';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';
import type { Creature } from './Creature';

export type NState = 'idle' | 'walk' | 'act' | 'flee' | 'knocked' | 'evac' | 'party' | 'respond' | 'inspect' | 'leave' | 'dead' | 'gone';
export type TaskKind = 'fire' | 'breach' | 'fixture' | 'toilet' | 'reactor' | 'revive' | 'treat' | 'fight' | 'clean';

export interface RespTask {
  kind: TaskKind;
  room: RoomId;
  target: any;
  x: number;
  y: number;
  t: number;
  work: number;
}

export interface Disease { id: string; t: number; next: number }

interface Memory { kind: 'slip' | 'creature' | 'fire' | 'vomit' | 'death'; x: number; y: number; t: number; room: RoomId | null }

/** Tripulante autónomo: necesidades, miedo, memoria, rol en emergencias, enfermedades y (a veces) muerte. */
export class Crew extends Actor {
  arch: CrewArchetype;
  prof: ProfessionId;
  name: string;
  needs: Record<Need, number>;
  health: number;
  healthMax: number;
  stress = 10;
  fear = 0;
  morale = 70;
  relation = 50;
  sick = 0;
  hygiene = 80;
  clumsy: number;
  resist: number;
  coop: number;
  speedBase: number;
  bravery: number;
  state: NState = 'idle';
  path: { tx: number; ty: number }[] = [];
  pathI = 0;
  spot: Spot | null = null;
  activity: ActivityDef | null = null;
  actT = 0;
  idleT = 0;
  carry: 'cafe' | null = null;
  carryT = 0;
  trash = false;
  cup: Phaser.GameObjects.Image;
  memory: Memory[] = [];
  sayCd: number;
  percT = 0;
  stuckT = 0;
  lastPos = { x: 0, y: 0 };
  vomitCd = 25;
  trailT = 0;
  trailType: ResidueId | null = null;
  trailDist = 0;
  knockedT = 0;
  foamedT = 0;
  frozenT = 0;
  running = false;
  task: RespTask | null = null;
  weaponCd = 0;
  disease: Disease | null = null;
  slugT = 0;
  sleepwalkT = 0;
  rageT = 0;
  isGuest = false;
  inspectRoute: RoomId[] = [];
  inspectI = 0;
  inspectScores: number[] = [];
  thanksCd = 0;
  repathT = 0;

  constructor(w: GameScene, prof: ProfessionId, x: number, y: number, name?: string) {
    super(w, `char_${prof}`, x, y);
    this.arch = ARCHETYPES[prof];
    this.prof = prof;
    this.name = name ?? w.rng.pick(this.arch.names);
    this.label = this.name;
    const r = () => w.rng.range(-0.1, 0.1);
    this.clumsy = clamp(this.arch.clumsiness + r(), 0.05, 1);
    this.resist = clamp(this.arch.resistance + r(), 0.05, 1);
    this.coop = clamp(this.arch.cooperation + r(), 0, 1);
    this.speedBase = this.arch.speed * w.rng.range(0.92, 1.08);
    this.bravery = this.arch.bravery;
    this.healthMax = this.arch.health;
    this.health = this.healthMax;
    this.needs = {
      hunger: w.rng.range(10, 60), bladder: w.rng.range(5, 55), fatigue: w.rng.range(5, 50),
      work: this.arch.workRoom || this.arch.role ? w.rng.range(30, 70) : 0, social: w.rng.range(10, 40),
    };
    if (prof === 'robot') { this.needs.hunger = 0; this.needs.bladder = 0; this.needs.fatigue = 0; }
    this.sayCd = w.rng.range(4, 12);
    this.cup = w.add.image(x, y, 'fx_cup').setVisible(false).setScale(HD);
    this.lastPos = { x, y };
  }

  get alive() { return this.state !== 'gone' && this.state !== 'evac' && this.state !== 'dead'; }
  get available() { return this.alive && this.state !== 'knocked' && this.fallT <= 0; }
  get organic() { return this.prof !== 'robot'; }
  get busy() { return this.state === 'respond' || this.state === 'inspect' || this.state === 'leave'; }
  tile() { return { tx: Math.floor(this.x / TILE), ty: Math.floor(this.y / TILE) }; }
  room(): RoomId | null { return this.w.map.roomAtPx(this.x, this.y); }

  say(text: string, force = false) {
    if (!force && this.sayCd > 0) return;
    this.sayCd = this.w.rng.range(7, 13);
    this.w.say(this, text);
  }

  sayKey(key: string, force = false) {
    const arr = NPC_LINES[key];
    if (arr) this.say(this.w.rng.pick(arr), force);
  }

  remember(kind: Memory['kind']) {
    this.memory.push({ kind, x: this.x, y: this.y, t: this.w.t, room: this.room() });
    if (this.memory.length > 8) this.memory.shift();
  }

  releaseSpot() {
    if (this.spot && this.spot.taken === this) this.spot.taken = null;
    this.spot = null;
  }

  goTo(tx: number, ty: number, run = false): boolean {
    const s = this.tile();
    const em = this.w.emerg;
    const path = this.w.nav.findPath(s.tx, s.ty, tx, ty, { cost: (x, y) => (em.fireAt(x, y) && !this.task ? 25 : 0) });
    if (!path) return false;
    this.path = path;
    this.pathI = 0;
    this.running = run;
    this.stuckT = 0;
    return true;
  }

  goNear(x: number, y: number, run = false): boolean {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [0, 2], [2, 0], [-2, 0]]) {
      if (this.w.map.isWalkable(tx + dx, ty + dy) && this.goTo(tx + dx, ty + dy, run)) return true;
    }
    return false;
  }

  private follow(dt: number): boolean {
    if (this.pathI >= this.path.length) { this.moving = false; return true; }
    const n = this.path[this.pathI];
    if (!this.w.map.isWalkable(n.tx, n.ty)) {
      const last = this.path[this.path.length - 1];
      if (!this.goTo(last.tx, last.ty, this.running)) { this.path = []; return true; }
      return false;
    }
    const c = this.w.map.tileCenter(n.tx, n.ty);
    const d = norm(c.x - this.x, c.y - this.y);
    if (d.len < 2.5) { this.pathI++; return this.pathI >= this.path.length; }
    const surf = this.w.dirt.surfaceAt(this.x, this.y);
    let speed = 40 * this.speedBase * (this.running ? 1.75 : 1) * (1 - surf.slow) * (this.foamedT > 0 ? 0.4 : 1);
    if (this.slugT > 0) speed *= 0.4;
    if (this.sleepwalkT > 0) speed *= 0.6;
    const wet = this.w.cleaning.wetAt(this.x, this.y);
    const slip = Math.max(surf.slippery, wet * 0.5);
    const traction = slip > 0.1 ? 10 - 7 * slip : 12;
    const f = Math.min(1, traction * dt);
    this.vx += (d.x * speed - this.vx) * f;
    this.vy += (d.y * speed - this.vy) * f;
    const pull = this.w.emerg.pullAt(this.x, this.y, this);
    this.move((this.vx + pull.x) * dt, (this.vy + pull.y) * dt);
    this.moving = true;
    this.facing = facingFromVec(this.vx, this.vy, this.facing);
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      const moved = Math.hypot(this.x - this.lastPos.x, this.y - this.lastPos.y);
      this.lastPos = { x: this.x, y: this.y };
      this.stuckT = 0;
      if (moved < 3) {
        this.unstick();
        const last = this.path[this.path.length - 1];
        if (!this.goTo(last.tx, last.ty, this.running)) { this.path = []; return true; }
      }
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (this.running && Math.random() < dt * 4) this.w.fx.dust(this.x, this.y);
    if (this.slipCheck(dt, sp, this.clumsy * (this.running ? 1.6 : 1) * (this.prof === 'robot' ? 0.3 : 1))) this.onSlip();
    if (this.trailT > 0 && this.trailType) {
      this.trailDist += sp * dt;
      if (this.trailDist > 18) { this.trailDist = 0; this.w.dirt.add(this.trailType, this.x, this.y + 2, 0.45); }
    }
    if (this.slugT > 0 && Math.random() < dt * 2) this.w.dirt.add('baba', this.x, this.y + 1, 0.3, { merge: true });
    if (surf.tracks && sp > 10 && this.w.rng.chance(dt * 0.5)) this.w.dirt.add('huellas', this.x, this.y, 0.18, { merge: true });
    if (this.w.trapAt(this.x, this.y) && Math.random() < dt * 2) { this.fall(this.vx / (sp || 1), this.vy / (sp || 1)); this.say('¡¿Quién ha puesto esto aquí?!', true); }
    return false;
  }

  private onSlip() {
    const w = this.w;
    audio.sfx('slip');
    this.sayKey('slip', true);
    this.remember('slip');
    this.releaseSpot();
    this.stress += 15;
    w.stats.crewSlips++;
    bus.emit('npc:slip', this);
    if (this.carry === 'cafe') {
      this.carry = null;
      w.dirt.add('cafe', this.x + this.vx * 0.3, this.y + this.vy * 0.3, 1);
      w.dirt.add('cafe', this.x + this.vx * 0.5, this.y + this.vy * 0.4, 0.5);
      w.fx.splash(this.x, this.y, 0x6b3f1f);
    }
    for (const f of w.map.fixtures) {
      if (f.kind !== 'panel' || f.broken) continue;
      const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
      if (Math.hypot(c.x - this.x, c.y - this.y) < 18 && w.rng.chance(0.3)) { w.emerg.breakPanel(f, `${this.name} se cayó encima`, false); break; }
    }
    if (this.state === 'act' || this.state === 'walk') this.state = 'idle';
  }

  vomit() {
    const w = this.w;
    if (!this.available || this.vomitCd > 0 || !this.organic) return false;
    this.vomitCd = 28;
    w.lastVomitT = w.t;
    this.sayKey('vomit', true);
    this.setEmote('disgust', 2);
    this.stunT = 1.6;
    this.acting = true;
    audio.sfx('vomit');
    const dir = this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : 0;
    w.fx.vomit(this.x + dir * 4, this.y - 6, dir);
    w.time.delayedCall(450, () => {
      w.dirt.add('vomito', this.x + dir * 9, this.y + (dir ? 2 : 7), 1);
      w.dirt.add('vomito', this.x + dir * 14, this.y + (dir ? 4 : 11), 0.45);
    });
    this.stress = Math.max(0, this.stress - 40);
    this.sick = Math.max(0, this.sick - 60);
    this.morale -= 6;
    w.stats.vomits++;
    bus.emit('npc:vomit', this);
    return true;
  }

  sneeze() {
    const w = this.w;
    if (!this.available) return;
    this.sayKey('sneeze', true);
    audio.sfx('squish');
    const dir = this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : 0;
    w.dirt.add('mucosidad', this.x + dir * 12, this.y + 4, 0.7);
    w.fx.splash(this.x + dir * 6, this.y - 8, 0xa8e85a);
    for (const c of w.crew) {
      if (c !== this && c.available && c.organic && !c.disease && Math.hypot(c.x - this.x, c.y - this.y) < 30 && w.rng.chance(0.25 * (1 - c.resist))) w.disease.infect(c, 'estornudo');
    }
  }

  damage(amount: number, cause: string) {
    if (!this.alive || this.state === 'knocked') return;
    this.health -= amount;
    this.fear += amount;
    this.sprite.setTintFill(0xff6060);
    this.w.time.delayedCall(80, () => { if (this.alive) this.sprite.clearTint(); });
    if (this.organic && amount >= 10 && Math.random() < 0.6) this.w.dirt.add('sangre', this.x + (Math.random() - 0.5) * 8, this.y + 2, 0.35);
    if (this.health <= 0) {
      this.health = 0;
      const deadly = cause === 'combate' ? 0.45 : cause === 'fuego' || cause === 'acido' ? 0.3 : 0.1;
      if (this.organic && this.prof !== 'inspector' && this.w.rng.chance(deadly)) { this.w.combat.killCrew(this, cause); return; }
      this.state = 'knocked';
      this.knockedT = 0;
      this.task = null;
      this.releaseSpot();
      this.carry = null;
      this.fallT = 0;
      this.ko = true;
      this.setEmote('dizzy', 99);
      bus.emit('npc:knocked', this, cause);
    }
  }

  rescue(byCrew = false) {
    if (this.state !== 'knocked') return;
    this.health = Math.round(this.healthMax * 0.45);
    this.state = 'idle';
    this.ko = false;
    this.fear = 0;
    this.relation = Math.min(100, this.relation + (byCrew ? 5 : 25));
    this.setEmote('heart', 2);
    if (byCrew) this.w.stats.crewRevivedByCrew++;
    else this.w.stats.crewRescued++;
    this.sayKey(this.prof === 'capitan' && !byCrew ? 'captainRescued' : 'rescued', true);
    bus.emit('npc:rescued', this, byCrew);
  }

  hitByFoam(fromPlayer = true) {
    if (this.foamedT > 0.5) return;
    this.foamedT = 3;
    if (!fromPlayer) return;
    this.relation = Math.max(0, this.relation - 6);
    this.sayKey('foamed', true);
    this.setEmote('anger', 1.5);
    this.w.stats.foamOnCrew++;
  }

  freeze(t: number) {
    this.frozenT = Math.max(this.frozenT, t);
    this.say('¡Qué fr-fr-frío!', true);
  }

  startFlee(reason: 'fire' | 'creature' | 'breach') {
    const w = this.w;
    if (this.busy || this.state === 'knocked' || !this.alive) return;
    const here = this.room();
    const safe = w.map.rooms.filter((r) => r.id !== here && w.emerg.roomThreat(r.id) === 0 && r.floorTiles.length);
    const pick = safe.length ? w.rng.pick(safe) : w.map.room('pasillo');
    const t = w.rng.pick(pick.floorTiles);
    this.releaseSpot();
    this.activity = null;
    if (this.goTo(t.tx, t.ty, true)) {
      this.state = 'flee';
      this.setEmote('fear', 2);
      this.sayKey(reason === 'breach' ? 'breach' : reason, false);
      this.remember(reason === 'creature' ? 'creature' : 'fire');
    }
  }

  assign(task: RespTask) {
    this.releaseSpot();
    this.activity = null;
    this.task = task;
    this.state = 'respond';
    this.path = [];
    this.repathT = 0;
    if (task.kind === 'fight') this.sayKey('combat', true);
    else if (task.kind === 'fire') this.sayKey('extinguish', true);
    else if (task.kind === 'revive') this.sayKey('revive', true);
    this.goNear(task.x, task.y, true);
  }

  endTask() {
    this.task = null;
    this.state = 'idle';
    this.idleT = 1;
    this.running = false;
  }

  startInspection(route: RoomId[]) {
    this.inspectRoute = route;
    this.inspectI = 0;
    this.inspectScores = [];
    this.state = 'inspect';
    this.actT = -1;
    this.goToRoomCenter(route[0]);
  }

  private goToRoomCenter(id: RoomId) {
    const r = this.w.map.room(id);
    const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2);
    let best = r.floorTiles[0], bd = 1e9;
    for (const t of r.floorTiles) { const d = (t.tx - cx) ** 2 + (t.ty - cy) ** 2; if (d < bd) { bd = d; best = t; } }
    this.goTo(best.tx, best.ty, false);
  }

  private chooseActivity() {
    const w = this.w;
    let opts = ACTIVITIES.filter((a) => (!a.prof || a.prof.includes(this.prof)) && !(a.notProf && a.notProf.includes(this.prof)));
    if (this.isGuest) opts = opts.filter((a) => a.id === 'comer' || a.id === 'pasear' || a.id === 'cafe');
    if (this.sleepwalkT > 0) opts = opts.filter((a) => a.id === 'pasear');
    let best: ActivityDef | null = null, bestS = -1e9;
    for (const a of opts) {
      if (a.room !== '*' && !w.map.roomById.has(a.room)) continue;
      let s = 0;
      for (const [n, v] of Object.entries(a.satisfy) as [Need, number][]) s += this.needs[n] * (-v / 100);
      if (a.id === 'papelera') s = this.trash ? 45 : -100;
      if (a.id === 'cafe' && this.carry) s -= 100;
      if (this.prof === 'turista' && a.id === 'pasear') s += 18;
      if (this.isGuest && a.id === 'comer') s += 40;
      s += w.rng.range(0, 22);
      if (a.room !== '*') {
        if (w.emerg.roomThreat(a.room) > 0) s -= 80;
        if (this.memory.some((m) => (m.kind === 'creature' || m.kind === 'death') && m.room === a.room && w.t - m.t < 60)) s -= 35;
      }
      if (s > bestS) { bestS = s; best = a; }
    }
    if (!best) return;
    this.activity = best;
    if (best.prop === 'floor') {
      const rooms = w.map.rooms.filter((r) => w.emerg.roomThreat(r.id) === 0);
      const r = rooms.length ? w.rng.pick(rooms) : w.map.room('pasillo');
      const t = w.rng.pick(r.floorTiles);
      if (this.goTo(t.tx, t.ty)) { this.state = 'walk'; this.spot = null; }
      return;
    }
    let props = w.map.props.filter((p) => p.kind === best!.prop && (best!.room === '*' || p.room === best!.room));
    if (best.special === 'bin') props = props.slice().sort((a, b) => Math.hypot(a.tx * 16 - this.x, a.ty * 16 - this.y) - Math.hypot(b.tx * 16 - this.x, b.ty * 16 - this.y)).slice(0, 2);
    const spots: Spot[] = [];
    for (const p of props) {
      if (p.kind === 'toilet' && p.state.clog) continue;
      for (const sp of p.spots) if (!sp.taken) spots.push(sp);
    }
    if (!spots.length) { this.activity = null; return; }
    const sp = w.rng.pick(spots);
    if (this.goTo(sp.tx, sp.ty)) { sp.taken = this; this.spot = sp; this.state = 'walk'; }
    else this.activity = null;
  }

  private beginActivity() {
    const a = this.activity;
    if (!a) { this.state = 'idle'; return; }
    this.state = 'act';
    this.actT = this.w.rng.range(a.dur[0], a.dur[1]);
    if (this.spot) this.facing = this.spot.face;
    this.moving = false;
    this.vx = 0; this.vy = 0;
    if (a.pose === 'sleep') this.setEmote('zzz', this.actT);
  }

  private finishActivity() {
    const w = this.w;
    const a = this.activity!;
    for (const [n, v] of Object.entries(a.satisfy) as [Need, number][]) this.needs[n] = Math.max(0, this.needs[n] + v);
    for (const d of a.dirt ?? []) {
      if (w.rng.chance(d.p * (0.35 + this.clumsy * 0.7))) w.dirt.add(d.type, this.x + w.rng.range(-8, 8), this.y + w.rng.range(-4, 6), d.amt * w.rng.range(0.7, 1.2));
    }
    const prop = this.spot?.prop;
    switch (a.special) {
      case 'toilet':
        audio.sfx('flush');
        if (prop && w.rng.chance((0.02 + this.clumsy * 0.05) * (w.rules.has('plaga') || w.rules.has('inundacion') ? 3 : 1))) w.emerg.clogToilet(prop, this);
        break;
      case 'coffee':
        if (prop?.state.broken) { this.say('¿Sin café? Esto es un motín en potencia.'); break; }
        this.carry = 'cafe';
        this.carryT = w.rng.range(18, 30);
        this.trash = true;
        audio.sfx('pour');
        break;
      case 'cook':
        if (w.rng.chance(0.05) && prop) {
          const sp = prop.spots[0];
          if (sp) w.emerg.ignite(sp.tx, sp.ty, 0.5, 'la cocina');
          this.say('¡Flambeado! Bueno… demasiado flambeado.', true);
        }
        w.fx.smoke(this.x, this.y - 10);
        break;
      case 'experiment':
        if (w.rng.chance(0.05)) {
          w.dirt.add('quimico', this.x + 6, this.y + 4, 1.2);
          this.say('Ups. Eso no debería burbujear así.', true);
          if (w.director.canSpawnCreature() && w.rng.chance(0.35)) w.spawnCreature('glorp', this.x + 8, this.y + 6, 0.7, 'un experimento');
        }
        break;
      case 'bin':
        if (prop) {
          if ((prop.state.fill ?? 0) >= 100) { w.dirt.add('basura', this.x + w.rng.range(-8, 8), this.y + 6, 0.7); this.say('La papelera está a rebosar. Lo dejo aquí.'); }
          else { prop.state.fill = Math.min(100, (prop.state.fill ?? 0) + w.rng.range(18, 34)); prop.sprite?.setFrame(prop.state.fill >= 100 ? 1 : 0); }
        }
        this.trash = false;
        break;
      case 'smuggle':
        if (w.rng.chance(0.45)) { w.dirt.add('huevos', this.x + w.rng.range(-10, 10), this.y + 6, 1); this.sayKey('smuggler'); bus.emit('eggs:planted', this.room()); }
        break;
      case 'maintain':
        if (w.rng.chance(0.05)) w.secrets.dropSock(this.x, this.y + 4);
        if (w.rng.chance(0.03)) { this.trailT = 10; this.trailType = 'aceite'; this.say('ERROR 0x5UC10. FUGA DE LUBRICANTE.', true); }
        break;
    }
    if (a.id === 'comer') this.trash = true;
    this.releaseSpot();
    this.activity = null;
    this.state = 'idle';
    this.idleT = this.w.rng.range(0.5, 2.5);
  }

  private perceive() {
    const w = this.w;
    const room = this.room();
    let threat = 0;
    let reason: 'fire' | 'creature' | 'breach' = 'fire';
    const fires = w.emerg.firesNear(this.x, this.y, 70);
    if (fires) { threat += 22 * fires; reason = 'fire'; }
    for (const c of w.creatures) {
      if (!c.alive || c.hidden) continue;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < 100) { threat += (40 * c.size * (100 - d)) / 100 + (c.aggressive ? 30 : 0); reason = 'creature'; }
    }
    if (w.bosses.active && w.bosses.room === room) { threat += 50; reason = 'creature'; }
    if (room && w.emerg.breachIn(room)) { threat += 30; reason = 'breach'; }
    for (const b of w.combat.corpses) if (!b.carried && Math.hypot(b.x - this.x, b.y - this.y) < 50) { this.stress += 2; if (this.sayCd <= 0 && w.rng.chance(0.15)) this.sayKey('witness'); }
    if (this.prof === 'seguridad' || this.prof === 'inspector') threat = 0;
    else if (this.prof === 'robot' || this.state === 'respond') threat *= 0.3;
    const target = threat * (1.15 - this.bravery);
    this.fear += (target - this.fear) * 0.35;
    if (this.fear > 42 && this.state !== 'flee' && this.state !== 'knocked' && !this.busy && !w.ship.zeroG) {
      this.startFlee(reason);
      if (reason === 'creature') w.stats.crewScared++;
    }
    const near = w.dirt.near(this.x, this.y, 34);
    let disgust = 0, dirtSum = 0;
    for (const d of near) { disgust += RESIDUES[d.type].disgust * d.amount; dirtSum += RESIDUES[d.type].weight * d.amount; }
    if (!this.organic || this.prof === 'diplomatico') disgust *= 0.2;
    this.stress = clamp(this.stress + disgust * 2.4 - 1.6, 0, 100);
    if (disgust > 0.8 && this.sayCd <= 0 && w.rng.chance(0.4)) { this.sayKey('sawVomit'); this.setEmote('disgust', 1.5); }
    else if (dirtSum > 1.5 && this.sayCd <= 0 && w.rng.chance(0.18)) { this.sayKey(this.prof === 'robot' ? 'robot' : 'dirt'); this.setEmote('anger', 1.2); this.relation = Math.max(0, this.relation - 1); }
    if (room) {
      const clean = w.dirt.roomClean(room);
      this.hygiene += (clean - this.hygiene) * 0.05;
      this.morale += ((18 + clean * 0.55 + (100 - this.stress) * 0.3) - this.morale) * 0.06;
    }
    const canVomit = this.vomitCd <= 0 && w.t - w.lastVomitT > 10 && this.available && this.organic && this.prof !== 'inspector';
    if (canVomit && disgust > 1.2 && this.resist < 0.45 && w.rng.chance(0.25)) this.vomit();
    if (this.prof === 'paranoico' && w.rng.chance(0.006) && !this.busy) { this.sayKey('paranoid', true); w.response.falseAlarm(this); }
    if (this.prof === 'diplomatico' && this.moving && w.rng.chance(0.06)) w.dirt.add('mucosidad', this.x, this.y + 2, 0.35, { merge: true });
    if (this.prof === 'diplomatico' && w.players.some((q) => q.using && Math.hypot(q.x - this.x, q.y - this.y) < 44) && this.sayCd <= 0 && w.rng.chance(0.3)) { this.sayKey('diplomat', true); this.relation -= 3; }
    if (this.isGuest && this.sayCd <= 0 && w.rng.chance(0.05)) this.sayKey('guest');
    const p = w.nearestPlayer(this.x, this.y).p ?? w.player;
    if (p.active && !p.dead) {
      const dp = Math.hypot(p.x - this.x, p.y - this.y);
      if (dp < 46) {
        if (p.using && (p.tool === 'fregona' || p.tool === 'superfregona') && this.thanksCd <= 0 && w.rng.chance(0.25)) {
          this.thanksCd = 25;
          this.sayKey(this.prof === 'robot' ? 'robot' : 'thanks');
          this.relation = Math.min(100, this.relation + 4);
          this.morale = Math.min(100, this.morale + 6);
          this.setEmote('heart', 1.2);
        } else if (dirtSum > 1 && this.sayCd <= 0 && w.rng.chance(0.3) && this.organic) {
          this.sayKey('askClean', true);
          const creatureNear = w.creatures.some((c) => c.alive && !c.hidden && Math.hypot(c.x - this.x, c.y - this.y) < 110);
          w.time.delayedCall(1300, () => p.sayKey(creatureNear ? 'replyCreature' : 'replyClean', true));
        }
      }
    }
    if (this.sayCd <= 0) {
      for (const m of this.memory) {
        if (w.t - m.t > 20 && Math.hypot(m.x - this.x, m.y - this.y) < 26 && w.rng.chance(0.5)) { this.sayKey(m.kind === 'slip' ? 'memorySlip' : 'memoryCreature'); break; }
      }
    }
  }

  /** Respuesta a emergencias según el rol (seguridad, técnico, médico, mantenimiento). */
  private respond(dt: number) {
    const w = this.w;
    const tk = this.task!;
    tk.t += dt;
    this.repathT -= dt;
    if (!w.response.valid(tk) || tk.t > 75) { this.endTask(); return; }
    this.running = true;
    const d = Math.hypot(tk.x - this.x, tk.y - this.y);
    switch (tk.kind) {
      case 'fight': {
        const c = tk.target as Creature;
        tk.x = c.x; tk.y = c.y;
        const dist = Math.hypot(c.x - this.x, c.y - this.y);
        if (dist > 70 || (dist > 22 && this.pathI >= this.path.length && dist > 60)) {
          if (this.repathT <= 0) { this.repathT = 0.8; this.goNear(c.x, c.y, true); }
          this.follow(dt);
        } else {
          this.moving = false;
          this.vx *= 0.7; this.vy *= 0.7;
          this.facing = facingFromVec(c.x - this.x, c.y - this.y, this.facing);
          this.acting = true;
          this.weaponCd -= dt;
          if (this.weaponCd <= 0) { this.weaponCd = 0.45 + Math.random() * 0.25; w.combat.shoot(this, c.x, c.y - 5); }
        }
        return;
      }
      case 'fire': {
        const cell = w.emerg.nearestFire(this.x, this.y, tk.room);
        if (!cell) return;
        const fx = cell.tx * TILE + 8, fy = cell.ty * TILE + 10;
        const dist = Math.hypot(fx - this.x, fy - this.y);
        if (dist > 30) {
          if (this.repathT <= 0 || this.pathI >= this.path.length) { this.repathT = 1.2; this.goNear(fx, fy + 18, true); }
          this.follow(dt);
        } else {
          this.moving = false;
          this.acting = true;
          this.facing = facingFromVec(fx - this.x, fy - this.y, this.facing);
          w.cleaning.npcSpray(this, fx, fy, dt);
        }
        return;
      }
      case 'revive': case 'treat': {
        const t = tk.target as Crew;
        tk.x = t.x; tk.y = t.y;
        if (Math.hypot(t.x - this.x, t.y - this.y) > 14) {
          if (this.repathT <= 0 || this.pathI >= this.path.length) { this.repathT = 1; this.goNear(t.x, t.y, true); }
          this.follow(dt);
          tk.work = 0;
          return;
        }
        this.moving = false;
        this.acting = true;
        tk.work += dt;
        if (Math.random() < dt * 3) w.fx.sparkle(t.x, t.y - 8, 2);
        if (tk.work > (tk.kind === 'revive' ? 3 : 2.5)) {
          if (tk.kind === 'revive') t.rescue(true);
          else w.disease.cure(t, 'médica');
          this.endTask();
        }
        return;
      }
      case 'clean': {
        const dd = tk.target;
        if (d > 10) { if (this.pathI >= this.path.length) this.goNear(tk.x, tk.y); this.follow(dt); return; }
        this.moving = false;
        this.acting = true;
        dd.amount -= 0.7 * dt;
        w.dirt.refresh(dd);
        if (dd.amount <= 0.05) { w.dirt.remove(dd, 'other'); w.stats.robotCleaned++; this.endTask(); }
        return;
      }
      default: {
        if (d > 14) {
          if (this.pathI >= this.path.length && this.repathT <= 0) { this.repathT = 1.5; this.goNear(tk.x, tk.y, true); }
          this.follow(dt);
          return;
        }
        this.moving = false;
        this.acting = true;
        tk.work += dt;
        if (Math.random() < dt * 5) { audio.sfx('repair'); w.fx.sparks(tk.x, tk.y - 10, 1); }
        if (tk.kind === 'breach') {
          w.emerg.seal(tk.target, dt / 6, false);
          if (Math.random() < dt * 4) w.fx.foamPuff(tk.x, tk.y - 4);
          return;
        }
        const need = tk.kind === 'reactor' ? 3 : tk.kind === 'toilet' ? 3.5 : 4.5;
        if (tk.work > need) {
          w.emerg.repairByCrew(tk.target, this);
          if (this.prof === 'ingeniero') w.dirt.add('aceite', this.x + w.rng.range(-6, 6), this.y + 4, 0.35);
          this.say(this.prof === 'robot' ? 'REPARACIÓN COMPLETADA. SATISFACCIÓN: 3 %.' : 'Arreglado. Cobro en café.', true);
          this.endTask();
        }
      }
    }
  }

  update(dt: number) {
    const w = this.w;
    if (this.state === 'gone' || this.state === 'dead') return;
    this.sayCd -= dt;
    this.thanksCd -= dt;
    this.vomitCd -= dt;
    this.foamedT -= dt;
    this.trailT -= dt;
    this.acting = false;
    this.armsUp = false;

    if (this.state === 'evac') {
      this.sprite.setAlpha(Math.max(0, this.sprite.alpha - dt));
      if (this.sprite.alpha <= 0) { this.state = 'gone'; this.hidden = true; this.emote.setVisible(false); }
      this.updateSprite(dt);
      return;
    }
    if (this.organic) {
      this.needs.hunger += 0.45 * dt;
      this.needs.bladder += 0.55 * dt;
      this.needs.fatigue += 0.3 * dt;
    }
    if (this.arch.workRoom || this.arch.role) this.needs.work += 0.8 * dt;
    this.needs.social += 0.35 * dt;
    if (this.carry) {
      this.carryT -= dt;
      if (this.carryT <= 0) { this.carry = null; if (w.rng.chance(this.clumsy * 0.25)) w.dirt.add('basura', this.x, this.y + 4, 0.5); }
    }
    if (this.slugT > 0) {
      this.slugT -= dt;
      if (this.sprite.texture.key !== 'babosa') this.sprite.setTexture('babosa', 0);
      if (this.slugT <= 0) { this.sprite.setTexture(`char_${this.prof}`, 0); this.say('¿Qué ha pasado? ¿Por qué estoy pegajoso?', true); }
    }
    if (this.sleepwalkT > 0) { this.sleepwalkT -= dt; if (Math.random() < dt * 0.3) this.setEmote('zzz', 1.5); }
    if (this.rageT > 0) {
      this.rageT -= dt;
      const p = w.nearestPlayer(this.x, this.y).p ?? w.player;
      if (Math.hypot(p.x - this.x, p.y - this.y) < 14 && Math.random() < dt * 2) { p.vx += (p.x - this.x) * 8; p.vy += (p.y - this.y) * 8; p.say('¡Eh! ¡Que yo solo friego!', true); }
      if (this.moving && Math.random() < dt * 0.8) w.dirt.add(w.rng.pick(['escombros', 'comida', 'basura'] as ResidueId[]), this.x, this.y + 4, 0.5);
    }

    const fire = w.emerg.fireAtPx(this.x, this.y);
    if (fire && this.prof !== 'robot') this.damage(20 * fire.i * dt * (this.state === 'respond' ? 0.4 : 1), 'fuego');
    if (!this.alive) return;
    const surf = w.dirt.surfaceAt(this.x, this.y);
    if (surf.electrified && this.stunT <= 0 && this.state !== 'knocked') {
      this.stunT = 1;
      this.damage(8, 'descarga');
      w.fx.zap(this.x, this.y - 8);
      audio.sfx('zap');
      this.say('¡¡BZZZZT!!', true);
    }
    if (surf.corrosive && this.organic && Math.random() < dt) this.damage(3, 'acido');
    if (!this.alive) return;

    if (this.state === 'knocked') {
      this.knockedT += dt;
      this.fallT = 0;
      this.ko = true;
      this.updateSprite(dt);
      if (this.knockedT > 55) {
        this.state = 'evac';
        w.stats.crewInjured++;
        w.announce('injured', { name: this.name });
      }
      return;
    }
    this.ko = false;

    this.percT -= dt;
    if (this.percT <= 0) { this.percT = 0.4; this.perceive(); }

    if (this.frozenT > 0) {
      this.frozenT -= dt;
      this.moving = false;
      this.sprite.setTint(0xc8f0ff);
      this.updateSprite(dt);
      this.updateCup();
      return;
    }

    if (w.ship.zeroG) {
      this.releaseSpot();
      if (this.state === 'act' || this.state === 'walk' || this.state === 'party') { this.state = 'idle'; this.activity = null; }
      this.vx += w.rng.range(-8, 8) * dt;
      this.vy += w.rng.range(-8, 8) * dt;
      const pull = w.emerg.pullAt(this.x, this.y, this);
      const r = this.move((this.vx + pull.x) * dt, (this.vy + pull.y) * dt);
      if (r.hitX) this.vx *= -0.6;
      if (r.hitY) this.vy *= -0.6;
      this.moving = false;
      this.armsUp = true;
      if (this.sayCd <= 0 && w.rng.chance(dt * 0.4)) this.sayKey('zeroG');
      if (this.state === 'respond' && this.task?.kind === 'fight') this.respond(dt);
      this.updateSprite(dt);
      this.updateCup();
      return;
    }

    if (this.fallT > 0) {
      this.fallT -= dt;
      const damp = Math.max(0, 1 - dt * 3);
      this.vx *= damp; this.vy *= damp;
      this.move(this.vx * dt, this.vy * dt);
      if (this.fallT <= 0) { this.vx = 0; this.vy = 0; this.path = []; if (this.state !== 'respond') this.state = 'idle'; }
      this.updateSprite(dt);
      this.updateCup();
      return;
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.vx = 0; this.vy = 0;
      this.moving = false;
      this.acting = true;
      this.updateSprite(dt);
      this.updateCup();
      return;
    }

    if (w.emerg.partyT > 0 && this.organic && this.prof !== 'inspector' && (this.state === 'idle' || this.state === 'walk' || this.state === 'act')) {
      this.releaseSpot();
      this.activity = null;
      const t = w.map.randomFloor(w.rng, 'comedor');
      if (this.goTo(t.tx, t.ty)) this.state = 'party';
    }

    switch (this.state) {
      case 'idle':
        this.moving = false;
        this.vx *= 0.8; this.vy *= 0.8;
        this.idleT -= dt;
        if (this.idleT <= 0) this.chooseActivity();
        break;
      case 'walk':
        if (this.follow(dt)) { if (this.activity) this.beginActivity(); else this.state = 'idle'; }
        break;
      case 'act': {
        this.actT -= dt;
        const pose = this.activity?.pose;
        this.acting = pose === 'work' || pose === 'eat';
        if (this.activity?.special === 'maintain' || (this.prof === 'robot' && this.activity?.id === 'pasear')) {
          for (const d of w.dirt.near(this.x, this.y, 16)) {
            const def = RESIDUES[d.type];
            if (!def.solid && d.type !== 'huellas') continue;
            d.amount -= 0.4 * dt;
            if (d.amount <= 0.05) { w.dirt.remove(d, 'other'); w.stats.robotCleaned++; } else w.dirt.refresh(d);
            this.acting = true;
            break;
          }
        }
        if (this.actT <= 0) this.finishActivity();
        break;
      }
      case 'flee':
        if (this.follow(dt)) { this.state = 'idle'; this.idleT = 2; this.running = false; }
        this.armsUp = true;
        break;
      case 'respond':
        this.respond(dt);
        break;
      case 'party': {
        if (w.emerg.partyT <= 0) { this.state = 'idle'; break; }
        if (this.pathI < this.path.length) this.follow(dt);
        else {
          this.moving = false;
          this.armsUp = Math.floor(this.animT * 3) % 2 === 0;
          this.facing = (['down', 'left', 'up', 'right'] as const)[Math.floor(this.animT * 2.5) % 4];
          if (w.rng.chance(dt * 0.6)) {
            const tp = w.rng.pick(['confeti', 'confeti', 'cafe', 'comida'] as ResidueId[]);
            w.dirt.add(tp, this.x + w.rng.range(-10, 10), this.y + w.rng.range(-4, 8), 0.6);
          }
          if (this.sayCd <= 0 && w.rng.chance(dt * 0.3)) this.sayKey('dance');
        }
        break;
      }
      case 'inspect': {
        if (this.pathI < this.path.length) { this.follow(dt); break; }
        this.moving = false;
        if (this.actT < 0) { this.actT = 0; this.setEmote('dots', 5); }
        this.actT += dt;
        this.acting = Math.floor(this.animT * 2) % 2 === 0;
        if (this.actT > 5) {
          const room = this.inspectRoute[this.inspectI];
          const score = w.dirt.roomClean(room);
          this.inspectScores.push(score);
          w.stats.inspections.push({ room, score });
          const threat = w.emerg.roomThreat(room) > 0;
          if (threat && w.rng.chance(0.6)) this.sayKey('inspectorIgnore', true);
          else this.sayKey(score >= 75 ? 'inspectorGood' : 'inspectorBad', true);
          w.floatText(this.x, this.y - 26, `${Math.round(score)} %`, score >= 75 ? 'good' : 'bad');
          bus.emit('inspector:room', room, score);
          this.inspectI++;
          this.actT = -1;
          if (this.inspectI >= this.inspectRoute.length) {
            this.state = 'leave';
            const avg = this.inspectScores.reduce((a, b) => a + b, 0) / this.inspectScores.length;
            bus.emit('inspector:done', avg);
            this.goTo(58, 13);
          } else this.goToRoomCenter(this.inspectRoute[this.inspectI]);
        }
        break;
      }
      case 'leave':
        if (this.follow(dt)) { this.state = 'gone'; this.hidden = true; this.emote.setVisible(false); }
        break;
    }
    this.updateSprite(dt);
    if (this.slugT > 0) this.sprite.setFrame(Math.floor(this.animT * 4) % 4).setAngle(0).setFlipX(this.vx < -3);
    if (this.state === 'act' && this.activity?.pose === 'sleep' && this.spot?.prop && this.slugT <= 0) {
      // dormido DENTRO de la litera: cabeza en la almohada, ojos cerrados y el cuerpo bajo la manta
      const p = this.spot.prop;
      const bx = p.tx * TILE + 8, by = p.ty * TILE;
      this.sprite.setFrame(8).setFlipX(false).setAngle(0).setCrop(0, 0, 16 / HD, 9.5 / HD)
        .setPosition(bx, by + 15).setDepth(sortDepth((p.ty + p.h) * TILE) + 0.01);
      this.shadow.setVisible(false);
      if (this.emoteT > 0) this.emote.setPosition(bx + 5, by - 1);
    } else if (this.sprite.isCropped) this.sprite.setCrop();
    if (this.frozenT <= 0 && this.slugT <= 0) {
      if (this.foamedT > 0) this.sprite.setTint(0xdde8ff);
      else if (this.rageT > 0) this.sprite.setTint(0xff9a9a);
      else if (this.disease) this.sprite.setTint(0xd8f0b8);
      else this.sprite.clearTint();
    }
    this.updateCup();
  }

  private updateCup() {
    const show = this.carry === 'cafe' && this.state !== 'knocked' && !this.hidden && this.fallT <= 0 && this.slugT <= 0;
    this.cup.setVisible(show);
    if (show) {
      const side = this.facing === 'left' ? -5 : 5;
      this.cup.setPosition(Math.round(this.x + side), Math.round(this.y - 6 - this.floatOff)).setDepth(sortDepth(this.y) + 0.001);
    }
  }

  destroy() {
    super.destroy();
    this.cup.destroy();
  }
}
