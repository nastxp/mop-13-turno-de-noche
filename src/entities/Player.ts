import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE } from '../config';
import { Actor } from './Actor';
import { audio } from '../systems/AudioManager';
import { bus } from '../core/EventBus';
import { clamp, facingFromVec, facingVec, norm } from '../core/util';
import { HD } from '../gfx/sprites';
import { PLAYER_LINES } from '../data/lines';
import { TOOLS, TOOL_ORDER } from '../data/tools';
import type { ToolId } from '../types';
import type { GameScene } from '../scenes/GameScene';
import { IsoView } from '../systems/IsoView';
import type { Corpse } from '../systems/CombatSystem';
import type { SpecId, UpgradeId } from '../data/upgrades';

export interface ToolState { charge: number; cap: number; dur: number; broken: boolean }

export const FACINGS = ['down', 'up', 'left', 'right'] as const;

/** Estado compacto de un conserje que viaja por la red (entrada del invitado o réplica en el invitado). */
export interface NetPlayerState {
  x: number; y: number; vx: number; vy: number;
  /** índice en FACINGS */
  f: number;
  ax: number; ay: number;
  /** usando la herramienta */
  u: 0 | 1;
  tool: ToolId;
  /** mantiene [E] */
  e?: 0 | 1;
  m: 0 | 1;
  /** en el suelo (resbalón) */
  dn: 0 | 1;
  car?: 'bag' | 'body' | null;
  dead?: 0 | 1;
  /** fotograma del emoticono visible (-1 = ninguno) */
  em?: number;
}

export interface PlayerOpts {
  texKey?: string;
  pid?: number;
  name?: string;
  /** local = controlado aquí · remote = invitado simulado por el anfitrión · replica = otro conserje visto por un invitado */
  kind?: 'local' | 'remote' | 'replica';
  /** mejoras, especialización y herramientas propias del invitado */
  upg?: Partial<Record<UpgradeId, number>>;
  spec?: SpecId | null;
  available?: ToolId[];
}

/** MOP-13: el conserje controlado por el jugador. */
export class Player extends Actor {
  netPid = 0;
  name = 'MOP-13';
  kind: 'local' | 'remote' | 'replica' = 'local';
  /** última entrada recibida (remote) o último estado recibido (replica) */
  net: NetPlayerState | null = null;
  /** teletransporte pendiente para la pantalla del invitado (reaparición) */
  netTp: { seq: number; x: number; y: number } | null = null;
  /** momento (performance.now) de la última entrada recibida de este invitado */
  netAt = 0;
  hp = 100;
  maxHp = 100;
  stamina = 100;
  o2 = 100;
  tool: ToolId = 'fregona';
  tools: Record<ToolId, ToolState>;
  available: ToolId[] = ['fregona'];
  carrying: 'bag' | 'body' | null = null;
  body: Corpse | null = null;
  bagSprite: Phaser.GameObjects.Image;
  toolSprite: Phaser.GameObjects.Sprite;
  reticle: Phaser.GameObjects.Image;
  aim = { x: 0, y: 1 };
  using = false;
  invertT = 0;
  safeT = 10;
  hurtFlash = 0;
  shockCd = 0;
  iframeT = 0;
  stepT = 0;
  trackT = 0;
  trackDist = 0;
  sayCd = 0;
  emoteCd = 0;
  dead = false;
  active = true;
  hasSuper = false;
  speedMul = 1;
  slipMul = 1;
  o2Mul = 1;
  staminaMul = 1;
  zeroGControl = 0.5;
  damageMul = 1;
  private wasUsing = false;

