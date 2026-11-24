import { TILE } from '../config';
import { RESIDUES, type ResidueId } from './residues';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export type EventCategory = 'cotidiano' | 'tecnico' | 'invasion' | 'absurdo';

/**
 * Definición de un evento del Director de Caos.
 * Los efectos SIEMPRE se aplican sobre los sistemas reales (suciedad, paneles, fuego, IA…).
 */
export interface EventDef {
  id: string;
  name: string;
  cat: EventCategory;
  /** 0 = curiosidad, 1 = menor, 2 = grave, 3 = crítico */
  sev: 0 | 1 | 2 | 3;
  weight: number;
  cooldown: number;
  /** segundos mínimos de turno transcurridos */
  minTime: number;
  once?: boolean;
  rooms?: RoomId[];
  cond?: (w: GameScene) => boolean;
  /** modificador de peso según el estado de la nave */
  mod?: (w: GameScene) => number;
  incompatible?: string[];
  /** devuelve true si el evento ha ocurrido realmente */
  run: (w: GameScene) => boolean;
}

const crewBy = (w: GameScene, pred: (c: GameScene['crew'][number]) => boolean) => {
  const list = w.crew.filter((c) => c.available && pred(c));
  return list.length ? w.rng.pick(list) : null;
};

const roomDirt = (w: GameScene, room: RoomId) => 100 - w.dirt.roomClean(room);

const scatter = (w: GameScene, room: RoomId, type: ResidueId, n: number, amt: number) => {
  for (let i = 0; i < n; i++) {
    const t = w.map.randomFloor(w.rng, room);
    w.dirt.add(type, t.tx * TILE + w.rng.range(2, 14), t.ty * TILE + w.rng.range(4, 14), amt * w.rng.range(0.7, 1.2));
  }
};

