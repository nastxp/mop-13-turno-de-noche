import Phaser from 'phaser';
import { DEPTH, MAP_W, sortDepth, TILE } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { RESIDUES } from '../data/residues';
import { ROOM_NAMES } from '../data/rooms';
import type { Actor } from '../entities/Actor';
import { HD } from '../gfx/sprites';
import type { Crew } from '../entities/Crew';
import { Tile, type Fixture, type Prop } from '../world/ShipMap';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export interface FireCell {
  tx: number; ty: number; i: number; age: number; room: RoomId | null;
  sprite: Phaser.GameObjects.Sprite; glow: Phaser.GameObjects.Image; ph: number;
}

export interface Breach {
  id: number; room: RoomId; tx: number; ty: number; x: number; y: number;
  seal: number; sealed: boolean; sprite: Phaser.GameObjects.Sprite; t: number;
}

export interface AlertInfo {
  id: string;
  icon: string;
  title: string;
  room: RoomId;
  x: number;
  y: number;
  sev: 1 | 2 | 3;
  risk?: string;
  timer?: number;
  timerLabel?: string;
  /** tripulante que la está atendiendo */
  by?: string;
}

/** Incendios, fugas, cortocircuitos, atascos, reactor y gravedad. */
export class EmergencySystem {
  fires = new Map<number, FireCell>();
  breaches: Breach[] = [];
  reactorHeat = 25;
  overheating = false;
  blackoutT = 0;
  stormT = 0;
  partyT = 0;
  private tick = 0;
  private breachId = 1;
  private fireRooms = new Set<RoomId>();
  private scorched = new Map<number, number>();
  private bigFireT = new Map<RoomId, number>();
  private sparkT = 0;

  constructor(private w: GameScene) {}

  // ───────── paneles, tuberías, inodoros ─────────

  breakPanel(f: Fixture, cause: string, byPlayer: boolean) {
    if (f.broken || f.kind !== 'panel') return;
    const w = this.w;
    f.broken = true;
    f.sprite?.setFrame(f.isGravity ? 3 : 1);
    const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
    w.fx.sparks(c.x, c.y - 14, 14);
    w.fx.zap(c.x, c.y - 14);
    audio.sfx('zap');
    audio.sfx('break');
    w.shake(0.004, 150);
    w.stats.emergencies++;
    if (byPlayer) w.playerCaused(`Cortocircuito en ${ROOM_NAMES[f.room]} (${cause})`);
    if (f.isGravity) {
      w.ship.gravity = false;
      w.announce('gravityOff', {}, { room: f.room });
      bus.emit('gravity:off', cause);
    } else {
      w.announce('short', {}, { room: f.room });
    }
    bus.emit('panel:broken', f, cause, byPlayer);
  }

  private fixTo(f: Fixture) {
    if (f.kind === 'panel') {
      f.broken = false;
      f.graceT = 25;
      const c = this.w.map.tileCenter(f.spot.tx, f.spot.ty);
      if (this.w.dirt.near(c.x, c.y - 4, 20).some((d) => RESIDUES[d.type].conductive)) this.w.floatText(c.x, c.y - 24, 'Seca el suelo junto al panel o volverá a fallar', 'bad');
      f.sprite?.setFrame(f.isGravity ? 2 : 0);
      if (f.isGravity && !this.w.ship.gravity && !this.w.rules.has('gravedad_cero')) {
        this.w.ship.gravity = true;
        this.w.announce('gravityOn');
        bus.emit('gravity:on');
        for (const c of this.w.crew) if (c.available) c.fall(0, 1, 0.9);
      }
    } else {
      f.leaking = false;
      f.patched = true;
      f.sprite?.setFrame(2);
    }
  }

  repairFixture(f: Fixture) {
    const w = this.w;
    if (!(f.broken || f.leaking)) return;
    this.fixTo(f);
    w.stats.emergenciesResolved++;
    w.stats.panelsRepaired++;
    audio.sfx('ok');
    w.floatText(f.spot.tx * TILE + 8, f.spot.ty * TILE - 8, '¡Reparado!', 'good');
    bus.emit('fixture:repaired', f);
  }

