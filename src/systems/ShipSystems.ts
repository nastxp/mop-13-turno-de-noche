import { clamp } from '../core/util';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

/** Estado global de la USC Desastre: energía, oxígeno, integridad, gravedad, moral… */
export class ShipSystems {
  power = 100;
  oxygen = 100;
  integrity = 100;
  morale = 70;
  temperature = 21;
  gravity = true;
  hygiene = 100;

  constructor(private w: GameScene) {}

  get zeroG() { return !this.gravity; }

  damage(n: number) {
    this.integrity = clamp(this.integrity - n, 0, 100);
  }

  roomLight(room: RoomId): number {
    const r = this.w.map.room(room);
    let l = this.power / 100;
    if (r.panel?.broken) l *= 0.3;
    return clamp(l, 0.08, 1);
  }

  update(dt: number) {
    const w = this.w;
    let broken = 0;
    for (const f of w.map.fixtures) if (f.kind === 'panel' && f.broken) broken++;
    const target = clamp(100 - broken * 13 - (w.emerg.blackoutT > 0 ? 70 : 0), 5, 100);
    this.power += (target - this.power) * Math.min(1, dt * 1.5);
    const openBreaches = w.emerg.breaches.some((b) => !b.sealed);
    if (!openBreaches) this.oxygen = Math.min(100, this.oxygen + 0.55 * (this.power / 100) * dt);
    this.oxygen = clamp(this.oxygen, 0, 100);
    const alive = w.crew.filter((c) => c.alive);
    if (alive.length) this.morale = alive.reduce((a, c) => a + c.morale, 0) / alive.length;
    this.temperature = 21 + w.emerg.fires.size * 0.7;
    this.hygiene = w.dirt.globalClean();
  }
}
