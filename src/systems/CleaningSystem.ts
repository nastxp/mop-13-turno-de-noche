import Phaser from 'phaser';
import { DEPTH } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { norm } from '../core/util';
import { HD } from '../gfx/sprites';
import { RESIDUES } from '../data/residues';
import type { Player } from '../entities/Player';
import type { Crew } from '../entities/Crew';
import type { Dirt } from './ContaminationSystem';
import type { GameScene } from '../scenes/GameScene';

interface Wet { x: number; y: number; t: number; sprite: Phaser.GameObjects.Image }
type PKind = 'foam' | 'mist' | 'ice';
interface Particle { kind: PKind; x: number; y: number; vx: number; vy: number; life: number; sprite: Phaser.GameObjects.Image; npc: Crew | null }

/** temporizadores propios de cada conserje (en multijugador hay varios usando herramientas a la vez) */
interface PState { wetTimer: number; mopSoundT: number; smearT: number; hitCd: number; sprayAcc: number; suckFxT: number }

/** Herramientas de limpieza y sus efectos (buenos y malos) sobre el mundo. */
export class CleaningSystem {
  wet: Wet[] = [];
  parts: Particle[] = [];
  /** chorros de extintor de la tripulación activos (el anfitrión los envía a los invitados) */
  npcSprays = new Map<Crew, { x: number; y: number; tx: number; ty: number; t: number }>();
  private ps = new Map<Player, PState>();
  private npcAcc = new Map<Crew | string, number>();
  private warnedPanel = 0;
  private warnedSat = 0;
  private warnedLiquid = 0;
  private loop: 'spray' | 'vacuum' | null = null;

  constructor(private w: GameScene) {}

  private st(p: Player): PState {
    let s = this.ps.get(p);
    if (!s) this.ps.set(p, (s = { wetTimer: 0, mopSoundT: 0, smearT: 0, hitCd: 0, sprayAcc: 0, suckFxT: 0 }));
    return s;
  }

  /** invitado: solo efectos visuales; la lógica (quitar suciedad, gastar carga…) la hace el anfitrión */
  private get visualOnly() { return this.w.netRole === 'client'; }

  /** efectos continuos de la herramienta de un conserje concreto: su propia pantalla ya los dibuja */
  private owned(p: Player, fn: () => void) {
    const prev = this.w.fxOwner;
    this.w.fxOwner = p.netPid;
    try { fn(); } finally { this.w.fxOwner = prev; }
  }

  forget(p: Player) { this.ps.delete(p); }

  wetAt(x: number, y: number): number {
    let v = 0;
    for (const p of this.wet) if (Math.abs(p.x - x) < 11 && Math.abs(p.y - y) < 8) v = Math.max(v, p.t / 4);
    return v;
  }

  stopLoops() {
    if (this.loop) audio.loop(this.loop, 0);
    this.loop = null;
  }

  private setLoop(p: Player, l: 'spray' | 'vacuum' | null, level = 1) {
    if (!p.isLocal) return;
    if (this.loop && this.loop !== l) audio.loop(this.loop, 0);
    this.loop = l;
    if (l) audio.loop(l, level);
  }

  use(p: Player, dt: number) {
    if (this.visualOnly) { this.useVisual(p, dt); return; }
    switch (p.tool) {
      case 'fregona': this.setLoop(p, null); this.mop(p, dt, false); break;
      case 'superfregona': this.setLoop(p, null); this.mop(p, dt, true); break;
      case 'espuma': this.spray(p, dt, 'foam'); break;
      case 'desinfectante': this.spray(p, dt, 'mist'); break;
      case 'crio': this.spray(p, dt, 'ice'); break;
      case 'aspiradora': this.vacuum(p, dt); break;
      default: this.setLoop(p, null);
    }
  }

