import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { norm } from '../core/util';
import { HD } from '../gfx/sprites';
import { RESIDUES, type ResidueId } from '../data/residues';
import type { Creature } from '../entities/Creature';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

type BossKind = 'reina' | 'rey' | 'glorp';

const NAMES: Record<BossKind, string> = { reina: 'La Reina del Moho', rey: 'El Rey Aspirador', glorp: 'El Glorp del Baño 7' };

/** Jefes que se derrotan limpiando y manipulando sistemas, no reduciendo una barra a golpes. */
export class BossSystem {
  active = false;
  kind: BossKind | null = null;
  room: RoomId | null = null;
  hp = 0;
  maxHp = 0;
  shield = false;
  hint = '';
  x = 0;
  y = 0;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private aura: Phaser.GameObjects.Image | null = null;
  private t = 0;
  private spawnT = 0;
  private sporeT = 0;
  private stunT = 0;
  private shorts = 0;
  private hitCd = 0;
  private phase = 1;
  glorp: Creature | null = null;
  defeated = false;
  unplugReady = false;

  constructor(private w: GameScene) {}

  get name() { return this.kind ? NAMES[this.kind] : ''; }

  spawn(kind: BossKind) {
    const w = this.w;
    if (this.active) return;
    this.kind = kind;
    this.active = true;
    this.t = 0;
    this.phase = 1;
    this.defeated = false;
    if (kind === 'reina') {
      const r = w.map.room('hidroponico');
      this.room = 'hidroponico';
      this.x = (r.x + 7) * TILE;
      this.y = (r.y + 3) * TILE;
      this.hp = this.maxHp = 100;
      this.sprite = w.add.sprite(this.x, this.y, 'reina', 0).setOrigin(0.5, 0.85).setScale(HD * 1.2).setDepth(sortDepth(this.y));
      this.aura = w.add.image(this.x, this.y - 14, 'fx_glow').setScale(1.6).setTint(0xb080ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
      for (let i = 0; i < 6; i++) this.colony();
    } else if (kind === 'rey') {
      const r = w.map.room(w.rng.pick(w.map.rooms.filter((x) => x.id !== 'pasillo')).id);
      this.room = r.id;
      const t = w.rng.pick(r.floorTiles);
      this.x = t.tx * TILE + 8;
      this.y = t.ty * TILE + 10;
      this.hp = this.maxHp = 3;
      this.sprite = w.add.sprite(this.x, this.y, 'rey', 0).setOrigin(0.5, 0.9).setScale(HD).setDepth(sortDepth(this.y));
      this.aura = w.add.image(this.x, this.y - 10, 'fx_glow').setScale(1.2).setTint(0xff2040).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setAlpha(0.4);
      for (let i = 0; i < 2; i++) this.mini();
    } else {
      const toilets = w.map.props.filter((p) => p.kind === 'toilet' && p.spots[0]);
      const t = w.rng.pick(toilets);
      const c = w.map.tileCenter(t.spots[0].tx, t.spots[0].ty);
      this.glorp = w.spawnCreature('glorp', c.x, c.y, 2.3, 'el Baño 7', true);
      this.glorp.hp = 999;
      this.room = t.room;
      this.hp = this.maxHp = 3;
    }
    w.announce('bossSpawn', { boss: this.name }, { room: this.room ?? 'pasillo' });
    audio.sfx('roar');
    w.shake(0.01, 500);
    bus.emit('boss:spawn', kind);
  }

  hitTest(x: number, y: number) {
    if (!this.active || !this.sprite) return false;
    return Math.hypot(x - this.x, y - (this.y - 12)) < 20;
  }

  /** daño de herramientas: desinfectante, fregona, espuma, disparos */
  hit(src: 'disinfect' | 'mop' | 'foam' | 'bolt' | 'cryo', amount: number) {
    const w = this.w;
    if (!this.active || this.kind === 'glorp') return;
    if (this.kind === 'reina') {
      if (this.shield) {
        if (this.hitCd <= 0) { this.hitCd = 2; w.floatText(this.x, this.y - 40, 'Escudo: limpia las colonias y purga la ventilación', 'bad'); }
        return;
      }
      const mul = src === 'disinfect' ? 1 : src === 'mop' ? 0.6 : src === 'bolt' ? 0.3 : 0.25;
      this.hp -= amount * mul;
      this.sprite?.setTintFill(0xffffff);
      w.time.delayedCall(60, () => this.sprite?.clearTint());
    } else if (this.kind === 'rey') {
      if (src === 'cryo' && this.stunT <= 0) { this.stunT = 3; w.floatText(this.x, this.y - 30, '¡Congelado!', 'good'); }
      if (src === 'mop' && this.hitCd <= 0) { this.hitCd = 2; w.floatText(this.x, this.y - 30, 'Necesita un cortocircuito: líquidos', 'info'); }
    }
    this.checkPhase();
  }

  private checkPhase() {
    const w = this.w;
    const frac = this.hp / this.maxHp;
    const ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (ph > this.phase) { this.phase = ph; w.announce('bossPhase', { boss: this.name }); audio.sfx('roar'); }
    if (this.hp <= 0) this.defeat();
  }

  /** intento de captura del Glorp gigante (congelado + aspiradora) */
  glorpCaptureAttempt(c: Creature) {
    const w = this.w;
    if (!this.active || c !== this.glorp) return false;
    this.hp--;
    w.shake(0.006, 200);
    audio.sfx('capture');
    w.dirt.add('baba', c.x, c.y, 1.2);
    if (this.hp <= 0) { this.defeat(); return true; }
    c.size *= 0.85;
    c.freezeT = 0; c.foamT = 0; c.stunT = 0;
    const open = w.map.props.filter((p) => p.kind === 'toilet' && !(p.state.sealedT > w.t) && p.spots[0]);
    if (!open.length) { this.hp = 0; this.defeat(); return true; }
    const t = w.rng.pick(open);
    const pos = w.map.tileCenter(t.spots[0].tx, t.spots[0].ty);
    c.x = pos.x; c.y = pos.y;
    audio.sfx('flush');
    w.announce('bossPhase', { boss: this.name });
    w.floatText(c.x, c.y - 26, '¡Se escapa por el inodoro! Séllalos con espuma', 'bad');
    return false;
  }

  private defeat() {
    const w = this.w;
    if (this.defeated) return;
    this.defeated = true;
    this.active = false;
    const mess: ResidueId[] = this.kind === 'reina' ? ['moho', 'esporas', 'tierra', 'restos'] : this.kind === 'rey' ? ['escombros', 'polvo', 'basura', 'aceite'] : ['baba', 'baba', 'restos'];
    for (let i = 0; i < 12; i++) w.dirt.add(w.rng.pick(mess), this.x + w.rng.range(-30, 30), this.y + w.rng.range(-16, 20), w.rng.range(0.5, 1));
    w.fx.explosion(this.x, this.y - 10);
    audio.sfx('explosion');
    w.shake(0.015, 600);
    if (this.kind === 'glorp' && this.glorp) { this.glorp.capture(this.glorp.x, this.glorp.y - 10); }
    if (this.sprite) this.w.tweens.add({ targets: this.sprite, alpha: 0, scale: 0.1, duration: 900, onComplete: () => { this.sprite?.destroy(); this.sprite = null; } });
    this.aura?.destroy();
    this.aura = null;
    w.stats.bossesDefeated++;
    w.stats.emergenciesResolved++;
    w.announce('bossDefeated', { boss: this.name });
    bus.emit('boss:defeated', this.kind);
  }

  private colony() {
    const w = this.w;
    const r = w.map.room('hidroponico');
    const t = w.rng.pick(r.floorTiles);
    w.dirt.add('moho', t.tx * TILE + 8, t.ty * TILE + 10, w.rng.range(0.7, 1));
  }

  private mini() {
    const w = this.w;
    if (w.creatures.filter((c) => c.alive && c.species === 'rogue').length >= 3) return;
    w.spawnCreature('rogue', this.x + w.rng.range(-20, 20), this.y + 8, 1, 'el Rey Aspirador', true);
  }

  canUnplug() { return this.active && this.kind === 'rey' && this.unplugReady; }

  unplug() {
    if (!this.canUnplug()) return;
    this.hp = 0;
    this.w.floatText(this.x, this.y - 30, '¡Desenchufado!', 'good');
    this.defeat();
  }

  update(dt: number) {
    const w = this.w;
    if (!this.active) return;
    this.t += dt;
    this.hitCd -= dt;
    if (this.kind === 'glorp') {
      const g = this.glorp;
      if (!g || !g.alive) { if (!this.defeated) this.defeat(); return; }
      this.x = g.x; this.y = g.y;
      this.room = w.map.roomAtPx(g.x, g.y);
      this.hint = 'Sella inodoros con espuma, congélalo y aspíralo';
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 22;
        if (w.creatures.filter((c) => c.alive && c.species === 'glorp').length < 4) w.spawnCreature('glorp', g.x + 10, g.y, 0.7, 'el Glorp gigante', true);
        const toilets = w.map.props.filter((p) => p.kind === 'toilet' && !p.state.clog);
        if (toilets.length && w.rng.chance(0.5)) w.emerg.clogToilet(w.rng.pick(toilets));
      }
      return;
    }
    const s = this.sprite!;
    if (this.kind === 'reina') {
      const molds = w.dirt.list.filter((d) => d.room === 'hidroponico' && d.type === 'moho').length;
      const purged = (w.purgedAt.get('hidroponico') ?? -99) > w.t - 35;
      this.shield = molds >= 4 || !purged;
      this.hint = this.shield ? `Escudo activo · colonias: ${molds} (máx. 3) · ${purged ? 'ventilación purgada' : 'purga la ventilación desde el puente'}` : '¡Vulnerable! Rocía desinfectante en su núcleo';
      s.setFrame(Math.floor(this.t * 3) % 3);
      this.aura?.setAlpha(this.shield ? 0.45 + Math.sin(this.t * 4) * 0.15 : 0.15);
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = this.phase === 3 ? 4 : this.phase === 2 ? 5.5 : 7; if (molds < 12) this.colony(); }
      this.sporeT -= dt;
      if (this.sporeT <= 0) {
        this.sporeT = 14;
        const v = w.map.props.filter((p) => p.kind === 'vent' && p.room !== 'hidroponico');
        if (v.length) { const t = w.rng.pick(v); w.dirt.add('esporas', t.tx * TILE + 8, t.ty * TILE + 10, 0.7); }
      }
      for (const p of w.players) if (!p.dead && Math.hypot(p.x - this.x, p.y - this.y) < 20) p.hurt(4 * dt, 'la Reina del Moho');
      for (const c of w.crew) if (c.available && c.organic && !c.disease && Math.hypot(c.x - this.x, c.y - this.y) < 40 && w.rng.chance(dt * 0.3)) w.disease.infect(c, 'babosa');
      return;
    }
    // Rey Aspirador
    this.stunT -= dt;
    this.unplugReady = this.shorts >= 3;
    this.hint = this.unplugReady ? '¡Fuera de combate! Acércate y mantén [E] para desenchufarlo' : `Fusibles: ${3 - this.shorts} · haz que aspire líquidos (agua, café, aguas residuales)`;
    if (this.stunT > 0 || this.unplugReady) {
      s.setFrame(2);
      if (Math.random() < dt * 6) w.fx.sparks(this.x + (Math.random() - 0.5) * 20, this.y - 14, 3);
      return;
    }
    s.setFrame(Math.floor(this.t * 6) % 2);
    // va a por la suciedad más grande
    let best: { x: number; y: number } | null = null, bs = 0;
    for (const d of w.dirt.near(this.x, this.y, 220)) {
      const v = RESIDUES[d.type].weight * d.amount / (1 + Math.hypot(d.x - this.x, d.y - this.y) / 80);
      if (v > bs) { bs = v; best = d; }
    }
    const np = w.nearestPlayer(this.x, this.y);
    const tgt = best ?? (np.p && np.d < 200 ? np.p : null);
    if (tgt) {
      const n = norm(tgt.x - this.x, tgt.y - this.y);
      const sp = 22 + this.phase * 4;
      const nx = this.x + n.x * sp * dt, ny = this.y + n.y * sp * dt;
      if (!w.map.isSolidPx(nx, this.y)) this.x = nx;
      if (!w.map.isSolidPx(this.x, ny)) this.y = ny;
      s.setFlipX(n.x < 0);
    }
    s.setPosition(this.x, this.y).setDepth(sortDepth(this.y));
    this.aura?.setPosition(this.x, this.y - 10);
    this.room = w.map.roomAtPx(this.x, this.y);
    // aspira todo lo que encuentra
    for (const d of w.dirt.near(this.x, this.y, 22)) {
      const def = RESIDUES[d.type];
      w.dirt.remove(d, 'other');
      if (def.conductive && def.liquid) {
        this.shorts++;
        this.stunT = 6;
        w.fx.zap(this.x, this.y - 18);
        w.fx.sparks(this.x, this.y - 14, 14);
        audio.sfx('zap');
        w.shake(0.008, 250);
        w.announce('bossPhase', { boss: this.name });
        this.phase = Math.min(3, this.shorts + 1);
        break;
      }
    }
    for (const p of w.players) {
      if (p.dead) continue;
      const dp = Math.hypot(p.x - this.x, p.y - this.y);
      if (dp < 70 && p.active) { const n = norm(this.x - p.x, this.y - p.y); p.vx += n.x * 40 * dt * (1 - dp / 70) * 30; p.vy += n.y * 40 * dt * (1 - dp / 70) * 30; }
      if (dp < 16) p.hurt(5 * dt, 'el Rey Aspirador');
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 20; this.mini(); }
  }

  destroyAll() {
    this.sprite?.destroy();
    this.aura?.destroy();
    this.sprite = null;
    this.aura = null;
    this.active = false;
  }
}