  constructor(w: GameScene, x: number, y: number, opts: PlayerOpts = {}) {
    super(w, opts.texKey ?? 'char_player', x, y);
    this.kind = opts.kind ?? 'local';
    this.netPid = opts.pid ?? 0;
    if (opts.name) this.name = opts.name;
    this.label = this.name;
    const u = opts.upg ?? w.upg;
    const spec = opts.spec !== undefined ? opts.spec : w.spec;
    const cap = (k: ToolId, base: number) => ({ charge: k === 'fregona' || k === 'aspiradora' ? 0 : base, cap: base, dur: 100, broken: false });
    this.tools = {
      fregona: cap('fregona', 100 * (1 + 0.4 * (u.fregona_absorbente ?? 0))),
      espuma: cap('espuma', 100 * (1 + 0.5 * (u.espuma_xl ?? 0)) * (spec === 'emergencias' ? 1.5 : 1)),
      aspiradora: cap('aspiradora', 100 * (u.aspiradora_blindada ? 1.5 : 1)),
      desinfectante: cap('desinfectante', 100 * (1 + 0.5 * (u.desinfectante_plus ?? 0)) * (spec === 'sanitario' ? 2 : 1)),
      crio: cap('crio', 100),
      trampa: cap('trampa', 3 + 2 * (u.trampas_extra ?? 0) + (spec === 'plagas' ? 3 : 0)),
      robot: cap('robot', 1),
      superfregona: cap('superfregona', 100),
    };
    this.speedMul = (1 + 0.12 * (u.patines ?? 0)) * (spec === 'antigravedad' ? 1.1 : 1);
    this.staminaMul = 1 - 0.25 * (u.patines ?? 0);
    this.slipMul = u.botas_adherencia ? 0.4 : 1;
    if (spec === 'antigravedad') this.slipMul *= 0.2;
    this.zeroGControl = spec === 'antigravedad' ? 1.4 : u.botas_adherencia ? 0.9 : 0.5;
    this.o2Mul = u.pulmones ? 0.6 : 1;
    this.maxHp = u.pulmones ? 120 : 100;
    this.damageMul = (u.traje_ignifugo ? 0.4 : 1) * (spec === 'emergencias' ? 0.5 : 1);
    this.hp = this.maxHp;
    this.toolSprite = w.add.sprite(x, y, 'tool_fregona', 0).setScale(HD);
    this.bagSprite = w.add.image(x, y, 'fx_bag').setVisible(false).setScale(HD);
    this.reticle = w.add.image(x, y, 'fx_reticle').setDepth(DEPTH.reticle).setAlpha(0.7).setScale(HD);
    this.available = this.kind === 'replica' ? [...TOOL_ORDER] : opts.available?.length ? [...opts.available] : w.availableTools();
    if (this.kind !== 'local') this.reticle.setVisible(false);
    this.setTool(this.available[0], true);
  }

  get isLocal() { return this.kind === 'local'; }

  get toolState(): ToolState { return this.tools[this.tool]; }

