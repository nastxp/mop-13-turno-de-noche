import { bus } from '../core/EventBus';
import { ROOM_NAMES } from '../data/rooms';
import type { ResidueId } from '../data/residues';
import { audio } from './AudioManager';
import type { ShiftStats } from './ShiftStats';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export type TaskKind =
  | 'room_clean' | 'bins' | 'remove_n' | 'timed_room' | 'survive' | 'inspection' | 'capture'
  | 'remove_type' | 'stat' | 'boss' | 'bodies' | 'banquet' | 'morale';

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  target: number;
  progress: number;
  done: boolean;
  failed: boolean;
  reward: number;
  deadline?: number;
  room?: RoomId;
  /** residuos que cuentan (remove_type) */
  types?: ResidueId[];
  /** contador de ShiftStats que cuenta (stat) */
  stat?: keyof ShiftStats;
  /** instantes de comprobación (banquet) */
  checks?: number[];
  /** se muestra como x/y aunque sea porcentaje */
  pct?: boolean;
}

/** Tareas rutinarias del turno y objetivos especiales de cada misión. */
export class MissionManager {
  tasks: Task[] = [];
  private checkT = 0;
  private offs: (() => void)[] = [];

  constructor(private w: GameScene) {
    this.offs.push(bus.on('dirt:removed', (d, reason) => {
      if (reason !== 'player') return;
      this.bump('remove_n', 1);
      for (const t of this.tasks) if (t.kind === 'remove_type' && t.types?.includes(d.type)) this.bumpTask(t, 1);
    }));
    this.offs.push(bus.on('bin:emptied', () => this.bump('bins', 1)));
    this.offs.push(bus.on('creature:captured', () => this.bump('capture', 1)));
    this.offs.push(bus.on('inspector:room', () => this.bump('inspection', 1)));
    this.offs.push(bus.on('boss:defeated', () => this.bump('boss', 1)));
    this.offs.push(bus.on('body:delivered', () => this.bump('bodies', 1)));
    this.offs.push(bus.on('npc:dead', () => this.onDeath()));
  }

  destroy() { this.offs.forEach((f) => f()); }

  setup() {
    const w = this.w;
    const rooms = w.map.rooms.filter((r) => r.id !== 'pasillo');
    const dirtiest = rooms.slice().sort((a, b) => w.dirt.roomClean(a.id) - w.dirt.roomClean(b.id));
    const r1 = dirtiest[0].id;
    const dur = w.cfg.duration ?? 600;
    const rules = w.rules;
    const mission = w.mission;
    // las tareas de limpieza nunca deben empezar ya cumplidas
    if (!rules.has('banquete')) {
      w.soilRoom(r1, 70);
      this.add({ kind: 'room_clean', title: `Fregar ${ROOM_NAMES[r1]} hasta el 85 %`, target: 85, room: r1, reward: 15, pct: true });
    }
    if (!mission) {
      this.add({ kind: 'bins', title: 'Vaciar 3 papeleras llenas', target: 3, reward: 12 });
      this.add({ kind: 'remove_n', title: 'Eliminar 30 residuos', target: 30, reward: 12 });
      if (w.cfg.mode !== 'zen') {
        const deadline = Math.round(dur * 0.4);
        w.soilRoom('puente', 62);
        const hour = (22 + Math.floor((deadline / dur) * 8)) % 24;
        this.add({ kind: 'timed_room', title: `Puente al 80 % antes de las ${hour.toString().padStart(2, '0')}:00`, target: 80, room: 'puente', reward: 20, deadline, pct: true });
      } else {
        const r2 = dirtiest[1].id;
        w.soilRoom(r2, 70);
        this.add({ kind: 'room_clean', title: `Dejar ${ROOM_NAMES[r2]} reluciente (90 %)`, target: 90, room: r2, reward: 15, pct: true });
      }
    }
    // objetivos propios de cada misión
    if (rules.has('invasion')) this.add({ kind: 'remove_type', title: 'Limpiar 12 restos de combate (ácido, sangre, restos…)', target: 12, reward: 25, types: ['acido', 'sangre', 'restos', 'hollin', 'escombros'] });
    if (rules.has('epidemia')) {
      this.add({ kind: 'stat', title: 'Curar a 2 tripulantes con desinfectante', target: 2, reward: 20, stat: 'curedByPlayer' });
      this.add({ kind: 'remove_type', title: 'Desinfectar 10 vómitos, mocos o esporas', target: 10, reward: 15, types: ['vomito', 'mucosidad', 'esporas'] });
    }
    if (rules.has('banquete')) {
      w.soilRoom('comedor', 60);
      this.add({ kind: 'banquet', title: 'Comedor ≥ 70 % en 2 de las 3 visitas del maître', target: 2, reward: 35, room: 'comedor', checks: [0.3, 0.6, 0.88].map((k) => Math.round(dur * k)) });
      this.add({ kind: 'remove_type', title: 'Recoger 15 restos del banquete', target: 15, reward: 15, types: ['comida', 'basura', 'cafe', 'vomito', 'confeti'] });
    }
    if (rules.has('gravedad_cero')) this.add({ kind: 'stat', title: 'Atrapar 15 residuos flotantes', target: 15, reward: 25, stat: 'floatingCollected' });
    if (rules.has('inundacion')) {
      this.add({ kind: 'remove_type', title: 'Fregar 15 charcos de aguas residuales o agua', target: 15, reward: 20, types: ['aguas', 'agua'] });
      this.add({ kind: 'stat', title: 'Resolver 6 emergencias', target: 6, reward: 15, stat: 'emergenciesResolved' });
    }
    if (rules.has('moho')) this.add({ kind: 'remove_type', title: 'Eliminar 12 colonias de moho o esporas', target: 12, reward: 20, types: ['moho', 'esporas'] });
    if (rules.has('plaga')) this.add({ kind: 'remove_type', title: 'Fregar 12 rastros de baba o aguas', target: 12, reward: 15, types: ['baba', 'aguas'] });
    if (rules.has('fiesta_total')) {
      this.add({ kind: 'morale', title: 'Moral de la tripulación ≥ 60 % al terminar', target: 60, reward: 30, pct: true });
      this.add({ kind: 'remove_type', title: 'Recoger 15 restos de fiesta', target: 15, reward: 15, types: ['confeti', 'comida', 'vomito', 'cafe'] });
    }
    if (mission?.boss) {
      const title = mission.boss === 'reina' ? 'Derrotar a la Reina del Moho' : mission.boss === 'rey' ? 'Desenchufar al Rey Aspirador' : 'Capturar al Glorp gigante';
      this.add({ kind: 'boss', title, target: 1, reward: 50 });
    }
    if (w.cfg.duration) this.add({ kind: 'survive', title: 'Terminar el turno (06:00)', target: 1, reward: 0 });
    else this.add({ kind: 'survive', title: w.cfg.mode === 'zen' ? 'Fichar la salida cuando quieras' : 'Sobrevivir el máximo tiempo posible', target: 1, reward: 0 });
  }

