import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE } from '../config';
import { EMOTES, charFrame, HD } from '../gfx/sprites';
import type { EmoteId, Facing } from '../types';
import type { GameScene } from '../scenes/GameScene';

let NEXT_ID = 1;

/** Base común: posición en los pies, colisión con la rejilla, resbalones, flotación y emoticonos. */
export class Actor {
  readonly uid = NEXT_ID++;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: Facing = 'down';
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  emote: Phaser.GameObjects.Image;
  emoteT = 0;
  hw = 4;
  fallT = 0;
  stunT = 0;
  animT = 0;
  moving = false;
  acting = false;
  armsUp = false;
  ko = false;
  floatPh = Math.random() * 10;
  floatOff = 0;
  hidden = false;
  /** nombre visible */
  label = '';
  tint: number | null = null;

  constructor(public w: GameScene, public texKey: string, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.shadow = w.add.ellipse(x, y, 10, 4, 0x000000, 0.35).setDepth(DEPTH.dirt + 0.9);
    this.sprite = w.add.sprite(x, y + 1, texKey, 0).setOrigin(0.5, 1).setScale(HD);
    this.emote = w.add.image(x, y - 18, 'emote', 0).setOrigin(0.5, 1).setDepth(DEPTH.overlay).setVisible(false).setScale(HD);
  }

  get isDown() { return this.fallT > 0; }

  collides(x: number, y: number): boolean {
    const m = this.w.map;
    const l = x - this.hw, r = x + this.hw, t = y - 5, b = y + 1;
    return m.isSolidPx(l, t) || m.isSolidPx(r, t) || m.isSolidPx(l, b) || m.isSolidPx(r, b);
  }

  /** Movimiento con colisión separada por ejes y subpasos de 2 px. */
  move(dx: number, dy: number): { hitX: boolean; hitY: boolean } {
    let hitX = false, hitY = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        if (!this.collides(this.x + sx, this.y)) this.x += sx;
        else hitX = true;
      }
      if (sy !== 0) {
        if (!this.collides(this.x, this.y + sy)) this.y += sy;
        else hitY = true;
      }
    }
    // si quedó atrapado (puerta bloqueada encima, etc.) se libera empujando al centro de casilla libre
    if (this.collides(this.x, this.y)) this.unstick();
    return { hitX, hitY };
  }

  unstick() {
    const m = this.w.map;
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
    let best: { x: number; y: number } | null = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!m.isWalkable(tx + dx, ty + dy)) continue;
      const c = m.tileCenter(tx + dx, ty + dy);
      const d = (c.x - this.x) ** 2 + (c.y - this.y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { this.x = best.x; this.y = best.y; }
  }

  setEmote(id: EmoteId | null, dur = 1.6) {
    if (!id) { this.emote.setVisible(false); this.emoteT = 0; return; }
    this.emote.setFrame(EMOTES.indexOf(id)).setVisible(!this.hidden);
    this.emoteT = dur;
  }

  /** Caída por resbalón: gira el sprite y desliza. */
  fall(dirX: number, dirY: number, dur = 1.3) {
    if (this.fallT > 0) return;
    this.fallT = dur;
    this.vx = dirX * 70;
    this.vy = dirY * 70;
    this.setEmote('dizzy', dur + 0.4);
  }

  /** Probabilidad de resbalar según la superficie actual. */
  slipCheck(dt: number, speed: number, clumsy: number): boolean {
    if (this.fallT > 0 || this.w.ship.zeroG) return false;
    if (speed < 22) return false;
    const s = this.w.dirt.surfaceAt(this.x, this.y);
    const wet = this.w.cleaning.wetAt(this.x, this.y);
    const slip = Math.max(s.slippery, wet * 0.55);
    if (slip < 0.08) return false;
    const p = slip * clumsy * (speed / 60) * 0.85 * dt;
    if (Math.random() < p) {
      const n = Math.hypot(this.vx, this.vy) || 1;
      this.fall(this.vx / n, this.vy / n);
      return true;
    }
    return false;
  }

  /** Actualiza fotograma, profundidad, flotación y emoticono. */
  updateSprite(dt: number) {
    this.animT += dt;
    const zeroG = this.w.ship.zeroG;
    const targetFloat = zeroG && this.fallT <= 0 ? 6 + Math.sin(this.animT * 2 + this.floatPh) * 2 : 0;
    this.floatOff += (targetFloat - this.floatOff) * Math.min(1, dt * 4);
    let mode: 'idle' | 'walk' | 'act' | 'up' | 'upwalk' | 'ko' = 'idle';
    if (this.ko) mode = 'ko';
    else if (this.armsUp) mode = this.moving ? 'upwalk' : 'up';
    else if (this.acting) mode = 'act';
    else if (this.moving) mode = 'walk';
    const blink = mode === 'idle' && Math.floor((this.animT + this.floatPh) * 10) % 41 === 0;
    const frame = charFrame(this.facing, mode, this.animT, blink);
    const bob = mode === 'walk' && Math.floor(this.animT * 8) % 2 === 0 ? -1 : 0;
    if (this.sprite.texture.key.startsWith('char_')) this.sprite.setFrame(frame);
    this.sprite.setFlipX(this.facing === 'left');
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y + 1 - this.floatOff) + bob);
    if (this.fallT > 0 || this.ko) {
      this.sprite.setAngle(this.vx < 0 ? -90 : 90);
      this.sprite.setPosition(Math.round(this.x), Math.round(this.y - 3));
    } else if (zeroG) {
      this.sprite.setAngle(Math.sin(this.animT * 1.3 + this.floatPh) * 18);
    } else {
      this.sprite.setAngle(0);
    }
    this.sprite.setDepth(sortDepth(this.y));
    this.sprite.setVisible(!this.hidden);
    this.shadow.setPosition(this.x, this.y).setVisible(!this.hidden);
    this.shadow.setScale(1 - this.floatOff / 14);
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      this.emote.setPosition(Math.round(this.x), Math.round(this.y - 17 - this.floatOff));
      if (this.emoteT <= 0) this.emote.setVisible(false);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.emote.destroy();
  }
}
