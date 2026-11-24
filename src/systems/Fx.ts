import Phaser from 'phaser';
import { DEPTH, TILE } from '../config';
import { HD } from '../gfx/sprites';
import type { Room } from '../world/ShipMap';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;
type Cfg = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

/** Partículas: chispas, humo, espuma, salpicaduras, confeti, gas, fogonazos… (texturas HD a escala 0,5) */
export class Fx {
  private e: Record<string, Emitter> = {};
  reduced = false;

  constructor(private scene: Phaser.Scene) {
    const mk = (name: string, tex: string, cfg: Cfg, depth: number = DEPTH.fx) => {
      this.e[name] = scene.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);
    };
    const s = (a: number, b: number) => ({ start: a * HD, end: b * HD });
    mk('sparkle', 'fx_star', { speed: { min: 8, max: 36 }, lifespan: 520, scale: s(1, 0), alpha: { start: 1, end: 0 }, tint: [0xffffff, 0xfff2a0, 0x9ff4ff], blendMode: 'ADD' }, DEPTH.glow + 1);
    mk('splash', 'fx_drop', { speed: { min: 25, max: 75 }, angle: { min: 200, max: 340 }, gravityY: 220, lifespan: 420, scale: s(1, 0.4) });
    mk('sparks', 'fx_spark', { speed: { min: 30, max: 110 }, lifespan: { min: 180, max: 420 }, gravityY: 200, scale: s(1, 0), blendMode: 'ADD' }, DEPTH.glow + 1);
    mk('smoke', 'fx_smoke', { speedY: { min: -26, max: -10 }, speedX: { min: -8, max: 8 }, lifespan: 1500, scale: { start: 0.6, end: 2.2 }, alpha: { start: 0.5, end: 0 } }, DEPTH.fx + 2);
    mk('steam', 'fx_smoke', { speedY: { min: -40, max: -15 }, speedX: { min: -14, max: 14 }, lifespan: 900, scale: { start: 0.5, end: 1.8 }, alpha: { start: 0.7, end: 0 }, tint: 0xe8f4ff }, DEPTH.fx + 2);
    mk('vomit', 'fx_px', { speed: { min: 30, max: 70 }, angle: { min: 20, max: 160 }, gravityY: 240, lifespan: 450, scale: s(1, 0.6), tint: [0xb8c43a, 0xe2ec7a, 0x7d8a1e] });
    mk('confetti', 'fx_px', { speed: { min: 20, max: 60 }, angle: { min: 230, max: 310 }, gravityY: 70, lifespan: 1300, scale: s(1, 1), tint: [0xff5d9e, 0x4ff0ff, 0xffd23f, 0x5dff9b, 0xb067ff], rotate: { min: 0, max: 360 } }, DEPTH.fx + 3);
    mk('gas', 'fx_px', { lifespan: 650, alpha: { start: 0.7, end: 0 }, scale: s(1, 0.3), tint: 0xbfe6ff });
    mk('crumbs', 'fx_px', { speed: { min: 10, max: 40 }, angle: { min: 200, max: 340 }, gravityY: 160, lifespan: 300, scale: s(1, 0.8), tint: [0xd98b3a, 0xf5d27a, 0x5df2a6] });
    mk('debris', 'fx_px', { speed: { min: 40, max: 140 }, gravityY: 220, lifespan: 700, tint: [0x7a86ad, 0x3a4260, 0xa9b4d4], scale: s(1.5, 0.5) });
    mk('fire', 'fx_smoke', { speed: { min: 20, max: 80 }, lifespan: 600, scale: { start: 1.6, end: 0.2 }, alpha: { start: 1, end: 0 }, tint: [0xff8a3d, 0xffd23f, 0xff4d2a], blendMode: 'ADD' }, DEPTH.glow + 1);
    mk('foamPuff', 'fx_foam', { speed: { min: 10, max: 40 }, lifespan: 500, scale: s(1, 0.2), alpha: { start: 1, end: 0 } });
    mk('zap', 'fx_zap', { speed: { min: 0, max: 10 }, lifespan: 220, scale: s(1, 1.4), alpha: { start: 1, end: 0 }, blendMode: 'ADD' }, DEPTH.glow + 2);
    mk('dust', 'fx_px', { speedX: { min: -14, max: 14 }, speedY: { min: -18, max: -4 }, lifespan: 380, alpha: { start: 0.7, end: 0 }, scale: s(1.2, 0.4), tint: [0x9aa0b4, 0x6a7090] });
    mk('muzzle', 'fx_flash', { speed: 0, lifespan: 90, scale: s(1.2, 0.4), alpha: { start: 1, end: 0 }, blendMode: 'ADD' }, DEPTH.glow + 2);
    mk('ice', 'fx_star', { speed: { min: 10, max: 40 }, lifespan: 500, scale: s(0.8, 0), alpha: { start: 1, end: 0 }, tint: [0xc8f8ff, 0x7ad8ff, 0xffffff], blendMode: 'ADD' }, DEPTH.glow + 1);
  }

  private burst(name: string, n: number, x: number, y: number) {
    if (this.reduced) n = Math.ceil(n * 0.5);
    this.e[name]?.explode(n, x, y);
  }

  sparkle(x: number, y: number, n = 6) { this.burst('sparkle', n, x, y); }
  splash(x: number, y: number, color: number) { this.e.splash.setParticleTint(color); this.burst('splash', 8, x, y); }
  sparks(x: number, y: number, n = 6) { this.burst('sparks', n, x, y); }
  smoke(x: number, y: number) { this.burst('smoke', 1, x, y); }
  steamPuff(x: number, y: number) { this.burst('steam', 4, x, y); }
  vomit(x: number, y: number, dir: number) {
    for (let i = 0; i < 4; i++) this.scene.time.delayedCall(i * 80, () => this.e.vomit.explode(5, x + dir * 3 * i, y + (dir === 0 ? i * 2 : 0)));
  }
  confetti(x: number, y: number) { this.burst('confetti', 6, x, y); }
  crumbs(x: number, y: number) { this.burst('crumbs', 3, x, y); }
  debris(x: number, y: number) { this.burst('debris', 16, x, y); }
  zap(x: number, y: number) { this.burst('zap', 1, x, y); }
  foamPuff(x: number, y: number) { this.burst('foamPuff', 5, x, y); }
  gasPuff(x: number, y: number) { this.burst('gas', 4, x, y); }
  dust(x: number, y: number) { this.burst('dust', 3, x, y); }
  muzzle(x: number, y: number) { this.burst('muzzle', 1, x, y); }
  iceBurst(x: number, y: number) { this.burst('ice', 6, x, y); }
  explosion(x: number, y: number) {
    this.burst('fire', 18, x, y);
    this.burst('debris', 20, x, y);
    this.burst('smoke', 6, x, y);
  }
  drip(x: number, y: number) { this.e.splash.setParticleTint(0x4aa3e8); this.burst('splash', 1, x, y); }

  gasStream(bx: number, by: number, room: Room) {
    const ang = Math.random() * Math.PI;
    const d = 30 + Math.random() * 70;
    const sx = bx + Math.cos(ang) * d * (Math.random() < 0.5 ? -1 : 1);
    const sy = Math.min((room.y + room.h) * TILE - 4, by + Math.abs(Math.sin(ang)) * d);
    const p = this.scene.add.image(sx, sy, 'fx_px').setTint(0xbfe6ff).setAlpha(0.7).setDepth(DEPTH.fx).setScale(HD);
    this.scene.tweens.add({ targets: p, x: bx, y: by, alpha: 0.1, duration: 500 + Math.random() * 300, ease: 'Quad.easeIn', onComplete: () => p.destroy() });
  }

  suck(nx: number, ny: number, ang: number) {
    const a = ang + (Math.random() - 0.5) * 1.2;
    const d = 18 + Math.random() * 14;
    const p = this.scene.add.image(nx + Math.cos(a) * d, ny + Math.sin(a) * d, 'fx_px').setTint(0xd6def0).setAlpha(0.7).setDepth(DEPTH.fx).setScale(HD);
    this.scene.tweens.add({ targets: p, x: nx, y: ny, alpha: 0, duration: 220, onComplete: () => p.destroy() });
  }
}