  /** INVITADO: dibuja la herramienta en uso (propia o de otro conserje) sin tocar el mundo */
  private useVisual(p: Player, dt: number) {
    const w = this.w;
    const s = this.st(p);
    const tool = p.tool;
    if (tool === 'fregona' || tool === 'superfregona') {
      this.setLoop(p, null);
      const head = p.mopHead();
      if (w.dirt.near(head.x, head.y, 19).length && Math.random() < dt * 8) w.fx.splash(head.x, head.y, tool === 'superfregona' ? 0x5af0ff : 0xbfe6ff);
      s.wetTimer -= dt;
      if (s.wetTimer <= 0 && tool === 'fregona') {
        s.wetTimer = 0.22;
        const sprite = w.add.image(head.x, head.y, 'fx_wet').setDepth(DEPTH.wet).setAlpha(0.9).setScale(HD);
        this.wet.push({ x: head.x, y: head.y, t: 4, sprite });
        if (this.wet.length > 60) { const o = this.wet.shift(); o?.sprite.destroy(); }
      }
      s.mopSoundT -= dt;
      if (s.mopSoundT <= 0 && p.isLocal) { s.mopSoundT = 0.28; audio.sfx('mop'); }
    } else if (tool === 'espuma' || tool === 'desinfectante' || tool === 'crio') {
      const kind: PKind = tool === 'espuma' ? 'foam' : tool === 'desinfectante' ? 'mist' : 'ice';
      if (p.isLocal && p.toolState.charge <= 0) { this.setLoop(p, null); return; }
      this.setLoop(p, 'spray', kind === 'mist' ? 0.6 : 1);
      this.emitSpray(p, s, dt, kind);
    } else if (tool === 'aspiradora') {
      this.setLoop(p, 'vacuum', 1);
      const h = p.hand();
      s.suckFxT -= dt;
      if (s.suckFxT <= 0) { s.suckFxT = 0.05; w.fx.suck(h.x + p.aim.x * 8, h.y + 5 + p.aim.y * 8, Math.atan2(p.aim.y, p.aim.x)); }
    } else this.setLoop(p, null);
  }

  /** INVITADO: chorro de extintor de un tripulante (estado recibido del anfitrión) */
  visualNpcSpray(key: string, sx: number, sy: number, tx: number, ty: number, dt: number) {
    let acc = (this.npcAcc.get(key) ?? 0) + dt * 22;
    while (acc >= 1) {
      acc -= 1;
      const ang = Math.atan2(ty - sy, tx - sx) + (Math.random() - 0.5) * 0.5;
      const sp = 120 + Math.random() * 30;
      this.emit('foam', sx, sy, Math.cos(ang) * sp, Math.sin(ang) * sp, null);
    }
    this.npcAcc.set(key, acc);
  }

  private emitSpray(p: Player, s: PState, dt: number, kind: PKind) {
    s.sprayAcc += dt * (kind === 'mist' ? 40 : 34);
    const h = p.hand();
    while (s.sprayAcc >= 1) {
      s.sprayAcc -= 1;
      const spread = kind === 'mist' ? 0.8 : kind === 'ice' ? 0.3 : 0.45;
      const ang = Math.atan2(p.aim.y, p.aim.x) + (Math.random() - 0.5) * spread;
      const sp = kind === 'mist' ? 95 + Math.random() * 30 : 140 + Math.random() * 40;
      this.emit(kind, h.x + p.aim.x * 7, h.y + p.aim.y * 7, Math.cos(ang) * sp, Math.sin(ang) * sp, null);
    }
  }

  private cleanDirt(d: Dirt, rate: number, sat: (removed: number) => void) {
    const w = this.w;
    const removed = Math.min(d.amount, rate);
    d.amount -= removed;
    sat(removed);
    w.stats.amountRemoved += removed;
    if (d.art && !w.stats.artDestroyed) bus.emit('art:touched', d);
    if (d.amount <= 0.06) {
      w.fx.sparkle(d.x, d.y - 2, 5);
      audio.sfx('sparkle');
      w.dirt.remove(d, 'player');
    } else w.dirt.refresh(d);
  }

