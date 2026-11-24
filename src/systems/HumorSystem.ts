import { bus } from '../core/EventBus';
import { audio } from './AudioManager';
import type { GameScene } from '../scenes/GameScene';
import type { Creature } from '../entities/Creature';

export const ACHIEVEMENTS: Record<string, { name: string; desc: string }> = {
  fregona_letal: { name: 'Fregona letal', desc: 'Ahuyenta a una criatura a golpe de fregona.' },
  cazador: { name: 'Cazador de Glorps', desc: 'Captura una criatura con la aspiradora.' },
  bombero: { name: 'Bombero accidental', desc: 'Apaga 10 focos de incendio en un turno.' },
  impecable: { name: 'Impecable (por un segundo)', desc: 'Lleva la nave al 95 % de limpieza.' },
  resbalon: { name: 'Resbalón olímpico', desc: 'Resbala 3 veces en un turno.' },
  heroe: { name: 'Héroe sin capa', desc: 'Reanima a 2 tripulantes.' },
  profesional: { name: 'Profesionalidad ignífuga', desc: 'Friega una sala mientras arde.' },
  trampa: { name: 'Suelo trampa', desc: 'Haz que una criatura resbale en tu suelo recién fregado.' },
  astronauta: { name: 'Conserje astronauta', desc: 'Restablece la gravedad.' },
  sellador: { name: 'Sellador nato', desc: 'Sella una fuga de oxígeno.' },
  mecenas: { name: 'Mecenas involuntario', desc: 'Termina el turno sin destruir la obra de arte.' },
  manos_limpias: { name: 'Manos limpias', desc: 'Termina un turno sin provocar incidentes.' },
  forense: { name: 'Forense de guardia', desc: 'Lleva 3 cuerpos a la cápsula médica en un turno.' },
  exterminador: { name: 'Jefe de planta', desc: 'Derrota a un jefe de la nave.' },
  curandero: { name: 'Curandero de pasillo', desc: 'Cura a 2 tripulantes con desinfectante.' },
  arqueologo: { name: 'Arqueólogo de manchas', desc: 'Encuentra una nota secreta bajo la suciedad.' },
  calcetin: { name: 'El calcetín perdido', desc: 'Recoge un calcetín misterioso.' },
  profeta: { name: 'Lo vio venir', desc: 'Consulta al inodoro profético.' },
  trampero: { name: 'Trampero espacial', desc: 'Atrapa 3 plagas con trampas en un turno.' },
  legado: { name: 'El legado de MOP-1', desc: 'Encuentra la Superfregona experimental.' },
  sin_bajas: { name: 'Nadie se queda atrás', desc: 'Sobrevive a un abordaje sin que muera ningún tripulante.' },
  eterno: { name: 'Mito de Sísifo', desc: 'Limpia la Mancha Eterna 3 veces (en total).' },
  dron: { name: 'Delegar es de sabios', desc: 'Tu dron elimina 15 residuos en un turno.' },
  zen: { name: 'Nirvana del fregado', desc: 'Pasa 10 minutos en modo zen.' },
};

/** Humor contextual: reacciones de CL-0R0, logros y pequeñas ironías del sistema. */
export class HumorSystem {
  private offs: (() => void)[] = [];
  private flags = new Set<string>();
  private idleT = 0;
  private coffeeCd = 0;
  private mopHits = new WeakMap<Creature, number>();
  private warnedEnd = false;
  private warnedO2 = 0;
  private warnedHp = 0;

