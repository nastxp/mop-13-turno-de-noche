import { MAP_W, MAP_H } from '../config';
import { MinHeap } from '../core/util';
import type { ShipMap } from './ShipMap';

export interface NavOpts {
  /** coste extra por casilla (p. ej. fuego) */
  cost?: (tx: number, ty: number) => number;
  maxNodes?: number;
}

/** A* sobre la rejilla de la nave, 4 direcciones. */
export class Navigation {
  private g = new Float32Array(MAP_W * MAP_H);
  private from = new Int32Array(MAP_W * MAP_H);
  private stamp = new Uint32Array(MAP_W * MAP_H);
  private gen = 1;

  constructor(private map: ShipMap) {}

  findPath(sx: number, sy: number, tx: number, ty: number, opts: NavOpts = {}): { tx: number; ty: number }[] | null {
    const m = this.map;
    if (!m.inb(sx, sy) || !m.inb(tx, ty)) return null;
    if (!m.isWalkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [{ tx, ty }];
    const gen = ++this.gen;
    const start = m.idx(sx, sy), goal = m.idx(tx, ty);
    const heap = new MinHeap<number>();
    this.g[start] = 0;
    this.from[start] = -1;
    this.stamp[start] = gen;
    heap.push(start, 0);
    let expanded = 0;
    const maxNodes = opts.maxNodes ?? 4000;
    while (heap.size) {
      const cur = heap.pop()!;
      if (cur === goal) break;
      if (++expanded > maxNodes) return null;
      const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!m.inb(nx, ny)) continue;
        const ni = m.idx(nx, ny);
        // la casilla de salida puede no ser transitable (actor pegado a algo)
        if (!m.isWalkable(nx, ny)) continue;
        const step = 1 + (opts.cost ? opts.cost(nx, ny) : 0);
        const ng = this.g[cur] + step;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.from[ni] = cur;
        heap.push(ni, ng + Math.abs(nx - tx) + Math.abs(ny - ty));
      }
    }
    if (this.stamp[goal] !== gen) return null;
    const out: { tx: number; ty: number }[] = [];
    let c = goal;
    while (c !== -1 && c !== start) {
      out.push({ tx: c % MAP_W, ty: (c / MAP_W) | 0 });
      c = this.from[c];
    }
    out.reverse();
    return out;
  }
}