  private mop(p: Player, dt: number, superMop: boolean) {
    const w = this.w;
    const ts = p.toolState;
    const s = this.st(p);
    if (ts.broken) return;
    const head = p.mopHead();
    const sat = superMop ? 0 : ts.charge / ts.cap;
    const eff = (sat > 0.85 ? 0.5 : 1) * (1 + 0.25 * (w.upg.fregona_absorbente ?? 0)) * (superMop ? 2 : 1);
    const reach = superMop ? 40 : 19;
    let cleaned = false;
    const targets = new Map<Dirt, number>();
    for (const d of w.dirt.near(head.x, head.y, reach)) targets.set(d, 1);
    for (const d of w.dirt.near(p.x, p.y + 2, 12)) if (!targets.has(d)) targets.set(d, 0.6);
    for (const [d, k] of targets) {
      const def = RESIDUES[d.type];
      const mult = def.solid && !def.liquid ? 0.75 : 1;
      this.cleanDirt(d, ((3 * eff * mult * k) / Math.sqrt(def.effort)) * dt, (r) => { if (!superMop) ts.charge = Math.min(ts.cap, ts.charge + r * def.mopSat * 6.5); });
      cleaned = true;
    }
    if (superMop) { ts.charge = Math.max(0, ts.charge - 2.2 * dt); if (ts.charge <= 0) { ts.broken = true; p.say('La Superfregona se ha quedado sin energía. Qué pena.', true); } }
    if (cleaned && Math.random() < dt * 8) this.owned(p, () => w.fx.splash(head.x, head.y, superMop ? 0x5af0ff : 0xbfe6ff));
    if (!superMop && sat > 0.85) {
      s.smearT -= dt;
      if (s.smearT <= 0) { s.smearT = 0.7; w.dirt.add('huellas', head.x, head.y, 0.25); }
      if (w.t - this.warnedSat > 25) { this.warnedSat = w.t; p.say('La fregona está saturada. Toca aclararla.', true); w.announce('stationTip'); }
    }
    s.wetTimer -= dt;
    if (s.wetTimer <= 0 && !superMop) {
      s.wetTimer = 0.22;
      const sprite = w.netLocal(() => w.add.image(head.x, head.y, 'fx_wet').setDepth(DEPTH.wet).setAlpha(0.9).setScale(HD));
      this.wet.push({ x: head.x, y: head.y, t: 4, sprite });
      if (this.wet.length > 60) { const o = this.wet.shift(); o?.sprite.destroy(); }
    }
    s.mopSoundT -= dt;
    if (s.mopSoundT <= 0) { s.mopSoundT = 0.28; this.owned(p, () => audio.sfx('mop')); }
    if (!superMop) {
      ts.dur = Math.max(0, ts.dur - dt * (cleaned ? 0.2 : 0.08));
      if (ts.dur <= 0 && !ts.broken) { ts.broken = true; w.stats.mopsBroken++; audio.sfx('break'); p.say('¡Se ha partido la fregona! Hay otra en la Estación.', true); }
      for (const f of w.map.fixtures) {
        if (f.kind !== 'panel' || f.broken) continue;
        const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
        if (Math.hypot(c.x - head.x, c.y - 4 - head.y) < 14) {
          if (w.t - this.warnedPanel > 20) { this.warnedPanel = w.t; p.setEmote('sweat', 1.5); w.floatText(c.x, c.y - 26, '¡Agua cerca del panel!', 'bad'); }
          if (Math.random() < 0.12 * dt) w.emerg.breakPanel(f, 'fregona mojada junto al panel', true);
        }
      }
    }
    const fire = w.emerg.fireAtPx(head.x, head.y);
    if (fire) { w.emerg.extinguish(fire, 0.4 * dt, true); if (!superMop) ts.dur -= dt * 3; }
    s.hitCd -= dt;
    if (s.hitCd <= 0) {
      for (const c of w.creatures) {
        if (!c.alive || c.hidden) continue;
        if (Math.hypot(c.x - head.x, c.y - 4 - head.y) < 13 + (c.sp.fw > 30 ? 3 : 0)) { s.hitCd = 0.45; c.whack(p.x, p.y); if (p.isLocal) w.shake(0.004, 80); break; }
      }
      if (s.hitCd <= 0 && w.bosses.active && w.bosses.hitTest(head.x, head.y)) { s.hitCd = 0.5; w.bosses.hit('mop', 2); }
    }
  }