  unlockTool(id: ToolId) {
    if (!this.available.includes(id)) this.available.push(id);
    this.available.sort((a, b) => TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b));
    this.tools[id].charge = this.tools[id].cap;
    this.tools[id].broken = false;
    this.setTool(id);
  }

  setTool(id: ToolId, silent = false) {
    if (!this.available.includes(id)) {
      if (!silent) { this.w.floatText(this.x, this.y - 22, 'Herramienta no disponible', 'bad'); audio.sfx('error'); }
      return;
    }
    this.tool = id;
    const key = id === 'trampa' ? 'tool_trampa' : id === 'robot' ? 'tool_robot' : `tool_${id}`;
    this.toolSprite.setTexture(key, 0);
    if (id === 'fregona' || id === 'superfregona') this.toolSprite.setOrigin(0.5, 0.12);
    else this.toolSprite.setOrigin(0.2, 0.5);
    if (!silent && this.isLocal) { audio.sfx('pickup'); this.w.floatText(this.x, this.y - 22, TOOLS[id].name, 'tool'); }
    if (this.isLocal) this.w.cleaning.stopLoops();
  }

  cycleTool(dir = 1) {
    const i = this.available.indexOf(this.tool);
    this.setTool(this.available[(i + dir + this.available.length) % this.available.length]);
  }

  hand() {
    const ax = this.facing === 'left' ? -4 : this.facing === 'right' ? 4 : this.facing === 'down' ? 3 : -3;
    return { x: this.x + ax, y: this.y - 6 - this.floatOff };
  }

  mopHead() { return { x: this.x + this.aim.x * 12, y: this.y - 1 + this.aim.y * 11 }; }

  say(text: string, force = false) {
    if (!force && this.sayCd > 0) return;
    this.sayCd = 4;
    this.w.say(this, text);
  }

  sayKey(key: keyof typeof PLAYER_LINES | string, force = false) {
    const arr = PLAYER_LINES[key];
    if (arr) this.say(arr[Math.floor(Math.random() * arr.length)], force);
  }

  hurt(amount: number, cause: string) {
    if (this.dead || amount <= 0) return;
    // en el invitado la salud la dicta el anfitrión (llega en el mensaje 'me')
    if (this.w.netRole === 'client') return;
    // breve invulnerabilidad tras un golpe fuerte (evita muertes instantáneas por acumulación)
    if (amount >= 3) { if (this.iframeT > 0) return; this.iframeT = 0.45; }
    if (cause === 'fuego' || cause.includes('ácid')) amount *= this.damageMul;
    this.hp -= amount;
    this.safeT = 0;
    this.hurtFlash = 0.15;
    if (amount >= 4) bus.emit('player:hurt', amount, cause);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.fallT = 99;
      this.sprite.setAngle(90);
      audio.sfx('hurt');
      this.w.onPlayerDeath(cause, this);
    }
  }

  /** Vuelve al servicio (multijugador: Recursos Humanos envía un MOP de repuesto). */
  respawn(x: number, y: number) {
    this.dead = false;
    this.fallT = 0;
    this.ko = false;
    this.hp = this.maxHp;
    this.o2 = 100;
    this.stamina = 100;
    this.stunT = 0;
    this.vx = 0; this.vy = 0;
    this.x = x; this.y = y;
    this.carrying = null;
    this.body = null;
    this.sprite.setAngle(0);
    this.safeT = 10;
  }

  /**
   * ANFITRIÓN · conserje de un invitado: la posición la decide su pantalla;
   * aquí se aplican la herramienta (lógica real), los peligros del suelo, el oxígeno y las huellas.
   */
  remoteTick(dt: number) {
    const w = this.w;
    const s = this.net;
    // si su pantalla deja de enviar (pestaña oculta, conexión lenta), el conserje se queda quieto y sin usar nada
    if (s && performance.now() - this.netAt > 1500) { s.u = 0; s.e = 0; s.m = 0; }
    this.sayCd -= dt; this.emoteCd -= dt; this.shockCd -= dt; this.iframeT -= dt; this.invertT -= dt;
    if (this.dead) { this.updateSprite(dt); this.updateTool(); this.reticle.setVisible(false); return; }
    if (s) {
      this.x = s.x; this.y = s.y; this.vx = s.vx; this.vy = s.vy;
      this.facing = FACINGS[s.f] ?? 'down';
      const al = Math.hypot(s.ax, s.ay);
      if (al > 0.1) this.aim = { x: s.ax / al, y: s.ay / al };
      this.moving = !!s.m;
      this.fallT = s.dn ? Math.max(this.fallT, 0.15) : 0;
      if (s.tool !== this.tool && this.available.includes(s.tool)) this.setTool(s.tool, true);
    }
    if (this.stunT > 0) this.stunT -= dt;
    const placeTool = this.tool === 'trampa' || this.tool === 'robot';
    this.using = !!s?.u && !this.carrying && this.stunT <= 0 && !this.isDown && !placeTool && !this.toolState.broken;
    this.acting = this.using;
    if (!(this.using && (this.tool === 'fregona' || this.tool === 'superfregona'))) this.tools.fregona.charge = Math.max(0, this.tools.fregona.charge - 5 * dt);
    if (this.using) w.cleaning.use(this, dt);
    this.afterMove(dt, w.dirt.surfaceAt(this.x, this.y));
    this.reticle.setVisible(false);
  }

  /** INVITADO · otro conserje (anfitrión u otro invitado): se interpola y se dibuja, incluida su herramienta. */
  replicaTick(dt: number) {
    const s = this.net;
    if (!s) return;
    const d = Math.hypot(s.x - this.x, s.y - this.y);
    if (d > 40) { this.x = s.x; this.y = s.y; }
    else { const k = Math.min(1, dt * 14); this.x += (s.x - this.x) * k; this.y += (s.y - this.y) * k; }
    this.vx = s.vx; this.vy = s.vy;
    this.facing = FACINGS[s.f] ?? 'down';
    this.aim = { x: s.ax, y: s.ay };
    this.moving = !!s.m;
    this.dead = !!s.dead;
    this.fallT = s.dead ? 99 : s.dn ? 0.5 : 0;
    this.carrying = s.car ?? null;
    if (s.tool !== this.tool) this.setTool(s.tool, true);
    this.using = !!s.u && !this.dead;
    this.acting = this.using;
    this.updateSprite(dt);
    if (s.em !== undefined && s.em >= 0) this.emote.setFrame(s.em).setVisible(!this.hidden).setPosition(Math.round(this.x), Math.round(this.y - 17 - this.floatOff));
    else this.emote.setVisible(false);
    this.updateTool();
    this.reticle.setVisible(false);
    if (this.using) this.w.cleaning.use(this, dt);
  }

  /** estado compacto para la red */
  netState(): NetPlayerState {
    const em = this.emote.visible ? Number(this.emote.frame.name) : -1;
    return {
      x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10, vx: Math.round(this.vx), vy: Math.round(this.vy),
      f: FACINGS.indexOf(this.facing), ax: Math.round(this.aim.x * 100) / 100, ay: Math.round(this.aim.y * 100) / 100,
      u: this.using ? 1 : 0, tool: this.tool, m: this.moving ? 1 : 0, dn: this.isDown && !this.dead ? 1 : 0,
      car: this.carrying, dead: this.dead ? 1 : 0, em: Number.isFinite(em) ? em : -1,
    };
  }

  /** acción puntual (colocar trampa, desplegar dron) al empezar a usar la herramienta */
  private useOnce() {
    const w = this.w;
    const ts = this.toolState;
    const at = this.tool === 'trampa' || this.tool === 'robot' ? { x: this.x + this.aim.x * 14, y: this.y + this.aim.y * 12 } : null;
    if (!at) return;
    if (ts.charge < 1) { this.say(this.tool === 'trampa' ? 'No me quedan trampas.' : 'El dron ya está desplegado.'); audio.sfx('error'); return; }
    if (w.map.isSolidPx(at.x, at.y)) { audio.sfx('error'); return; }
    ts.charge -= 1;
    if (this.tool === 'trampa') w.placeTrap(at.x, at.y);
    else w.deployBot(at.x, at.y);
  }

  update(dt: number) {
    if (!this.active) {
      this.toolSprite.setVisible(false);
      this.reticle.setVisible(false);
      this.hidden = true;
      this.updateSprite(dt);
      return;
    }
    if (this.dead) { this.updateSprite(dt); return; }
    const w = this.w;
    const k = w.keys;
    this.sayCd -= dt;
    this.emoteCd -= dt;
    this.shockCd -= dt;
    this.iframeT -= dt;
    this.invertT -= dt;

    let ix = 0, iy = 0;
    if (k.A.isDown || k.LEFT.isDown) ix -= 1;
    if (k.D.isDown || k.RIGHT.isDown) ix += 1;
    if (k.W.isDown || k.UP.isDown) iy -= 1;
    if (k.S.isDown || k.DOWN.isDown) iy += 1;
    if (w.touch.active) { ix += w.touch.dx; iy += w.touch.dy; }
    if (w.iso) { const r = IsoView.remap(ix, iy); ix = r.x; iy = r.y; }
    if (w.inputBlocked) { ix = 0; iy = 0; }
    if (this.invertT > 0) { ix = -ix; iy = -iy; }
    const inp = norm(ix, iy);

    const hx = this.x, hy = this.y - 6;
    if (w.touch.active && w.touch.aimActive) this.aim = { x: w.touch.ax, y: w.touch.ay };
    else if (w.mouseActive()) {
      const a = norm(w.aimWorld.x - hx, w.aimWorld.y - hy);
      if (a.len > 2) this.aim = { x: a.x, y: a.y };
    } else if (inp.len > 0) this.aim = { x: inp.x, y: inp.y };

    const surf = w.dirt.surfaceAt(this.x, this.y);
    const zeroG = w.ship.zeroG;

    if (this.fallT > 0) {
      this.fallT -= dt;
      const damp = Math.max(0, 1 - dt * 3);
      this.vx *= damp; this.vy *= damp;
      this.move(this.vx * dt, this.vy * dt);
      if (this.fallT <= 0) { this.vx = 0; this.vy = 0; }
      this.using = false;
      w.cleaning.stopLoops();
      this.afterMove(dt, surf);
      return;
    }

    const wantsRun = (k.SHIFT.isDown || w.touch.run) && inp.len > 0 && this.stamina > 3;
    if (wantsRun) this.stamina = Math.max(0, this.stamina - 20 * this.staminaMul * dt);
    else this.stamina = Math.min(100, this.stamina + (inp.len > 0 ? 9 : 16) * dt);

    const wantsUse = (w.mouseDown || w.spaceUse || w.touch.use) && !this.carrying && this.stunT <= 0 && !w.inputBlocked;
    const placeTool = this.tool === 'trampa' || this.tool === 'robot';
    if (wantsUse && !this.wasUsing && placeTool) this.useOnce();
    this.wasUsing = wantsUse;
    this.using = wantsUse && !placeTool && !this.toolState.broken;
    if (wantsUse && this.toolState.broken && !placeTool && this.sayCd <= 0) this.say('La herramienta está rota o vacía. Toca ir a la Estación.');

    let speed = 62 * this.speedMul * (wantsRun ? 1.55 : 1) * (1 - surf.slow) * (this.carrying === 'bag' ? 0.78 : this.carrying === 'body' ? 0.62 : 1);
    if (this.using) speed *= this.tool === 'fregona' || this.tool === 'superfregona' ? 0.85 : 0.75;
    if (this.stunT > 0) { this.stunT -= dt; speed = 0; }

    const tx = inp.x * speed, ty = inp.y * speed;
    if (zeroG) {
      const thrust = 55 * this.zeroGControl;
      this.vx += inp.x * thrust * dt;
      this.vy += inp.y * thrust * dt;
      const damp = Math.max(0, 1 - dt * (0.25 + this.zeroGControl * 0.6));
      this.vx *= damp; this.vy *= damp;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 80) { this.vx *= 80 / sp; this.vy *= 80 / sp; }
    } else {
      const wet = w.cleaning.wetAt(this.x, this.y);
      const slip = Math.max(surf.slippery, wet * 0.5) * (this.slipMul < 1 ? 0.5 : 1);
      const traction = slip > 0.1 ? 12 - 9.5 * slip : 12;
      const f = Math.min(1, traction * dt);
      this.vx += (tx - this.vx) * f;
      this.vy += (ty - this.vy) * f;
    }

    const pull = w.emerg.pullAt(this.x, this.y, this);
    const r = this.move((this.vx + pull.x) * dt, (this.vy + pull.y) * dt);
    if (zeroG) { if (r.hitX) this.vx *= -0.4; if (r.hitY) this.vy *= -0.4; }

    const sp = Math.hypot(this.vx, this.vy);
    this.moving = sp > 8 && inp.len > 0;
    if (this.using) this.facing = facingFromVec(this.aim.x, this.aim.y, this.facing);
    else if (inp.len > 0) this.facing = facingFromVec(inp.x, inp.y, this.facing);
    this.acting = this.using;

    if (this.slipCheck(dt, sp, 0.42 * (wantsRun ? 1.8 : 1) * this.slipMul)) this.onSlip();

    if (this.moving && !zeroG) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = wantsRun ? 0.22 : 0.32;
        audio.sfx(surf.slippery > 0.3 || surf.slow > 0.2 ? 'squelch' : 'step');
        if (wantsRun) w.fx.dust(this.x, this.y);
      }
    }

    if (!(this.using && (this.tool === 'fregona' || this.tool === 'superfregona'))) this.tools.fregona.charge = Math.max(0, this.tools.fregona.charge - 5 * dt);
    if (this.using) w.cleaning.use(this, dt);
    else w.cleaning.stopLoops();

    this.afterMove(dt, surf);
  }

  private onSlip() {
    const w = this.w;
    audio.sfx('slip');
    this.sayKey('slip');
    // invitado: las consecuencias (bolsa reventada, cuerpo al suelo, panel roto) las aplica el anfitrión
    if (w.netRole === 'client') { w.netAction({ a: 'slip' }); return; }
    this.slipConsequences();
  }

  /** efectos de un resbalón sobre el mundo (también los aplica el anfitrión cuando resbala un invitado) */
  slipConsequences() {
    const w = this.w;
    w.stats.playerSlips++;
    bus.emit('player:slip');
    if (this.carrying === 'bag') {
      this.carrying = null;
      for (let i = 0; i < 4; i++) w.dirt.add('basura', this.x + (Math.random() - 0.5) * 24, this.y + (Math.random() - 0.5) * 18, 0.7);
      w.playerCaused('Bolsa de basura reventada en un resbalón');
    } else if (this.carrying === 'body' && this.body) {
      w.combat.dropAt(this.body, this.x + this.vx * 0.2, this.y + 4);
      this.carrying = null;
      this.body = null;
      this.say('Perdón, perdón, perdón…', true);
    }
    for (const f of w.map.fixtures) {
      if (f.kind !== 'panel' || f.broken) continue;
      const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
      if (Math.hypot(c.x - this.x, c.y - this.y) < 18 && Math.random() < 0.3) { w.emerg.breakPanel(f, 'el conserje se cayó encima', true); break; }
    }
  }

  private afterMove(dt: number, surf: ReturnType<GameScene['dirt']['surfaceAt']>) {
    const w = this.w;
    if (surf.tracks) this.trackT = 3;
    if (this.trackT > 0 && this.moving) {
      this.trackT -= dt;
      this.trackDist += Math.hypot(this.vx, this.vy) * dt;
      if (this.trackDist > 14 && !surf.tracks) { this.trackDist = 0; w.dirt.add('huellas', this.x, this.y, 0.22, { merge: true }); }
    }
    if (w.ship.oxygen < 25) this.o2 = Math.max(0, this.o2 - ((25 - w.ship.oxygen) / 25) * 7 * this.o2Mul * dt);
    else this.o2 = Math.min(100, this.o2 + 12 * dt);
    if (this.o2 <= 0) this.hurt(5 * dt, 'asfixia');
    const fire = w.emerg.fireAtPx(this.x, this.y);
    if (fire) this.hurt(13 * fire.i * dt, 'fuego');
    if (surf.corrosive && Math.random() < dt * 2) this.hurt(2, 'ácido');
    if (surf.electrified && this.shockCd <= 0) {
      this.shockCd = 2;
      this.stunT = 0.8;
      this.hurt(7, 'descarga eléctrica');
      w.fx.zap(this.x, this.y - 8);
      audio.sfx('zap');
      this.sayKey('shock', true);
      this.setEmote('alert', 1);
    }
    this.safeT += dt;
    if (this.safeT > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 1.5 * dt);
    if (this.emoteCd <= 0) {
      if (this.stamina < 12) { this.setEmote('sweat', 1.5); this.emoteCd = 4; }
      else if (surf.disgust > 0.6) { this.setEmote('disgust', 1.5); this.emoteCd = 5; if (Math.random() < 0.3) this.sayKey('disgust'); }
      else if (w.creatures.some((c) => c.alive && c.aggressive && Math.hypot(c.x - this.x, c.y - this.y) < 60)) { this.setEmote('fear', 1.2); this.emoteCd = 4; }
    }
    this.updateSprite(dt);
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; this.sprite.setTint(0xff7070); } else this.sprite.clearTint();
    this.updateTool();
  }

  private updateTool() {
    const ts = this.toolSprite;
    const h = this.hand();
    const behind = this.facing === 'up';
    const placeTool = this.tool === 'trampa' || this.tool === 'robot';
    ts.setVisible(!this.carrying && !this.isDown && !this.dead);
    if (this.tool === 'fregona' || this.tool === 'superfregona') {
      ts.setFrame(this.tool === 'fregona' && this.toolState.charge / this.toolState.cap > 0.7 ? 1 : 0);
      if (this.using) {
        const head = this.mopHead();
        const ang = Math.atan2(head.y - h.y, head.x - h.x) - Math.PI / 2;
        ts.setPosition(h.x, h.y).setRotation(ang + Math.sin(this.animT * 18) * 0.28).setFlipY(false);
      } else {
        const side = this.facing === 'left' ? -1 : 1;
        ts.setPosition(this.x + side * 6, this.y - 13 - this.floatOff).setRotation(side * 0.18).setFlipY(false);
      }
    } else {
      const ang = Math.atan2(this.aim.y, this.aim.x);
      ts.setPosition(h.x, h.y + 1).setRotation(placeTool ? 0 : ang).setFlipY(!placeTool && this.aim.x < 0);
    }
    ts.setDepth(sortDepth(this.y) + (behind ? -0.001 : 0.001));
    const carry = this.carrying;
    if (carry) {
      const key = carry === 'body' ? 'fx_bodybag' : 'fx_bag';
      if (this.bagSprite.texture.key !== key) this.bagSprite.setTexture(key);
    }
    this.bagSprite.setVisible(!!carry && !this.isDown);
    this.bagSprite.setPosition(this.x, this.y - (carry === 'body' ? 19 : 20) - this.floatOff).setDepth(sortDepth(this.y) + 0.002);
    this.armsUp = !!carry;
    const showRet = !carry && !this.isDown;
    this.reticle.setVisible(showRet);
    if (this.tool === 'fregona' || this.tool === 'superfregona') {
      const mh = this.mopHead();
      this.reticle.setPosition(Math.round(mh.x), Math.round(mh.y)).setScale(this.tool === 'superfregona' ? HD * 2 : HD);
    } else {
      const range = placeTool ? 14 : this.tool === 'aspiradora' ? 26 : this.tool === 'desinfectante' ? 30 : 40;
      this.reticle.setPosition(Math.round(this.x + this.aim.x * range), Math.round(this.y - (placeTool ? 0 : 6) + this.aim.y * range)).setScale(HD);
    }
    this.reticle.setAlpha(this.using ? 0.95 : 0.45);
  }

  tile() { return { tx: Math.floor(this.x / TILE), ty: Math.floor(this.y / TILE) }; }
  facingVec() { return facingVec(this.facing); }
  clampStats() { this.hp = clamp(this.hp, 0, this.maxHp); this.stamina = clamp(this.stamina, 0, 100); }

  destroy() {
    super.destroy();
    this.toolSprite.destroy();
    this.bagSprite.destroy();
    this.reticle.destroy();
  }
}

export { TOOL_ORDER };
