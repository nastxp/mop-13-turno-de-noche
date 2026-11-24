import { TILE } from '../config';
import { bus } from '../core/EventBus';
import { RESIDUES } from '../data/residues';
import { ROOM_NAMES } from '../data/rooms';
import { audio } from './AudioManager';
import type { Crew } from '../entities/Crew';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export const DISEASES: Record<string, { name: string; interval: [number, number]; desc: string }> = {
  gripe: { name: 'Gripe de nebulosa', interval: [24, 36], desc: 'Vómitos periódicos.' },
  estornudo: { name: 'Estornudo fosforito', interval: [9, 15], desc: 'Estornuda mucosidad fluorescente y contagia.' },
  sonambulismo: { name: 'Sonambulismo cuántico', interval: [30, 45], desc: 'Deambula dormido por la nave.' },
  furia: { name: 'Furia fúngica', interval: [25, 40], desc: 'Se vuelve agresivo y lo tira todo.' },
  babosa: { name: 'Babosización temporal', interval: [45, 60], desc: 'Se convierte en babosa durante un rato.' },
};

/** Contaminación biológica por sala, contagios, moho que crece, esporas por la ventilación, huevos y hielo. */
export class DiseaseSystem {
  contam = new Map<RoomId, number>();
  private tick = 0;
  private outbreakT = -99;
  private sporeMsgT = -99;
  private moldMsgT = -99;

  constructor(private w: GameScene) {}

  infected(): Crew[] { return this.w.crew.filter((c) => c.alive && c.disease); }

  infect(c: Crew, id?: string) {
    const w = this.w;
    if (!c.organic || c.disease || !c.alive || c.prof === 'inspector') return;
    const dz = id ?? w.rng.pick(Object.keys(DISEASES));
    c.disease = { id: dz, t: 0, next: w.rng.range(4, 9) };
    c.sayKey('sick', true);
    c.setEmote('disgust', 1.5);
    w.stats.infections++;
    bus.emit('disease:infected', c, dz);
    if (this.infected().length >= 2 && w.t - this.outbreakT > 60) {
      this.outbreakT = w.t;
      w.announce('outbreak', { disease: DISEASES[dz].name, pct: Math.round(w.ship.morale) });
    }
  }

  cure(c: Crew, by: string) {
    if (!c.disease) return;
    c.disease = null;
    c.sleepwalkT = 0;
    c.rageT = 0;
    if (c.slugT > 0) { c.slugT = 0; c.sprite.setTexture(`char_${c.prof}`, 0); }
    c.setEmote('sparkle', 1.2);
    this.w.stats.cured++;
    if (by === 'player') { this.w.stats.curedByPlayer++; this.w.floatText(c.x, c.y - 22, '¡Curado!', 'good'); }
    bus.emit('disease:cured', c, by);
  }

  private symptom(c: Crew, id: string) {
    const w = this.w;
    switch (id) {
      case 'gripe': c.vomit(); break;
      case 'estornudo': c.sneeze(); break;
      case 'sonambulismo': c.sleepwalkT = 18; if (c.state === 'act' || c.state === 'idle') { c.releaseSpot(); c.state = 'idle'; c.idleT = 0; } break;
      case 'furia': c.rageT = 12; c.say('¡¡GRRR!! ¡Todo me molesta!', true); audio.sfx('alien'); break;
      case 'babosa':
        if (c.slugT <= 0) { c.slugT = 22; c.sayKey('slugTalk', true); w.fx.splash(c.x, c.y - 6, 0xc8d84a); }
        break;
    }
  }

