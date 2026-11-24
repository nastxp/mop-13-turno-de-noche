import { TILE } from '../config';
import { RESIDUES } from '../data/residues';
import type { Crew, RespTask, TaskKind } from '../entities/Crew';
import type { ResponderRole } from '../data/crew';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

export interface FakeAlarm { id: number; room: RoomId; x: number; y: number; icon: string; t: number; by: string }

/**
 * Despacho de emergencias: asigna a cada incidente el tripulante adecuado
 * (seguridad combate, ingeniería repara y apaga fuegos, la médica reanima y cura, el robot mantiene).
 */
export class ResponseSystem {
  fakes: FakeAlarm[] = [];
  private t = 0;
  private fakeId = 1;
  private announceT = -99;

  constructor(private w: GameScene) {}

  private assignee(target: any): Crew | undefined {
    return this.w.crew.find((c) => c.task && c.task.target === target && c.state === 'respond');
  }

  assigneeName(kind: string, target: any): string | null {
    const c = this.w.crew.find((x) => x.state === 'respond' && x.task && (x.task.target === target || (kind === 'fire' && x.task.kind === 'fire' && x.task.room === target)));
    return c ? c.name : null;
  }

  private free(roles: ResponderRole[]): Crew[] {
    return this.w.crew.filter((c) => c.available && !c.busy && c.state !== 'flee' && roles.includes(c.arch.role) && c.slugT <= 0 && !c.disease);
  }

  private nearest(list: Crew[], x: number, y: number): Crew | undefined {
    let best: Crew | undefined, bd = 1e9;
    for (const c of list) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  private give(roles: ResponderRole[], kind: TaskKind, room: RoomId, target: any, x: number, y: number) {
    const c = this.nearest(this.free(roles), x, y);
    if (!c) return false;
    const task: RespTask = { kind, room, target, x, y, t: 0, work: 0 };
    c.assign(task);
    if (this.w.t - this.announceT > 25 && kind !== 'clean') {
      this.announceT = this.w.t;
      this.w.announce('respond', { name: c.name }, { room });
    }
    return true;
  }

  valid(tk: RespTask): boolean {
    const w = this.w;
    switch (tk.kind) {
      case 'fight': return tk.target.alive && !tk.target.hidden;
      case 'fire': return w.emerg.roomFireCount(tk.room) > 0;
      case 'breach': return !tk.target.sealed;
      case 'fixture': return tk.target.broken || tk.target.leaking;
      case 'toilet': return !!tk.target.state.clog;
      case 'reactor': return w.emerg.overheating;
      case 'revive': return tk.target.state === 'knocked';
      case 'treat': return !!tk.target.disease && tk.target.available;
      case 'clean': return w.dirt.list.includes(tk.target);
    }
    return false;
  }

  falseAlarm(by: Crew) {
    const w = this.w;
    const rooms = w.map.rooms.filter((r) => r.id !== 'pasillo');
    const r = w.rng.pick(rooms);
    const t = w.rng.pick(r.floorTiles);
    this.fakes.push({ id: this.fakeId++, room: r.id, x: t.tx * TILE + 8, y: t.ty * TILE + 8, icon: w.rng.pick(['creature', 'fire', 'alarm']), t: 0, by: by.name });
  }

  update(dt: number) {
    const w = this.w;
    for (let i = this.fakes.length - 1; i >= 0; i--) {
      const f = this.fakes[i];
      f.t += dt;
      if (w.nearestPlayer(f.x, f.y).d < 40) {
        this.fakes.splice(i, 1);
        w.announce('falseAlarm');
        w.stats.falseAlarms++;
        w.floatText(f.x, f.y - 16, 'Falsa alarma', 'info');
      } else if (f.t > 45) this.fakes.splice(i, 1);
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.8;
    // combate
    for (const c of w.creatures) {
      if (!c.alive || c.hidden || this.assignee(c)) continue;
      const room = w.map.roomAtPx(c.x, c.y) ?? 'pasillo';
      this.give(['combate'], 'fight', room, c, c.x, c.y);
    }
    // fuego por sala
    const fireRooms = new Map<RoomId, { x: number; y: number }>();
    for (const f of w.emerg.fires.values()) if (f.room && !fireRooms.has(f.room)) fireRooms.set(f.room, { x: f.tx * TILE + 8, y: f.ty * TILE + 10 });
    for (const [room, pos] of fireRooms) {
      const busy = w.crew.filter((c) => c.state === 'respond' && c.task?.kind === 'fire' && c.task.room === room).length;
      if (busy < (w.emerg.roomFireCount(room) > 5 ? 2 : 1)) this.give(['tecnico', 'mantenimiento'], 'fire', room, room, pos.x, pos.y);
    }
    for (const b of w.emerg.breaches) if (!b.sealed && !this.assignee(b)) this.give(['tecnico'], 'breach', b.room, b, b.x, b.y + 10);
    for (const f of w.map.fixtures) {
      if (!(f.broken || f.leaking) || this.assignee(f)) continue;
      if (f.isGravity && w.rules.has('gravedad_cero')) continue;
      const c = w.map.tileCenter(f.spot.tx, f.spot.ty);
      this.give(['tecnico', 'mantenimiento'], 'fixture', f.room, f, c.x, c.y);
    }
    for (const t of w.map.props) {
      if (t.kind !== 'toilet' || !t.state.clog || this.assignee(t) || !t.spots[0]) continue;
      const c = w.map.tileCenter(t.spots[0].tx, t.spots[0].ty);
      this.give(['mantenimiento', 'tecnico'], 'toilet', t.room, t, c.x, c.y);
    }
    if (w.emerg.overheating) {
      const rc = w.map.props.find((x) => x.kind === 'reactorConsole');
      if (rc && rc.spots[0] && !this.assignee(rc)) { const c = w.map.tileCenter(rc.spots[0].tx, rc.spots[0].ty); this.give(['tecnico'], 'reactor', rc.room, rc, c.x, c.y); }
    }
    for (const k of w.crew) {
      if (k.state === 'knocked' && !this.assignee(k)) this.give(k.organic ? ['medico'] : ['tecnico'], 'revive', k.room() ?? 'pasillo', k, k.x, k.y);
      else if (k.disease && k.available && k.disease.t > 8 && !this.assignee(k)) this.give(['medico'], 'treat', k.room() ?? 'pasillo', k, k.x, k.y);
    }
    // el robot de mantenimiento limpia lo grueso cerca de él
    for (const r of this.free(['mantenimiento'])) {
      const near = w.dirt.near(r.x, r.y, 70).filter((d) => d.amount > 0.6 && RESIDUES[d.type].solid && !this.assignee(d));
      if (near.length && w.rng.chance(0.4)) {
        const d = near[0];
        r.assign({ kind: 'clean', room: d.room ?? 'pasillo', target: d, x: d.x, y: d.y, t: 0, work: 0 });
      }
    }
  }
}
