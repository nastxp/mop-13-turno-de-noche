import { EVENTS, type EventDef } from '../data/events';
import type { GameScene } from '../scenes/GameScene';

const SEV_COST = [0, 0.5, 1.5, 2.5];

/**
 * DIRECTOR DE CAOS: evalúa el estado de la nave y decide qué incidente lanzar,
 * con curvas de tensión, enfriamientos y reglas de seguridad para no saturar al jugador.
 */
export class EventDirector {
  private timer = 14;
  private cooldowns = new Map<string, number>();
  private fired = new Set<string>();
  private lastSevere = -999;
  private lastForced = -999;
  history: { t: number; id: string }[] = [];
  /** multiplicador por modo de juego */
  intensity = 1;
  forced: string[] = [];
  /** suceso anunciado por el inodoro profético */
  private prophecy: { id: string; at: number } | null = null;

  constructor(private w: GameScene) {}

  canSpawnCreature(): boolean {
    const alive = this.w.creatures.filter((c) => c.alive && c.species !== 'insecto').length;
    return alive < (this.w.rules.has('caos') ? 4 : 3) && this.w.t > 40;
  }

  /** El inodoro profético revela el próximo suceso… y el destino se encarga de cumplirlo. */
  prophesy(): string | null {
    const w = this.w;
    const pool = EVENTS.filter((e) => e.sev >= 1 && e.sev <= 2 && (!e.cond || e.cond(w)) && !(e.once && this.fired.has(e.id)) && (this.cooldowns.get(e.id) ?? 0) <= w.t + 30);
    if (!pool.length) return null;
    const e = w.rng.pick(pool);
    this.prophecy = { id: e.id, at: w.t + 30 };
    return `«${e.name}» dentro de 30 segundos`;
  }

  /** Tensión objetivo: calma inicial, crecimiento progresivo y olas de calma/caos. */
  targetTension(): number {
    const w = this.w;
    const t = w.t;
    if (t < 45) return 0.4;
    const dur = w.cfg.duration ?? 600;
    const prog = Math.min(1.6, t / dur);
    const base = 0.6 + prog * 1.8 * w.cfg.difficulty;
    const wave = Math.sin((t / 55) * Math.PI) * 0.9;
    let target = (base + wave) * this.intensity;
    if (w.minPlayerHp() < 35) target = Math.min(target, 1);
    if (w.ship.integrity < 30) target = Math.min(target, 1.2);
    return Math.max(0.3, target);
  }

  private eligible(e: EventDef, budget: number, severeActive: number): boolean {
    const w = this.w;
    if (w.rules.has('zen') && (e.sev >= 2 || e.cat === 'invasion')) return false;
    if (w.attract && (e.id === 'inspector' || e.sev === 3)) return false;
    if (w.t < e.minTime / Math.max(0.6, w.cfg.difficulty)) return false;
    if ((this.cooldowns.get(e.id) ?? 0) > w.t) return false;
    if (e.once && this.fired.has(e.id)) return false;
    if (SEV_COST[e.sev] > budget + 0.3) return false;
    if (e.sev >= 2 && w.minPlayerHp() < 35) return false;
    if (e.sev === 3 && (severeActive >= 1 || w.t - this.lastSevere < 30)) return false;
    if (e.sev >= 2 && w.t - this.lastSevere < 12) return false;
    if (e.incompatible?.some((id) => (this.cooldowns.get(id) ?? 0) > w.t)) return false;
    if (e.cond && !e.cond(w)) return false;
    return true;
  }

  private severeActive(): number {
    const w = this.w;
    let n = w.emerg.breaches.filter((b) => !b.sealed).length;
    if (w.emerg.overheating) n++;
    if (!w.ship.gravity) n++;
    if (w.creatures.some((c) => c.alive && c.aggressive)) n++;
    if (w.emerg.fires.size > 6) n++;
    return n;
  }

  trigger(e: EventDef): boolean {
    const w = this.w;
    const ok = e.run(w);
    if (!ok) return false;
    this.cooldowns.set(e.id, w.t + e.cooldown);
    this.fired.add(e.id);
    this.history.push({ t: w.t, id: e.id });
    w.stats.events.push(e.name);
    if (e.sev >= 2) this.lastSevere = w.t;
    return true;
  }

  triggerById(id: string): boolean {
    const e = EVENTS.find((x) => x.id === id);
    return e ? this.trigger(e) : false;
  }

  update(dt: number) {
    const w = this.w;
    if (this.intensity <= 0) return;
    if (this.prophecy && w.t >= this.prophecy.at) {
      const e = EVENTS.find((x) => x.id === this.prophecy!.id);
      this.prophecy = null;
      if (e && (!e.cond || e.cond(w))) this.trigger(e);
    }
    // eventos guionizados de la noche (modo historia)
    if (this.forced.length && w.t > 100 && w.t - this.lastForced > 80) {
      const id = this.forced[0];
      const e = EVENTS.find((x) => x.id === id);
      if (e && (!e.cond || e.cond(w)) && this.severeActive() === 0) {
        this.forced.shift();
        this.lastForced = w.t;
        this.trigger(e);
      } else if (!e) this.forced.shift();
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = w.rng.range(7, 13) / Math.max(0.5, this.intensity);
    const load = w.emerg.threatLoad();
    const target = this.targetTension();
    const budget = target - load;
    if (budget <= 0.2) return;
    const severe = this.severeActive();
    const pool = EVENTS.filter((e) => this.eligible(e, budget, severe));
    if (!pool.length) return;
    const e = w.rng.weighted(pool, (x) => x.weight * (x.mod ? x.mod(w) : 1));
    if (e) this.trigger(e);
  }
}