  private spray(p: Player, dt: number, kind: PKind) {
    const w = this.w;
    const ts = p.toolState;
    if (ts.charge <= 0) {
      this.setLoop(p, null);
      if (p.sayCd <= 0) p.say(kind === 'foam' ? 'Sin espuma. Recarga en la Estación.' : 'Vacío. Toca recargar en la Estación.');
      return;
    }
    this.setLoop(p, 'spray', kind === 'mist' ? 0.6 : 1);
    const use = (kind === 'foam' ? 20 : 18) * dt;
    ts.charge = Math.max(0, ts.charge - use);
    if (kind === 'foam') w.stats.foamUsed += use;
    if (kind === 'mist') w.stats.disinfectUsed += use;
    this.emitSpray(p, this.st(p), dt, kind);
  }

  private emit(kind: PKind, x: number, y: number, vx: number, vy: number, npc: Crew | null) {
    const tex = kind === 'foam' ? 'fx_foam' : kind === 'mist' ? 'fx_mist' : 'fx_star';
    const sprite = this.w.netLocal(() => this.w.add.image(x, y, tex).setDepth(DEPTH.fx).setScale(kind === 'mist' ? HD : HD * 0.6));
    if (kind === 'ice') sprite.setTint(0xa8f0ff).setBlendMode(Phaser.BlendModes.ADD);
    if (kind === 'mist') sprite.setAlpha(0.7);
    this.parts.push({ kind, x, y, vx, vy, life: kind === 'mist' ? 0.4 : 0.36 + Math.random() * 0.1, sprite, npc });
  }

  /** los ingenieros apagan fuegos con su propio extintor (visible y dejando espuma) */
  npcSpray(c: Crew, tx: number, ty: number, dt: number) {
    let acc = (this.npcAcc.get(c) ?? 0) + dt * 22;
    const sx = c.x + (c.facing === 'left' ? -5 : c.facing === 'right' ? 5 : 0), sy = c.y - 6;
    this.npcSprays.set(c, { x: sx, y: sy, tx, ty, t: this.w.t });
    while (acc >= 1) {
      acc -= 1;
      const ang = Math.atan2(ty - sy, tx - sx) + (Math.random() - 0.5) * 0.5;
      const sp = 120 + Math.random() * 30;
      this.emit('foam', sx, sy, Math.cos(ang) * sp, Math.sin(ang) * sp, c);
    }
    this.npcAcc.set(c, acc);
    if (Math.random() < dt * 3) audio.sfx('foamhit');
  }