  constructor(private w: GameScene) {
    const on = (e: string, h: (...a: any[]) => void) => this.offs.push(bus.on(e, h));
    on('dirt:removed', (d, reason) => {
      if (reason !== 'player' || !d.room) return;
      this.idleT = 0;
      if (this.w.emerg.roomFireCount(d.room) > 0 && !this.flags.has('fireclean')) {
        this.flags.add('fireclean');
        this.w.announce('cleanWhileFire', {}, { room: d.room });
        this.unlock('profesional');
      }
      if (d.art) {
        this.w.stats.artDestroyed = true;
        this.w.announce('artDestroyed');
        this.w.ui.removeLabel('art');
      }
    });
    on('creature:hit', (c: Creature) => this.mopHits.set(c, (this.mopHits.get(c) ?? 0) + 1));
    on('creature:fled', (c: Creature) => {
      this.w.stats.creaturesRepelled++;
      this.w.stats.emergenciesResolved++;
      if ((this.mopHits.get(c) ?? 0) >= 3) {
        this.w.stats.mopKills++;
        this.w.announce('mopKill');
        this.unlock('fregona_letal');
      } else this.w.announce('creatureFled');
      if (this.w.cleaning.wetAt(c.x, c.y) > 0.1) this.w.player.sayKey('justMopped', true);
    });
    on('creature:captured', (c: Creature) => {
      this.w.stats.creaturesCaptured++;
      this.w.stats.emergenciesResolved++;
      this.w.announce('creatureCaptured');
      this.unlock('cazador');
      if (this.w.cleaning.wetAt(c.x, c.y) > 0.1) { this.w.player.setEmote('anger', 1.5); this.w.player.sayKey('justMopped', true); }
    });
    on('creature:slip', (_c: Creature, onWet: boolean) => {
      if (onWet) { this.unlock('trampa'); this.w.player.setEmote('anger', 1.4); this.w.player.sayKey('justMopped'); }
    });
    on('creature:split', () => this.w.announce('creatureSplit'));
    on('npc:knocked', (c) => { this.w.ui.toast(`${c.name} ha caído. ¡Reanímalo con [E]!`, 'rescue'); audio.sfx('hurt'); });
    on('npc:rescued', () => { if (this.w.stats.crewRescued >= 2) this.unlock('heroe'); this.w.announce('rescued'); });
    on('player:slip', () => { if (this.w.stats.playerSlips >= 3) this.unlock('resbalon'); });
    on('gravity:on', () => this.unlock('astronauta'));
    on('breach:sealed', () => this.unlock('sellador'));
    on('dirt:expelled', () => { if (!this.flags.has('expelled')) { this.flags.add('expelled'); this.w.announce('expelled'); } });
    on('body:delivered', () => { if (this.w.stats.bodiesRecovered >= 3) this.unlock('forense'); });
    on('boss:defeated', () => this.unlock('exterminador'));
    on('disease:cured', (_c, by: string) => { if (by === 'player' && this.w.stats.curedByPlayer >= 2) this.unlock('curandero'); });
    on('secret:note', () => this.unlock('arqueologo'));
    on('secret:eternal', (n: number) => { if (n >= 3) this.unlock('eterno'); });
    on('npc:dead', (c) => { if (this.w.t - this.w.lastInvasionT < 150) this.flags.add('deathInInvasion'); this.w.ui.toast(`${c.name} ha muerto. Lleva su cuerpo a la enfermería.`, 'corpse'); });
    on('inspector:done', (avg: number) => {
      this.w.stats.inspectorAvg = avg;
      const verdict = avg >= 80 ? 'Sorprendentemente aceptable.' : avg >= 60 ? 'Mejorable, como todo.' : 'Se abrirá un expediente.';
      this.w.announce('inspectorDone', { pct: Math.round(avg), verdict });
      this.w.stats.emergenciesResolved++;
    });
  }

  unlock(id: string) {
    if (this.w.stats.achievements.includes(id)) return;
    this.w.stats.achievements.push(id);
    const a = ACHIEVEMENTS[id];
    if (a) {
      this.w.ui.toast(`🏆 Logro: ${a.name}`, 'achievement');
      audio.sfx('clean');
    }
  }

  update(dt: number) {
    const w = this.w;
    this.idleT += dt;
    this.coffeeCd -= dt;
    if (w.stats.fireCellsOut >= 10) this.unlock('bombero');
    if (w.stats.trapsCaught >= 3) this.unlock('trampero');
    if (w.stats.droneCleaned >= 15) this.unlock('dron');
    if (w.player.hasSuper) this.unlock('legado');
    if (w.secrets.usedProphecy) this.unlock('profeta');
    if (w.secrets.socks.length === 0 && w.stats.secretsFound > 0 && this.flags.has('sockSeen')) this.unlock('calcetin');
    if (w.secrets.socks.length) this.flags.add('sockSeen');
    if (w.cfg.mode === 'zen' && w.t > 600) this.unlock('zen');
    if (w.lastInvasionT > 0 && w.t - w.lastInvasionT > 60 && !w.creatures.some((c) => c.alive && c.species === 'invasor') && !this.flags.has('deathInInvasion')) this.unlock('sin_bajas');
    const h = w.ship.hygiene;
    if (h >= 95) this.unlock('impecable');
    // si limpia toda la nave, alguien tira inmediatamente una taza de café
    if (h >= 96 && this.coffeeCd <= 0) {
      this.coffeeCd = 90;
      const c = w.crew.filter((x) => x.available).sort((a, b) => Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y))[0];
      if (c) {
        w.announce('allClean');
        w.time.delayedCall(1800, () => {
          w.dirt.add('cafe', c.x + 6, c.y + 6, 1);
          w.fx.splash(c.x + 6, c.y, 0x6b3f1f);
          c.say('Uy. Perdón. ¿Estaba limpio?', true);
          audio.sfx('slip');
        });
      }
    }
    if (this.idleT > 70 && w.emerg.threatLoad() < 0.5) {
      this.idleT = 0;
      w.announce('idle');
    }
    if (w.cfg.duration && !this.warnedEnd && w.cfg.duration - w.t < 60) {
      this.warnedEnd = true;
      w.announce('ending');
    }
    if (w.ship.oxygen < 30 && w.t - this.warnedO2 > 40) { this.warnedO2 = w.t; w.announce('oxygenLow', { pct: Math.round(w.ship.oxygen) }); }
    if (w.player.hp < 30 && w.t - this.warnedHp > 50) { this.warnedHp = w.t; w.announce('lowHealth'); }
  }

  destroy() { this.offs.forEach((f) => f()); }
}