export const EVENTS: EventDef[] = [
  // ───────── A. Problemas cotidianos ─────────
  {
    id: 'vomito', name: 'Un tripulante vomita', cat: 'cotidiano', sev: 1, weight: 10, cooldown: 30, minTime: 20,
    mod: (w) => 1 + (100 - w.ship.hygiene) / 40,
    run: (w) => {
      const c = crewBy(w, (c) => c.prof === 'turista' && c.vomitCd <= 0) ?? crewBy(w, (c) => c.vomitCd <= 0 && c.prof !== 'inspector');
      if (!c) return false;
      c.sick = 110;
      return c.vomit();
    },
  },
  {
    id: 'bandeja', name: 'Bandeja de comida al suelo', cat: 'cotidiano', sev: 1, weight: 9, cooldown: 35, minTime: 10,
    run: (w) => {
      const c = crewBy(w, (c) => c.room() === 'comedor') ?? crewBy(w, () => true);
      if (!c) return false;
      c.say('¡Mi bandeja! ¡Mi sopa de nebulosa!', true);
      for (let i = 0; i < 4; i++) w.dirt.add(i % 2 ? 'comida' : 'cafe', c.x + w.rng.range(-14, 14), c.y + w.rng.range(-4, 12), 0.8);
      w.fx.splash(c.x, c.y, 0xd98b3a);
      return true;
    },
  },
  {
    id: 'inodoro', name: 'Inodoro atascado', cat: 'cotidiano', sev: 1, weight: 5, cooldown: 50, minTime: 30,
    run: (w) => {
      const toilets = w.map.propsOf('toilet').filter((p) => !p.state.clog);
      if (!toilets.length) return false;
      return w.emerg.clogToilet(w.rng.pick(toilets));
    },
  },
  {
    id: 'tuberia', name: 'Tubería con fugas', cat: 'cotidiano', sev: 1, weight: 4, cooldown: 50, minTime: 40,
    run: (w) => {
      const pipes = w.map.fixtures.filter((f) => f.kind === 'pipe' && !f.leaking);
      if (!pipes.length) return false;
      return w.emerg.startLeak(w.rng.pick(pipes));
    },
  },
  {
    id: 'rastro_basura', name: 'Pasajero deja un rastro de basura', cat: 'cotidiano', sev: 1, weight: 6, cooldown: 45, minTime: 15,
    run: (w) => {
      const c = crewBy(w, (c) => c.prof === 'turista') ?? crewBy(w, () => true);
      if (!c) return false;
      c.trailT = 14;
      c.trailType = 'basura';
      c.say('¿Papeleras? Qué concepto tan antiguo.', true);
      return true;
    },
  },
  {
    id: 'fuga_aceite', name: 'Fuga de aceite del ingeniero', cat: 'cotidiano', sev: 1, weight: 5, cooldown: 60, minTime: 25,
    run: (w) => {
      const c = crewBy(w, (c) => c.prof === 'ingeniero');
      if (!c) return false;
      c.trailT = 15;
      c.trailType = 'aceite';
      c.say('Mi caja de herramientas gotea un poquito. Nada grave.', true);
      return true;
    },
  },
  {
    id: 'polvo_ventilacion', name: 'La ventilación escupe polvo', cat: 'cotidiano', sev: 1, weight: 6, cooldown: 40, minTime: 10,
    run: (w) => {
      const vents = w.map.propsOf('vent');
      if (!vents.length) return false;
      const v = w.rng.pick(vents);
      const cx = v.tx * TILE + 8, cy = v.ty * TILE + 8;
      for (let i = 0; i < 7; i++) w.dirt.add('polvo', cx + w.rng.range(-28, 28), cy + w.rng.range(-18, 22), 0.8);
      w.fx.smoke(cx, cy);
      w.fx.smoke(cx + 6, cy - 2);
      return true;
    },
  },
  {
    id: 'cafetera', name: 'La cafetera explota', cat: 'cotidiano', sev: 1, weight: 4, cooldown: 120, minTime: 60, once: true,
    run: (w) => {
      const m = w.map.propsOf('coffee')[0];
      if (!m || m.state.broken) return false;
      m.state.broken = true;
      m.sprite?.setFrame(1);
      const x = m.tx * TILE + 8, y = m.ty * TILE + 18;
      for (let i = 0; i < 6; i++) w.dirt.add('cafe', x + w.rng.range(-26, 26), y + w.rng.range(0, 28), 0.9);
      w.fx.sparks(x, y - 10, 10);
      w.fx.splash(x, y, 0x6b3f1f);
      w.shake(0.006, 200);
      w.announce('coffeeBoom', {}, { room: m.room });
      return true;
    },
  },
  {
    id: 'expendedora', name: 'La máquina expendedora explota', cat: 'cotidiano', sev: 1, weight: 3, cooldown: 120, minTime: 80, once: true,
    run: (w) => {
      const m = w.map.propsOf('vending')[0];
      if (!m || m.state.broken) return false;
      m.state.broken = true;
      m.sprite?.setFrame(1);
      const x = m.tx * TILE + 8, y = m.ty * TILE + 20;
      for (let i = 0; i < 7; i++) w.dirt.add(i % 3 ? 'comida' : 'basura', x + w.rng.range(-30, 30), y + w.rng.range(0, 22), 0.8);
      w.fx.explosion(x, y - 8);
      w.shake(0.008, 250);
      w.announce('vending', {}, { room: 'pasillo' });
      return true;
    },
  },
  {
    id: 'recipiente', name: 'Un científico rompe un recipiente', cat: 'cotidiano', sev: 1, weight: 5, cooldown: 50, minTime: 30,
    run: (w) => {
      const c = crewBy(w, (c) => c.prof === 'cientifica');
      if (!c) return false;
      c.say('Ese frasco no estaba etiquetado. Bueno, sí: «NO ROMPER».', true);
      w.dirt.add('quimico', c.x + 8, c.y + 4, 1.2);
      w.dirt.add('quimico', c.x - 6, c.y + 10, 0.7);
      w.fx.splash(c.x, c.y, 0xb067ff);
      return true;
    },
  },
  // ───────── B. Emergencias técnicas ─────────
  {
    id: 'cortocircuito', name: 'Cortocircuito', cat: 'tecnico', sev: 2, weight: 4, cooldown: 60, minTime: 70,
    mod: (w) => 1 + w.dirt.list.filter((d) => RESIDUES[d.type].conductive).length / 30,
    run: (w) => {
      const panels = w.map.fixtures.filter((f) => f.kind === 'panel' && !f.broken && !f.isGravity);
      if (!panels.length) return false;
      w.emerg.breakPanel(w.rng.pick(panels), 'sobrecarga', false);
      return true;
    },
  },
  {
    id: 'incendio', name: 'Incendio eléctrico', cat: 'tecnico', sev: 2, weight: 5, cooldown: 80, minTime: 90,
    cond: (w) => w.ship.integrity > 35,
    mod: (w) => 1 + w.dirt.list.filter((d) => RESIDUES[d.type].flammable).length / 15,
    run: (w) => {
      // preferimos salas con combustible en el suelo
      const flam = w.dirt.list.filter((d) => RESIDUES[d.type].flammable && d.room && d.room !== 'pasillo');
      if (flam.length && w.rng.chance(0.6)) {
        const d = w.rng.pick(flam);
        return w.emerg.ignite(Math.floor(d.x / TILE), Math.floor(d.y / TILE), 0.5, 'un residuo inflamable');
      }
      const panels = w.map.fixtures.filter((f) => f.kind === 'panel');
      const f = w.rng.pick(panels);
      return w.emerg.ignite(f.spot.tx, f.spot.ty + 1, 0.5, 'un panel') || w.emerg.ignite(f.spot.tx, f.spot.ty, 0.5, 'un panel');
    },
  },
  {
    id: 'fuga_oxigeno', name: 'Fuga de oxígeno', cat: 'tecnico', sev: 3, weight: 4, cooldown: 110, minTime: 120,
    cond: (w) => w.ship.integrity > 30 && !w.emerg.breaches.some((b) => !b.sealed),
    run: (w) => {
      const rooms = w.map.rooms.filter((r) => r.id !== 'pasillo').map((r) => r.id);
      return !!w.emerg.startBreach(w.rng.pick(rooms));
    },
  },
  {
    id: 'gravedad', name: 'Pérdida de gravedad', cat: 'tecnico', sev: 3, weight: 2.5, cooldown: 160, minTime: 150,
    cond: (w) => w.ship.gravity,
    run: (w) => {
      const f = w.map.fixtures.find((x) => x.isGravity);
      if (!f) return false;
      w.emerg.breakPanel(f, 'fallo del generador', false);
      return true;
    },
  },
  {
    id: 'reactor', name: 'Sobrecalentamiento del reactor', cat: 'tecnico', sev: 2, weight: 3.5, cooldown: 120, minTime: 110,
    cond: (w) => !w.emerg.overheating && w.ship.integrity > 35,
    run: (w) => w.emerg.startOverheat(),
  },
  {
    id: 'apagon', name: 'Apagón general', cat: 'tecnico', sev: 1, weight: 2.5, cooldown: 140, minTime: 100,
    cond: (w) => w.emerg.blackoutT <= 0,
    run: (w) => {
      w.emerg.blackoutT = 22;
      w.stats.emergencies++;
      w.announce('blackout');
      for (const c of w.crew) if (c.available && c.prof === 'turista') c.sayKey('dark', true);
      return true;
    },
  },
  // ───────── C. Invasiones ─────────
  {
    id: 'criatura', name: 'Criatura en la ventilación', cat: 'invasion', sev: 2, weight: 5, cooldown: 90, minTime: 75,
    cond: (w) => w.director.canSpawnCreature(),
    mod: (w) => 1 + (100 - w.ship.hygiene) / 30,
    run: (w) => {
      // prefiere salir cerca de la suciedad (se alimenta de ella)
      const vents = [...w.map.propsOf('vent'), ...w.map.propsOf('toilet')].filter((p) => p.spots.length);
      const v = w.rng.weighted(vents, (p) => 1 + roomDirt(w, p.room) / 10);
      if (!v) return false;
      const s = v.spots[0];
      const c = w.map.tileCenter(s.tx, s.ty);
      w.spawnCreature('glorp', c.x, c.y, w.rng.range(0.85, 1.1), v.kind === 'toilet' ? 'un inodoro' : 'la ventilación');
      return true;
    },
  },
  // ───────── E. Absurdos ─────────
  {
    id: 'inspector', name: 'Inspector corporativo', cat: 'absurdo', sev: 2, weight: 3, cooldown: 999, minTime: 150, once: true,
    cond: (w) => !w.inspector,
    run: (w) => w.startInspector(),
  },
  {
    id: 'fiesta', name: 'El capitán organiza una fiesta', cat: 'absurdo', sev: 1, weight: 2.5, cooldown: 200, minTime: 120,
    cond: (w) => w.crew.some((c) => c.prof === 'capitan' && c.available) && w.emerg.partyT <= 0,
    run: (w) => {
      w.emerg.partyT = 25;
      const cap = w.crew.find((c) => c.prof === 'capitan');
      cap?.say('¡Atención, tripulación! ¡Fiesta en el comedor! Es una orden.', true);
      w.announce('party', {}, { room: 'comedor' });
      return true;
    },
  },
  {
    id: 'tormenta', name: 'Tormenta espacial', cat: 'absurdo', sev: 1, weight: 2.5, cooldown: 150, minTime: 90,
    cond: (w) => w.emerg.stormT <= 0,
    run: (w) => {
      w.emerg.stormT = 18;
      w.announce('storm');
      return true;
    },
  },
  {
    id: 'arte', name: 'La IA declara una mancha obra de arte', cat: 'absurdo', sev: 0, weight: 2, cooldown: 999, minTime: 60, once: true,
    cond: (w) => w.dirt.list.some((d) => d.amount > 0.7 && d.room !== null),
    run: (w) => w.markArt(),
  },
  // ───────── Fases 2-3: invasiones, epidemias, plagas ─────────
  {
    id: 'invasion', name: 'Abordaje de Rasgadores', cat: 'invasion', sev: 3, weight: 2.2, cooldown: 150, minTime: 140,
    cond: (w) => !w.creatures.some((c) => c.alive && c.species === 'invasor'),
    mod: (w) => (w.rules.has('invasion') ? 4 : 1),
    run: (w) => w.startInvasion(),
  },
  {
    id: 'epidemia', name: 'Brote de enfermedad', cat: 'invasion', sev: 2, weight: 2.5, cooldown: 120, minTime: 90,
    mod: (w) => 1 + w.disease.globalContam() / 30 + (w.rules.has('epidemia') ? 3 : 0),
    run: (w) => {
      const c = w.crew.filter((x) => x.available && x.organic && !x.disease && x.prof !== 'inspector');
      if (!c.length) return false;
      const dz = w.rng.pick(['gripe', 'estornudo', 'sonambulismo', 'furia', 'babosa']);
      for (const x of w.rng.shuffle(c).slice(0, 2)) w.disease.infect(x, dz);
      return true;
    },
  },
  {
    id: 'moho', name: 'Colonia de moho', cat: 'invasion', sev: 1, weight: 3, cooldown: 70, minTime: 60,
    mod: (w) => 1 + (100 - w.ship.hygiene) / 40,
    run: (w) => {
      const rooms = ['banos', 'hidroponico', 'laboratorio', 'comedor'].filter((r) => w.map.roomById.has(r as any));
      const r = w.map.room(w.rng.pick(rooms) as any);
      const t = w.rng.pick(r.floorTiles);
      for (let i = 0; i < 3; i++) w.dirt.add('moho', t.tx * TILE + w.rng.range(-10, 22), t.ty * TILE + w.rng.range(-6, 16), 0.7);
      w.announce('mold', {}, { room: r.id });
      return true;
    },
  },
  {
    id: 'ratas', name: 'Roedores de chatarra', cat: 'invasion', sev: 1, weight: 3, cooldown: 90, minTime: 70,
    mod: (w) => 1 + w.dirt.list.filter((d) => d.type === 'basura' || d.type === 'comida').length / 8,
    run: (w) => {
      const v = w.rng.pick(w.map.propsOf('vent'));
      const c = w.map.tileCenter(v.tx, v.ty);
      const n = w.rng.int(2, 3);
      for (let i = 0; i < n; i++) w.spawnCreature('rata', c.x + i * 4, c.y, 1, 'la ventilación', true);
      w.announce('rats', {}, { room: v.room });
      return true;
    },
  },
  {
    id: 'insectos', name: 'Enjambre devoracables', cat: 'invasion', sev: 2, weight: 2, cooldown: 120, minTime: 110,
    run: (w) => {
      const v = w.rng.pick(w.map.propsOf('vent'));
      const c = w.map.tileCenter(v.tx, v.ty);
      for (let i = 0; i < 4; i++) w.spawnCreature('insecto', c.x + w.rng.range(-6, 6), c.y + w.rng.range(-4, 4), 1, 'la ventilación', true);
      w.announce('insects', {}, { room: v.room });
      return true;
    },
  },
  {
    id: 'babosa', name: 'Babosa gigante', cat: 'invasion', sev: 2, weight: 1.6, cooldown: 160, minTime: 130,
    cond: (w) => !w.creatures.some((c) => c.alive && c.species === 'babosa'),
    run: (w) => {
      const v = w.rng.pick([...w.map.propsOf('vent'), ...w.map.propsOf('toilet')].filter((p) => p.spots.length));
      const s = v.spots[0];
      const c = w.map.tileCenter(s.tx, s.ty);
      w.spawnCreature('babosa', c.x, c.y, 1, 'las tuberías', true);
      w.announce('slug', {}, { room: v.room });
      return true;
    },
  },
  {
    id: 'contrabando', name: 'Mascota ilegal', cat: 'absurdo', sev: 1, weight: 1.5, cooldown: 150, minTime: 80,
    cond: (w) => w.crew.some((c) => c.prof === 'contrabandista' && c.available),
    run: (w) => {
      const c = w.crew.find((x) => x.prof === 'contrabandista' && x.available)!;
      c.say('¿Mi mascota? No sé de qué me habla. Se llama Pepe.', true);
      w.spawnCreature('rata', c.x + 8, c.y, 1, 'una maleta', true);
      w.dirt.add('huevos', c.x - 6, c.y + 6, 1);
      w.announce('eggs', {}, { room: c.room() ?? 'pasillo' });
      return true;
    },
  },
  {
    id: 'altavoces', name: 'Los altavoces mienten', cat: 'absurdo', sev: 0, weight: 1.5, cooldown: 200, minTime: 100,
    run: (w) => { w.lieCount = 2; return true; },
  },
];