  private vacuum(p: Player, dt: number) {
    const w = this.w;
    const ts = p.toolState;
    if (ts.broken) { this.setLoop(p, null); return; }
    const full = ts.charge >= ts.cap;
    this.setLoop(p, 'vacuum', full ? 0.4 : 1);
    if (full) { if (p.sayCd <= 0) p.say('Depósito lleno. Al vertedero del pasillo.'); return; }
    const h = p.hand();
    const nx = h.x + p.aim.x * 8, ny = h.y + 5 + p.aim.y * 8;
    const armored = !!w.upg.aspiradora_blindada;
    const aimAng = Math.atan2(p.aim.y, p.aim.x);
    for (const d of w.dirt.near(nx, ny, 40)) {
      const ang = Math.atan2(d.y - ny, d.x - nx);
      let da = Math.abs(ang - aimAng);
      if (da > Math.PI) da = Math.PI * 2 - da;
      const dist = Math.hypot(d.x - nx, d.y - ny);
      if (da > 0.7 && dist > 8) continue;
      const def = RESIDUES[d.type];
      if (d.type === 'huevos' && d.amount > 0.2 && Math.random() < dt * 0.6) {
        w.dirt.remove(d, 'player');
        if (w.rng.chance(0.3)) {
          w.spawnCreature(w.rng.chance(0.5) ? 'glorp' : 'rata', p.x + p.aim.x * 10, p.y + p.aim.y * 10, 0.7, 'tu aspiradora', true);
          w.announce('hatchVacuum');
          ts.dur = Math.max(0, ts.dur - 25);
        }
        continue;
      }
      if (def.solid) {
        const rate = 5.5 / Math.max(0.5, def.effort * 0.6);
        this.cleanDirt(d, rate * dt, (r) => { ts.charge = Math.min(ts.cap, ts.charge + r * 5); });
        if (w.dirt.list.includes(d)) { const n = norm(nx - d.x, ny - d.y); d.x += n.x * 30 * dt; d.y += n.y * 30 * dt; d.sprite.setPosition(Math.round(d.x), Math.round(d.y)); }
      } else if (def.liquid) {
        this.cleanDirt(d, (armored ? 1.4 : 0.6) * dt, (r) => { ts.charge = Math.min(ts.cap, ts.charge + r * 12); });
        if (!armored) {
          ts.dur = Math.max(0, ts.dur - 22 * dt);
          if (Math.random() < dt * 6) w.fx.sparks(nx, ny, 3);
          if (w.t - this.warnedLiquid > 15) { this.warnedLiquid = w.t; p.say('¡Chisporrotea! Las aspiradoras y los líquidos no se llevan.', true); audio.sfx('zap'); }
          if (ts.dur <= 0 && !ts.broken) {
            ts.broken = true;
            w.stats.vacuumsBroken++;
            audio.sfx('break');
            w.playerCaused(`Aspiradora averiada por aspirar ${def.name}`);
            if (w.dirt.near(p.x, p.y, 30).some((x) => RESIDUES[x.type].flammable)) w.emerg.ignite(Math.floor(p.x / 16), Math.floor((p.y + 8) / 16), 0.4, 'la aspiradora averiada');
          }
        }
      }
    }
    const s = this.st(p);
    s.suckFxT -= dt;
    if (s.suckFxT <= 0) { s.suckFxT = 0.05; this.owned(p, () => w.fx.suck(nx, ny, aimAng)); }
    for (const c of w.creatures) {
      if (!c.alive || c.hidden) continue;
      const dist = Math.hypot(c.x - nx, c.y - 4 - ny);
      if (dist > 30) continue;
      if (c === w.bosses.glorp) {
        if (c.stunned && Math.random() < dt * 2) w.bosses.glorpCaptureAttempt(c);
        continue;
      }
      if (c.stunned || c.size < 0.7 || c.sp.smallCapture) {
        if (c.species === 'invasor' && !c.stunned) continue;
        c.capture(nx, ny);
        ts.charge = Math.min(ts.cap, ts.charge + 25);
      } else {
        const n = norm(nx - c.x, ny - c.y);
        c.vx += n.x * 40 * dt; c.vy += n.y * 40 * dt;
        if (Math.random() < dt) c.setEmote('anger', 1);
      }
    }
  }