  add(t: Omit<Task, 'id' | 'progress' | 'done' | 'failed'>) {
    const task: Task = { id: `${t.kind}:${this.tasks.length}`, progress: 0, done: false, failed: false, ...t };
    // la tarea de supervivencia siempre al final
    const surv = this.tasks.findIndex((x) => x.kind === 'survive');
    if (surv >= 0 && t.kind !== 'survive') this.tasks.splice(surv, 0, task);
    else this.tasks.push(task);
    return task;
  }

  /** Cada muerte añade (o amplía) la tarea de retirar los cuerpos. */
  private onDeath() {
    const t = this.tasks.find((x) => x.kind === 'bodies' && !x.failed);
    if (t) { t.target++; t.done = false; return; }
    this.add({ kind: 'bodies', title: 'Llevar los cuerpos a la cápsula médica (enfermería)', target: 1, reward: 12 });
  }

  private bumpTask(t: Task, n: number) {
    if (t.done || t.failed) return;
    t.progress = Math.min(t.target, t.progress + n);
    if (t.progress >= t.target) this.complete(t);
  }

  private bump(kind: TaskKind, n: number) {
    for (const t of this.tasks) if (t.kind === kind) this.bumpTask(t, n);
  }

  private complete(t: Task) {
    t.done = true;
    if (t.reward > 0) {
      this.w.stats.tasksDone++;
      this.w.stats.taskRewards += t.reward;
      audio.sfx('coin');
      this.w.ui.toast(`Tarea completada: ${t.title} (+${t.reward} créditos)`, 'task');
    }
    bus.emit('task:done', t);
  }

  private fail(t: Task) {
    t.failed = true;
    this.w.ui.toast(`Tarea fallida: ${t.title}`, 'task');
    audio.sfx('error');
  }

  update(dt: number) {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.5;
    const w = this.w;
    for (const t of this.tasks) {
      if (t.done || t.failed) continue;
      switch (t.kind) {
        case 'room_clean': case 'timed_room': {
          const v = w.dirt.roomClean(t.room!);
          t.progress = Math.round(v);
          if (v >= t.target) this.complete(t);
          else if (t.deadline && w.t > t.deadline) this.fail(t);
          break;
        }
        case 'stat': {
          const v = w.stats[t.stat!] as number;
          t.progress = Math.min(t.target, v);
          if (v >= t.target) this.complete(t);
          break;
        }
        case 'morale':
          t.progress = Math.round(w.ship.morale);
          break;
        case 'banquet': {
          const checks = t.checks!;
          if (checks.length && w.t >= checks[0]) {
            checks.shift();
            const v = Math.round(w.dirt.roomClean('comedor'));
            const ok = v >= 70;
            if (ok) t.progress++;
            w.announce('banquet', { pct: v, verdict: ok ? 'El maître asiente. Casi sonríe.' : 'El maître se desmaya con elegancia.' });
            w.ui.toast(`Visita del maître: comedor al ${v} % ${ok ? '✔' : '✘'}`, 'inspector');
            if (t.progress >= t.target) this.complete(t);
            else if (t.target - t.progress > checks.length) this.fail(t);
          }
          break;
        }
      }
    }
  }

  /** Al terminar el turno se cierran las tareas de supervivencia y moral. */
  finish(survived: boolean) {
    for (const t of this.tasks) {
      if (t.done || t.failed) continue;
      if (t.kind === 'survive') { t.progress = survived ? 1 : 0; if (survived) this.complete(t); else t.failed = true; }
      else if (t.kind === 'morale') { t.progress = Math.round(this.w.ship.morale); if (survived && t.progress >= t.target) this.complete(t); else t.failed = true; }
    }
  }
}