  repairByCrew(t: Fixture | Prop, crew: Crew) {
    if ('spot' in t) {
      if (t.broken || t.leaking) { this.fixTo(t); this.w.stats.emergenciesResolved++; }
    } else if (t.kind === 'toilet' && t.state.clog) this.unclog(t, false);
    else if (t.kind === 'reactorConsole' && this.overheating) this.vent(false);
  }

  startLeak(f: Fixture) {
    if (f.kind !== 'pipe' || f.leaking) return false;
    f.leaking = true;
    f.patched = false;
    f.leakT = 0;
    f.sprite?.setFrame(1);
    this.w.stats.emergencies++;
    this.w.announce('leak', {}, { room: f.room });
    return true;
  }

  clogToilet(p: Prop, by?: Crew) {
    if (p.kind !== 'toilet' || p.state.clog) return false;
    p.state.clog = true;
    p.state.clogT = 0;
    p.state.overflow = false;
    p.sprite?.setFrame(1);
    this.w.stats.emergencies++;
    this.w.announce('clog', {}, { room: p.room });
    if (by) by.say('Eh… creo que he atascado algo.');
    bus.emit('toilet:clog', p);
    return true;
  }

  unclog(p: Prop, byPlayer = true) {
    if (!p.state.clog) return;
    p.state.clog = false;
    p.state.overflow = false;
    p.sprite?.setFrame(0);
    audio.sfx('plop');
    audio.sfx('flush');
    this.w.stats.emergenciesResolved++;
    if (byPlayer) this.w.floatText(p.tx * TILE + 8, p.ty * TILE - 6, '¡Plop!', 'good');
    bus.emit('toilet:unclog', p);
  }

  // ───────── fuego ─────────

  fireAt(tx: number, ty: number): FireCell | undefined { return this.fires.get(ty * MAP_W + tx); }
  fireAtPx(x: number, y: number) { return this.fireAt(Math.floor(x / TILE), Math.floor(y / TILE)); }

  firesNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const f of this.fires.values()) if (Math.hypot(f.tx * TILE + 8 - x, f.ty * TILE + 8 - y) < r) n++;
    return n;
  }

  roomFireCount(room: RoomId): number {
    let n = 0;
    for (const f of this.fires.values()) if (f.room === room) n++;
    return n;
  }

  ignite(tx: number, ty: number, i = 0.35, source?: string): boolean {
    const m = this.w.map;
    if (!m.inb(tx, ty)) return false;
    const t = m.tile(tx, ty);
    if (t !== Tile.Floor && t !== Tile.Door) return false;
    if (m.propAt[m.idx(tx, ty)]) return false;
    const k = ty * MAP_W + tx;
    if (this.fires.has(k)) return false;
    // una casilla quemada (o empapada de espuma) tarda en volver a arder
    if ((this.scorched.get(k) ?? -1) > this.w.t) return false;
    if (this.fires.size >= 34) return false;
    const room = m.roomAt[m.idx(tx, ty)];
    if (room && this.roomFireCount(room) >= 14) return false;
    const x = tx * TILE + 8, y = ty * TILE + 14;
    const sprite = this.w.add.sprite(x, y, 'fx_fire', 0).setOrigin(0.5, 1).setDepth(sortDepth(y) + 0.003).setScale(HD * 0.6);
    const glow = this.w.add.image(x, y - 6, 'fx_glow').setTint(0xff7a2a).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
    this.fires.set(k, { tx, ty, i, age: 0, room, sprite, glow, ph: Math.random() * 10 });
    if (room && !this.fireRooms.has(room)) {
      this.fireRooms.add(room);
      this.w.stats.emergencies++;
      this.w.announce('fire', {}, { room });
      audio.sfx('alarm');
      bus.emit('fire:start', room, source);
    }
    this.w.stats.maxFireCells = Math.max(this.w.stats.maxFireCells, this.fires.size);
    return true;
  }

  extinguish(cell: FireCell, amount: number, byPlayer: boolean) {
    cell.i -= amount;
    if (Math.random() < 0.3) this.w.fx.steamPuff(cell.tx * TILE + 8, cell.ty * TILE + 6);
    if (cell.i <= 0) this.removeFire(cell, byPlayer);
  }

  private removeFire(cell: FireCell, byPlayer: boolean) {
    const k = cell.ty * MAP_W + cell.tx;
    if (!this.fires.has(k)) return;
    this.fires.delete(k);
    this.scorched.set(k, this.w.t + 45);
    cell.sprite.destroy();
    cell.glow.destroy();
    this.w.dirt.add('hollin', cell.tx * TILE + 8 + (Math.random() - 0.5) * 6, cell.ty * TILE + 10, 0.55);
    if (byPlayer) this.w.stats.fireCellsOut++;
    const room = cell.room;
    if (room && this.roomFireCount(room) === 0 && this.fireRooms.has(room)) {
      this.fireRooms.delete(room);
      this.w.stats.emergenciesResolved++;
      audio.sfx('ok');
      bus.emit('fire:out', room);
    }
  }

  nearestFire(x: number, y: number, room?: RoomId): FireCell | null {
    let best: FireCell | null = null, bd = 1e9;
    for (const f of this.fires.values()) {
      if (room && f.room !== room) continue;
      const d = Math.hypot(f.tx * TILE + 8 - x, f.ty * TILE + 10 - y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  freezePipe(f: Fixture) {
    if (f.frozenT > this.w.t) return;
    f.frozenT = this.w.t + 40;
    f.sprite?.setFrame(3);
    this.w.floatText(f.tx * TILE + 8, f.ty * TILE + 4, 'Fuga congelada (40 s)', 'good');
    audio.sfx('freeze');
  }

  // ───────── brechas / fugas de oxígeno ─────────

  startBreach(room: RoomId): Breach | null {
    if (this.breaches.some((b) => !b.sealed && b.room === room)) return null;
    const tiles = this.w.map.wallFaceTiles(room).filter((t) => !this.breaches.some((b) => b.tx === t.tx && b.ty === t.ty));
    if (!tiles.length) return null;
    const t = this.w.rng.pick(tiles);
    const x = t.tx * TILE + 8, y = t.ty * TILE + 10;
    const sprite = this.w.add.sprite(x, y, 'fix_breach', 0).setDepth(DEPTH.wallFix + 0.1).setScale(HD);
    const b: Breach = { id: this.breachId++, room, tx: t.tx, ty: t.ty, x, y: t.ty * TILE + 16, seal: 0, sealed: false, sprite, t: 0 };
    this.breaches.push(b);
    this.w.stats.emergencies++;
    this.w.shake(0.008, 300);
    audio.sfx('explosion');
    this.w.fx.debris(x, y);
    this.w.announce('breach', {}, { room });
    bus.emit('breach:start', b);
    return b;
  }

  seal(b: Breach, amount: number, byPlayer: boolean) {
    if (b.sealed) return;
    b.seal = Math.min(1, b.seal + amount);
    if (b.seal >= 1) {
      b.sealed = true;
      b.sprite.setFrame(2);
      audio.sfx('seal');
      this.w.stats.emergenciesResolved++;
      this.w.stats.breachesSealed++;
      this.w.floatText(b.x, b.y - 18, '¡Brecha sellada!', 'good');
      this.w.announce('breachSealed');
      bus.emit('breach:sealed', b, byPlayer);
    }
  }

  breachIn(room: RoomId) { return this.breaches.some((b) => !b.sealed && b.room === room); }

  /** Fuerza de succión hacia brechas abiertas en la misma sala. */
  pullAt(x: number, y: number, actor?: Actor): { x: number; y: number } {
    const out = { x: 0, y: 0 };
    if (!this.breaches.length) return out;
    const room = this.w.map.roomAtPx(x, y);
    const zeroG = this.w.ship.zeroG;
    for (const b of this.breaches) {
      if (b.sealed || b.room !== room) continue;
      const dx = b.x - x, dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d > 110 || d < 1) continue;
      const s = 34 * (1 - d / 110) * (zeroG ? 2.4 : 1) * (1 - b.seal * 0.8);
      out.x += (dx / d) * s;
      out.y += (dy / d) * s;
      if (actor && d < 14 && Math.random() < 0.05 && this.w.players.includes(actor as any)) (actor as any).hurt(1, 'succión');
    }
    return out;
  }

  // ───────── reactor ─────────

  startOverheat() {
    if (this.overheating) return false;
    this.overheating = true;
    this.reactorHeat = Math.max(this.reactorHeat, 55);
    this.w.stats.emergencies++;
    this.w.announce('reactor', {}, { room: 'ingenieria' });
    audio.sfx('alarm');
    return true;
  }

  vent(byPlayer = true) {
    if (!this.overheating) return;
    this.overheating = false;
    this.reactorHeat = 20;
    const rc = this.w.map.props.find((p) => p.kind === 'reactorConsole');
    if (rc) {
      const x = rc.tx * TILE + 8, y = rc.ty * TILE + 12;
      this.w.fx.steamPuff(x, y - 10);
      this.w.fx.steamPuff(x - 20, y - 18);
      this.w.dirt.add('agua', x - 18, y + 10, 0.6);
    }
    audio.sfx('steam');
    this.w.stats.emergenciesResolved++;
    bus.emit('reactor:vented', byPlayer);
  }

  private reactorBoom() {
    const w = this.w;
    const reactor = w.map.props.find((p) => p.kind === 'reactor');
    if (!reactor) return;
    w.ship.damage(10);
    w.shake(0.02, 600);
    audio.sfx('explosion');
    w.fx.explosion(reactor.tx * TILE + 16, reactor.ty * TILE + 16);
    for (const s of reactor.spots.slice(0, 4)) this.ignite(s.tx, s.ty, 0.7, 'el reactor');
    for (let i = 0; i < 3; i++) w.dirt.add('hollin', reactor.tx * TILE + w.rng.range(-10, 42), reactor.ty * TILE + w.rng.range(30, 44), 0.8);
    w.dirt.add('aceite', reactor.tx * TILE + 30, reactor.ty * TILE + 36, 0.8);
    w.stats.reactorBooms++;
    w.announce('reactorBoom');
    this.reactorHeat = 50;
    bus.emit('reactor:boom');
  }

  // ───────── evaluación de amenaza ─────────

  roomThreat(room: RoomId): number {
    if (this.w.clientSync) return this.w.clientSync.isThreat(room) ? 1 : 0;
    let t = this.roomFireCount(room);
    if (this.breachIn(room)) t += 3;
    for (const c of this.w.creatures) if (c.alive && !c.hidden && this.w.map.roomAtPx(c.x, c.y) === room) t += 2;
    if (room === 'ingenieria' && this.overheating && this.reactorHeat > 80) t += 1;
    return t;
  }

  /** Carga de caos actual (la usa el Director). */
  threatLoad(): number {
    const w = this.w;
    let load = 0;
    const rooms = new Map<RoomId, number>();
    for (const f of this.fires.values()) if (f.room) rooms.set(f.room, (rooms.get(f.room) ?? 0) + 1);
    for (const n of rooms.values()) load += 1.2 + n * 0.06;
    load += this.breaches.filter((b) => !b.sealed).length * 2.5;
    for (const f of w.map.fixtures) {
      if (f.broken) load += f.isGravity ? 2 : 0.6;
      if (f.leaking) load += 0.4;
    }
    for (const p of w.map.props) if (p.kind === 'toilet' && p.state.clog) load += p.state.overflow ? 0.6 : 0.4;
    if (this.overheating) load += 1.5;
    for (const c of w.creatures) if (c.alive) load += 1 + (c.aggressive ? 1 : 0);
    if (this.blackoutT > 0) load += 0.8;
    if (this.stormT > 0) load += 0.3;
    if (this.partyT > 0) load += 0.5;
    if (w.inspector && w.inspector.state !== 'gone') load += 0.8;
    for (const c of w.crew) if (c.state === 'knocked') load += 0.5;
    return load;
  }

  alerts(): AlertInfo[] {
    const w = this.w;
    const out: AlertInfo[] = [];
    const rooms = new Map<RoomId, { n: number; x: number; y: number }>();
    for (const f of this.fires.values()) {
      if (!f.room) continue;
      const r = rooms.get(f.room) ?? { n: 0, x: f.tx * TILE + 8, y: f.ty * TILE + 8 };
      r.n++;
      rooms.set(f.room, r);
    }
    for (const [room, r] of rooms) {
      const oily = w.dirt.list.some((d) => d.room === room && RESIDUES[d.type].flammable);
      out.push({ id: `fire:${room}`, icon: 'fire', title: `Incendio (${r.n} focos)`, room, x: r.x, y: r.y, sev: r.n > 6 ? 3 : 2,
        risk: oily ? 'Hay residuos inflamables: se propagará rápido.' : 'Puede extenderse por las puertas. Usa la espuma (2).' });
    }
    const drain = this.breaches.filter((b) => !b.sealed).length * 0.85;
    for (const b of this.breaches) {
      if (b.sealed) continue;
      out.push({ id: `breach:${b.id}`, icon: 'breach', title: `Fuga de oxígeno · sellado ${Math.round(b.seal * 100)} %`, room: b.room, x: b.x, y: b.y, sev: 3,
        risk: 'Succiona objetos y personas. Espuma o [E] para parchear.', timer: drain > 0 ? w.ship.oxygen / drain : undefined, timerLabel: 'O₂ agotado en' });
    }
    for (const f of w.map.fixtures) {
      const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
      if (f.broken) {
        const wetNear = w.dirt.near(c.x, c.y, 44).some((d) => RESIDUES[d.type].conductive);
        out.push({ id: `panel:${f.id}`, icon: f.isGravity ? 'gravity' : 'panel', title: f.isGravity ? 'Gravedad desactivada' : 'Cortocircuito', room: f.room, x: c.x, y: c.y - 8, sev: f.isGravity ? 3 : 2,
          risk: wetNear ? '¡Charcos electrificados cerca!' : f.isGravity ? 'Todo flota. Repara el panel del puente.' : 'Chispas: con aceite cerca, incendio.' });
      }
      if (f.leaking) out.push({ id: `pipe:${f.id}`, icon: 'pipe', title: 'Tubería con fugas', room: f.room, x: c.x, y: c.y - 8, sev: 1, risk: 'El agua conduce la electricidad.' });
    }
    for (const p of w.map.props) {
      if (p.kind !== 'toilet' || !p.state.clog) continue;
      const x = p.tx * TILE + 8, y = p.ty * TILE + 8;
      if (p.state.overflow) out.push({ id: `toilet:${p.id}`, icon: 'toilet', title: 'Inodoro desbordado', room: p.room, x, y, sev: 2, risk: 'Aguas residuales: asco, enfermedad y cortocircuitos.' });
      else out.push({ id: `toilet:${p.id}`, icon: 'toilet', title: 'Inodoro atascado', room: p.room, x, y, sev: 1, timer: Math.max(0, 18 - p.state.clogT), timerLabel: 'Desborde en' });
    }
    if (this.overheating) {
      const rc = w.map.props.find((p) => p.kind === 'reactorConsole');
      const rate = 1.6 * w.cfg.difficulty;
      out.push({ id: 'reactor', icon: 'reactor', title: `Reactor a ${Math.round(this.reactorHeat)} %`, room: 'ingenieria', x: (rc?.tx ?? 0) * TILE + 8, y: (rc?.ty ?? 0) * TILE + 8, sev: 3,
        risk: 'Purga la consola del reactor con [E].', timer: (100 - this.reactorHeat) / rate, timerLabel: 'Explosión en' });
    }
    // criaturas agrupadas por especie y sala (un enjambre = una alerta)
    const groups = new Map<string, { c: (typeof w.creatures)[number]; n: number; room: RoomId; hidden: boolean }>();
    for (const c of w.creatures) {
      if (!c.alive || c === w.bosses.glorp) continue;
      const room = w.map.roomAtPx(c.x, c.y) ?? 'pasillo';
      const key = `creatures:${c.species}:${room}`;
      const g = groups.get(key);
      if (g) { g.n++; g.hidden = g.hidden && c.hidden; if (c.aggressive && !g.c.aggressive) g.c = c; }
      else groups.set(key, { c, n: 1, room, hidden: c.hidden });
    }
    for (const [id, g] of groups) {
      const c = g.c, sp = c.species;
      const icon = sp === 'invasor' ? 'invasor' : sp === 'rata' ? 'rata' : sp === 'insecto' ? 'insecto' : sp === 'rogue' ? 'alarm' : 'creature';
      const risk = sp === 'invasor' ? 'Seguridad se encarga del combate. Mantente lejos y limpia lo que quede.'
        : sp === 'rata' ? 'Vuelcan papeleras. Trampas o aspiradora.'
        : sp === 'insecto' ? 'Muerden cables y paneles. Aspiradora o trampas.'
        : sp === 'babosa' ? 'Lenta pero dura. Deja baba por todas partes: espuma y fregona.'
        : sp === 'rogue' ? 'Atráela a un charco: se cortocircuita.'
        : c.aggressive ? 'Muerde. Espuma + aspiradora para capturarla.' : 'Come suciedad y crece. El agua la multiplica.';
      const name = sp === 'glorp' ? (c.aggressive ? 'Glorp AGRESIVO' : 'Glorp') : c.sp.name;
      const title = `${g.hidden ? `${name} escondido` : name}${g.n > 1 ? ` ×${g.n}` : ''}`;
      const sev: 1 | 2 | 3 = sp === 'invasor' || c.aggressive ? 3 : sp === 'insecto' || sp === 'rata' ? 1 : 2;
      out.push({ id, icon, title, room: g.room, x: c.x, y: c.y, sev, risk });
    }
    for (const c of w.crew) {
      if (c.state !== 'knocked') continue;
      out.push({ id: `rescue:${c.uid}`, icon: 'rescue', title: `Herido: ${c.name}`, room: c.room() ?? 'pasillo', x: c.x, y: c.y, sev: 2, risk: 'Acércate y pulsa [E] para reanimarlo.', timer: 55 - c.knockedT, timerLabel: 'Evacuación en' });
    }
    if (this.blackoutT > 0) out.push({ id: 'blackout', icon: 'power', title: 'Apagón general', room: 'puente', x: 0, y: 0, sev: 1, timer: this.blackoutT, timerLabel: 'Restablecimiento', risk: 'Reinicia la energía desde la mesa de control del puente.' });
    if (this.stormT > 0) out.push({ id: 'storm', icon: 'storm', title: 'Tormenta espacial', room: 'pasillo', x: 0, y: 0, sev: 1, timer: this.stormT, timerLabel: 'Fin en', risk: 'Controles invertidos a ratos.' });
    if (this.partyT > 0) out.push({ id: 'party', icon: 'party', title: 'Fiesta del capitán', room: 'comedor', x: 0, y: 0, sev: 1, timer: this.partyT, timerLabel: 'Fin en', risk: 'Confeti, café y comida por todas partes.' });
    const insp = w.inspector;
    if (insp && insp.state !== 'gone' && insp.state !== 'leave') {
      const left = insp.inspectRoute.slice(insp.inspectI).map((r) => ROOM_NAMES[r]).join(' → ');
      out.push({ id: 'inspector', icon: 'inspector', title: 'Inspección corporativa', room: insp.room() ?? 'pasillo', x: insp.x, y: insp.y, sev: 2, risk: `Ruta: ${left}` });
    }
    return out;
  }

  // ───────── bucle ─────────

  update(dt: number) {
    const w = this.w;
    this.tick -= dt;
    const logic = this.tick <= 0;
    if (logic) this.tick = 0.25;
    const t = w.t;

    // fuego
    let heat = 0;
    for (const cell of [...this.fires.values()]) {
      const flick = 0.85 + Math.sin(t * 13 + cell.ph) * 0.1;
      cell.sprite.setFrame(Math.floor(t * 10 + cell.ph) % 4);
      cell.sprite.setScale((0.55 + 0.5 * Math.min(1, cell.i)) * flick * HD);
      cell.glow.setScale(0.9 + cell.i * 0.6).setAlpha(0.35 + 0.25 * flick * Math.min(1, cell.i));
      if (Math.random() < dt * 1.5) w.fx.smoke(cell.tx * TILE + 8, cell.ty * TILE);
      if (!logic) continue;
      const cx = cell.tx * TILE + 8, cy = cell.ty * TILE + 10;
      const fuel = w.dirt.near(cx, cy, 11).filter((d) => RESIDUES[d.type].flammable);
      if (fuel.length) {
        cell.i = Math.min(1.2, cell.i + 0.1);
        for (const d of fuel) {
          d.amount -= 0.08;
          if (d.amount <= 0) { w.dirt.remove(d, 'fire'); w.dirt.add('hollin', d.x, d.y, 0.5); }
          else w.dirt.refresh(d);
        }
      } else cell.i = Math.min(1, cell.i + 0.035);
      cell.age += 0.25;
      if (cell.age > 30 && !fuel.length) cell.i -= 0.06;
      if (cell.i <= 0) { this.removeFire(cell, false); continue; }
      // propagación
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cell.tx + dx, ny = cell.ty + dy;
        if (!w.map.isWalkable(nx, ny) || this.fireAt(nx, ny)) continue;
        // las puertas cerradas actúan como cortafuegos
        const door = w.map.doorAt[w.map.idx(nx, ny)];
        if (door && door.open < 0.5) continue;
        const flam = w.dirt.near(nx * TILE + 8, ny * TILE + 10, 10).some((d) => RESIDUES[d.type].flammable);
        const p = 0.016 * cell.i + (flam ? 0.3 : 0);
        if (Math.random() < p) this.ignite(nx, ny, 0.3);
      }
      heat += cell.i;
      w.ship.oxygen = Math.max(0, w.ship.oxygen - 0.012 * cell.i);
    }
    if (logic && heat > 0) {
      // daño estructural progresivo pero no lineal: un gran incendio es grave, no instantáneo
      w.ship.damage(0.028 * Math.sqrt(heat));
      // protocolo antiincendios automático si un fuego grande sigue activo
      const counts = new Map<RoomId, number>();
      for (const f of this.fires.values()) if (f.room) counts.set(f.room, (counts.get(f.room) ?? 0) + 1);
      for (const r of w.map.rooms) {
        const n = counts.get(r.id) ?? 0;
        const bt = n >= 8 ? (this.bigFireT.get(r.id) ?? 0) + 0.25 : 0;
        this.bigFireT.set(r.id, bt);
        if (bt >= 22) {
          this.bigFireT.set(r.id, -40);
          w.suppressFire(r.id, true);
        }
      }
    }
    audio.loop('fire', Math.min(1, this.fires.size / 6));

    // paneles rotos: chispas, ignición y electrocución; agua en paneles sanos
    this.sparkT -= dt;
    for (const f of w.map.fixtures) {
      const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
      if (f.kind === 'panel') {
        if (f.broken) {
          f.sparkT -= dt;
          if (f.sparkT <= 0) {
            f.sparkT = 0.3 + Math.random() * 0.7;
            w.fx.sparks(c.x + (Math.random() - 0.5) * 8, c.y - 12, 4);
            if (this.sparkT <= 0) { audio.sfx('spark'); this.sparkT = 0.5; }
          }
          if (logic) {
            for (const d of w.dirt.near(c.x, c.y, 28)) {
              if (RESIDUES[d.type].flammable && Math.random() < 0.05) { this.ignite(Math.floor(d.x / TILE), Math.floor(d.y / TILE), 0.4, 'las chispas'); break; }
            }
          }
        } else if (logic && (f.graceT -= 0.25) <= 0) {
          const wetHit = w.dirt.near(c.x, c.y - 4, 13).some((d) => RESIDUES[d.type].conductive && d.amount > 0.3);
          if (wetHit && Math.random() < 0.025) this.breakPanel(f, 'el agua llegó al panel', false);
        }
      } else if (f.leaking && f.frozenT > w.t) {
        f.sprite?.setFrame(3);
      } else if (f.leaking) {
        if (f.sprite && f.sprite.frame.name !== '1' && (f.sprite.frame.name as any) !== 1) f.sprite.setFrame(1);
        f.leakT -= dt;
        if (Math.random() < dt * 3) w.fx.drip(c.x + (Math.random() - 0.5) * 6, c.y - 8);
        if (f.leakT <= 0) {
          f.leakT = 2.6;
          w.dirt.add('agua', c.x + w.rng.range(-8, 8), c.y + w.rng.range(-2, 10), 0.55);
        }
      }
    }

    // inodoros
    for (const p of w.map.props) {
      if (p.kind !== 'toilet' || !p.state.clog) continue;
      p.state.clogT += dt;
      if (!p.state.overflow && p.state.clogT > 18) {
        p.state.overflow = true;
        p.sprite?.setFrame(2);
        w.announce('overflow', {}, { room: p.room });
        audio.sfx('flush');
      }
      if (p.state.overflow) {
        p.state.spillT = (p.state.spillT ?? 0) - dt;
        if (p.state.spillT <= 0) {
          p.state.spillT = 2.4;
          const s = p.spots[0];
          if (s) {
            const c = w.map.tileCenter(s.tx, s.ty);
            const r = Math.min(30, 6 + (p.state.clogT - 18) * 0.8);
            w.dirt.add('aguas', c.x + w.rng.range(-r, r), c.y + w.rng.range(-4, r), 0.65);
          }
        }
      }
    }

    // brechas
    let open = 0;
    for (const b of this.breaches) {
      if (b.sealed) continue;
      open++;
      b.t += dt;
      b.sprite.setFrame(Math.floor(t * 6) % 2);
      const room = w.map.room(b.room);
      const locked = room.doors.length > 0 && room.doors.every((d) => d.locked);
      w.ship.oxygen = Math.max(0, w.ship.oxygen - (locked ? 0.4 : 0.85) * dt);
      w.dirt.pullToward(b.x, b.y, 110, 30 * (w.ship.zeroG ? 2 : 1), dt, b.room);
      if (Math.random() < dt * 14) w.fx.gasStream(b.x, b.y, room);
    }
    audio.loop('leak', Math.min(1, open));

    // reactor
    const reactor = w.map.props.find((p) => p.kind === 'reactor');
    if (this.overheating) {
      this.reactorHeat += 1.6 * w.cfg.difficulty * dt;
      if (this.reactorHeat >= 100) this.reactorBoom();
      if (reactor?.sprite) reactor.sprite.setFrame(this.reactorHeat > 70 && Math.floor(t * 4) % 2 ? 2 : Math.floor(t * 2) % 2);
      if (Math.random() < dt * 2) w.fx.steamPuff(reactor!.tx * TILE + 16, reactor!.ty * TILE);
    } else {
      this.reactorHeat += (25 - this.reactorHeat) * dt * 0.2;
      if (reactor?.sprite) reactor.sprite.setFrame(Math.floor(t * 2) % 2);
    }

    // estados temporales
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      if (this.blackoutT <= 0) { w.announce('power'); w.stats.emergenciesResolved++; }
    }
    if (this.stormT > 0) {
      this.stormT -= dt;
      if (Math.random() < dt * 0.45) { for (const p of w.players) p.invertT = 2.2; w.flashScreen(0x7a4aff); audio.sfx('zap'); }
    }
    if (this.partyT > 0) {
      this.partyT -= dt;
      audio.party = this.partyT > 0;
      if (Math.random() < dt * 2) {
        const r = w.map.room('comedor');
        w.fx.confetti((r.x + w.rng.range(1, r.w - 1)) * TILE, (r.y + w.rng.range(1, r.h - 1)) * TILE);
      }
    }
  }

  destroyAll() {
    // en el invitado los fuegos y brechas son datos sin sprite (los sprites llegan replicados)
    for (const f of this.fires.values()) { f.sprite?.destroy(); f.glow?.destroy(); }
    this.fires.clear();
    for (const b of this.breaches) b.sprite?.destroy();
    this.breaches = [];
    audio.loop('fire', 0);
    audio.loop('leak', 0);
  }
}