  update(dt: number) {
    const w = this.w;
    for (const [c, sp] of this.npcSprays) if (w.t - sp.t > 0.3) this.npcSprays.delete(c);
    for (let i = this.wet.length - 1; i >= 0; i--) {
      const p = this.wet[i];
      p.t -= dt;
      p.sprite.setAlpha(Math.max(0, p.t / 4) * 0.9);
      if (p.t <= 0) { p.sprite.destroy(); this.wet.splice(i, 1); }
    }
    const espumaUp = (1 + 0.5 * (w.upg.espuma_xl ?? 0)) * (w.spec === 'emergencias' ? 1.5 : 1);
    const disUp = (1 + 0.5 * (w.upg.desinfectante_plus ?? 0)) * (w.spec === 'sanitario' ? 1.6 : 1) / (w.memoryMoldResist ? 1.3 : 1);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const f = this.parts[i];
      f.life -= dt;
      const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
      let dead = f.life <= 0;
      if (w.map.isSolidPx(nx, ny + 6)) dead = true;
      else { f.x = nx; f.y = ny; }
      const damp = f.kind === 'mist' ? 3.2 : 2.2;
      f.vx *= 1 - dt * damp; f.vy *= 1 - dt * damp;
      if (f.kind === 'mist') f.sprite.setPosition(f.x, f.y).setScale(HD * (1 + (0.4 - f.life) * 6)).setAlpha(Math.max(0, f.life * 1.6));
      else f.sprite.setPosition(Math.round(f.x), Math.round(f.y)).setScale(Math.min(1.4 * HD, f.sprite.scale + dt * 2 * HD));
      const byPlayer = !f.npc;
      if (this.visualOnly) { if (dead) { f.sprite.destroy(); this.parts.splice(i, 1); } continue; }
      if (f.kind === 'foam') {
        const fire = w.emerg.fireAtPx(f.x, f.y + 6);
        if (fire) { w.emerg.extinguish(fire, 0.055 * espumaUp, byPlayer); dead = dead || Math.random() < 0.6; }
        for (const b of w.emerg.breaches) if (!b.sealed && Math.hypot(b.x - f.x, b.y - f.y) < 16) { w.emerg.seal(b, 0.03 * espumaUp, byPlayer); dead = true; audio.sfx('foamhit'); }
        for (const t of w.map.props) {
          if (t.kind !== 'toilet' || !byPlayer) continue;
          if (Math.hypot(t.tx * 16 + 8 - f.x, t.ty * 16 + 10 - f.y) < 10) {
            if (!(t.state.sealedT > w.t)) { t.sprite?.setTint(0xe8f4ff); w.floatText(t.tx * 16 + 8, t.ty * 16 - 4, 'Inodoro sellado', 'good'); }
            t.state.sealedT = w.t + 60;
            dead = true;
          }
        }
        if (byPlayer) for (const c of w.creatures) if (c.alive && !c.hidden && Math.hypot(c.x - f.x, c.y - 5 - f.y) < 9) { c.foam(0.35, true); dead = true; }
        if (w.bosses.active && w.bosses.hitTest(f.x, f.y)) { w.bosses.hit('foam', 0.5); dead = true; }
        for (const c of w.crew) if (c !== f.npc && c.available && !c.hidden && Math.hypot(c.x - f.x, c.y - 6 - f.y) < 7) { c.hitByFoam(byPlayer); dead = true; }
        if (dead && Math.random() < (f.npc ? 0.12 : 0.06)) w.dirt.add('espuma', f.x, f.y + 6, 0.3);
      } else if (f.kind === 'mist') {
        for (const d of w.dirt.near(f.x, f.y + 6, 10)) {
          const def = RESIDUES[d.type];
          if (!def.bio && d.type !== 'acido') continue;
          this.cleanDirt(d, 0.09 * disUp, () => {});
        }
        for (const c of w.crew) {
          if (c.disease && c.available && Math.hypot(c.x - f.x, c.y - 6 - f.y) < 10) {
            if (c.disease.t < 35 || w.spec === 'sanitario' || Math.random() < 0.04) w.disease.cure(c, 'player');
            dead = true;
          }
        }
        for (const c of w.creatures) if (c.alive && !c.hidden && Math.hypot(c.x - f.x, c.y - 5 - f.y) < 10) { c.disinfect(0.25); dead = true; }
        if (w.bosses.active && w.bosses.hitTest(f.x, f.y)) { w.bosses.hit('disinfect', 1.1 * disUp); dead = true; }
      } else {
        for (const d of w.dirt.near(f.x, f.y + 6, 9)) {
          const def = RESIDUES[d.type];
          if (def.liquid && d.type !== 'acido' && d.type !== 'eterna') {
            const amt = d.amount;
            w.dirt.remove(d, 'other');
            w.dirt.add('hielo', d.x, d.y, Math.min(1.2, amt), { merge: false });
            dead = true;
            break;
          }
        }
        const fire = w.emerg.fireAtPx(f.x, f.y + 6);
        if (fire) { w.emerg.extinguish(fire, 0.12, true); dead = true; }
        for (const fx of w.map.fixtures) {
          if (fx.kind !== 'pipe' || !fx.leaking) continue;
          if (Math.hypot(fx.tx * 16 + 8 - f.x, fx.ty * 16 + 14 - f.y) < 14) { w.emerg.freezePipe(fx); dead = true; }
        }
        for (const c of w.creatures) if (c.alive && !c.hidden && Math.hypot(c.x - f.x, c.y - 5 - f.y) < 9) { c.freeze(0.4, true); dead = true; }
        for (const c of w.crew) if (c.available && Math.hypot(c.x - f.x, c.y - 6 - f.y) < 7) { c.freeze(2); dead = true; }
        if (w.bosses.active && w.bosses.hitTest(f.x, f.y)) { w.bosses.hit('cryo', 1); dead = true; }
      }
      if (dead) { f.sprite.destroy(); this.parts.splice(i, 1); }
    }
  }

  destroyAll() {
    for (const p of this.wet) p.sprite.destroy();
    for (const f of this.parts) f.sprite.destroy();
    this.wet = [];
    this.parts = [];
    this.stopLoops();
  }
}