  update(dt: number) {
    const w = this.w;
    const longer = w.rules.has('epidemia') ? 170 : 110;
    for (const c of w.crew) {
      if (!c.disease || !c.alive) continue;
      const d = c.disease;
      d.t += dt;
      d.next -= dt;
      if (d.next <= 0 && c.available) { this.symptom(c, d.id); d.next = w.rng.range(...DISEASES[d.id].interval); }
      if (d.t > longer) this.cure(c, 'natural');
    }
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1;
    // contaminación por sala
    const sum = new Map<RoomId, number>();
    for (const d of w.dirt.list) {
      const b = RESIDUES[d.type].bio;
      if (!b || !d.room) continue;
      sum.set(d.room, (sum.get(d.room) ?? 0) + b * Math.min(1.2, d.amount));
    }
    for (const r of w.map.rooms) {
      const v = Math.min(100, (sum.get(r.id) ?? 0) * 9 + w.combat.corpseScore(r.id) * 5);
      this.contam.set(r.id, v);
    }
    // contagios
    const mult = w.rules.has('epidemia') ? 2 : 1;
    for (const c of w.crew) {
      if (!c.organic || c.disease || !c.available || c.prof === 'inspector') continue;
      const room = c.room();
      if (!room) continue;
      let p = ((this.contam.get(room) ?? 0) / 100) * 0.01 * (1 - c.resist) * mult;
      const near = w.dirt.near(c.x, c.y, 10);
      let src: string | undefined;
      for (const d of near) {
        if (d.type === 'mucosidad') { p += 0.03; src = 'estornudo'; }
        else if (d.type === 'vomito' || d.type === 'aguas') { p += 0.012; src = 'gripe'; }
        else if (d.type === 'esporas' || d.type === 'moho') { p += 0.02; src = w.rng.pick(['sonambulismo', 'furia', 'babosa']); }
      }
      if (w.spec === 'sanitario' && w.nearestPlayer(c.x, c.y).d < 50) p *= 0.5;
      if (w.rng.chance(p)) this.infect(c, src);
    }
    // esporas por la ventilación (cadena: laboratorio → ventilación → enfermos)
    const ventRooms = [...new Set(w.map.props.filter((p) => p.kind === 'vent').map((p) => p.room))];
    for (const r of ventRooms) {
      if ((this.contam.get(r) ?? 0) < 45 || !w.rng.chance(0.04)) continue;
      const targets = w.map.props.filter((p) => p.kind === 'vent' && p.room !== r);
      if (!targets.length) continue;
      const v = w.rng.pick(targets);
      w.dirt.add('esporas', v.tx * TILE + 8 + w.rng.range(-12, 12), v.ty * TILE + 10 + w.rng.range(-8, 12), 0.6);
      w.fx.smoke(v.tx * TILE + 8, v.ty * TILE + 6);
      if (w.t - this.sporeMsgT > 35) { this.sporeMsgT = w.t; w.announce('spores', {}, { room: v.room }); }
    }
    // moho y esporas que crecen; huevos que eclosionan; hielo que se derrite; ácido que corroe
    const resist = w.memoryMoldResist ? 1.3 : 1;
    for (const d of [...w.dirt.list]) {
      switch (d.type) {
        case 'moho': {
          d.amount = Math.min(1.5, d.amount + 0.012 * resist);
          w.dirt.refresh(d);
          if (d.amount > 1 && w.rng.chance(0.035 * resist)) {
            const n = w.dirt.add('moho', d.x + w.rng.range(-14, 14), d.y + w.rng.range(-10, 10), 0.3);
            if (n && w.t - this.moldMsgT > 50 && d.room) { this.moldMsgT = w.t; w.announce('mold', {}, { room: d.room }); }
          }
          if (d.amount > 1.2 && w.rng.chance(0.015)) w.dirt.add('esporas', d.x + w.rng.range(-10, 10), d.y + w.rng.range(-8, 8), 0.4);
          break;
        }
        case 'esporas':
          if (d.amount > 0.8 && w.rng.chance(0.008)) w.dirt.add('moho', d.x, d.y, 0.3);
          break;
        case 'huevos':
          if (w.t - d.bornT > 45) {
            w.dirt.remove(d, 'other');
            const sp = w.rng.chance(0.6) ? 'glorp' : 'rata';
            w.spawnCreature(sp, d.x, d.y, sp === 'glorp' ? 0.7 : 1, 'unos huevos', true);
            if (w.rng.chance(0.5)) w.spawnCreature(sp, d.x + 8, d.y, sp === 'glorp' ? 0.6 : 1, 'unos huevos', true);
            w.announce('hatch', {}, { room: d.room ?? 'pasillo' });
            w.fx.splash(d.x, d.y, 0xc080ff);
          }
          break;
        case 'hielo':
          if (w.t - d.bornT > 25) { w.dirt.remove(d, 'other'); w.dirt.add('agua', d.x, d.y, d.amount * 0.7); }
          break;
        case 'acido':
          w.ship.damage(0.006 * d.amount);
          if (w.rng.chance(0.05)) w.fx.smoke(d.x, d.y - 2);
          break;
      }
    }
  }

  roomLabel(room: RoomId) { return `${ROOM_NAMES[room]} ${Math.round(this.contam.get(room) ?? 0)} %`; }

  globalContam(): number {
    let s = 0, n = 0;
    for (const v of this.contam.values()) { s += v; n++; }
    return n ? s / n : 0;
  }
}
