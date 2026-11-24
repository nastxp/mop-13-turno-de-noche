import { MAP_H, MAP_W, TILE } from '../config';
import { Rng } from '../core/Rng';
import { PROP_DEFS, ROOM_DEFS, ROOM_NAMES, type FloorStyle, type PropKind, type RoomDef } from '../data/rooms';
import type { Facing, RoomId } from '../types';

export const enum Tile { Void = 0, Floor = 1, Wall = 2, Door = 3 }

export interface Spot { tx: number; ty: number; face: Facing; prop: Prop | null; taken: unknown }

export interface Prop {
  id: number;
  kind: PropKind;
  tx: number; ty: number; w: number; h: number;
  room: RoomId;
  blocks: boolean;
  spots: Spot[];
  state: Record<string, any>;
  sprite?: Phaser.GameObjects.Sprite;
  variant: number;
}

export interface Door {
  id: number;
  tiles: { tx: number; ty: number }[];
  orient: 'h' | 'v';
  a: RoomId; b: RoomId;
  locked: boolean;
  open: number;
  sprites: Phaser.GameObjects.Sprite[];
  lockIcon?: Phaser.GameObjects.Image;
}

export interface Fixture {
  id: number;
  kind: 'panel' | 'pipe';
  tx: number; ty: number;
  room: RoomId;
  spot: { tx: number; ty: number };
  broken: boolean;
  leaking: boolean;
  isGravity: boolean;
  patched: boolean;
  sprite?: Phaser.GameObjects.Sprite;
  sparkT: number;
  leakT: number;
  /** segundos de inmunidad al agua tras una reparación */
  graceT: number;
  /** congelada con el pulverizador criogénico hasta este instante */
  frozenT: number;
}

export interface Room {
  id: RoomId;
  name: string;
  def: RoomDef | null;
  slot: number;
  /** interior en casillas */
  x: number; y: number; w: number; h: number;
  floor: FloorStyle;
  accent: string;
  props: Prop[];
  panel: Fixture | null;
  pipe: Fixture | null;
  doors: Door[];
  floorTiles: { tx: number; ty: number }[];
}

export class ShipMap {
  readonly w = MAP_W;
  readonly h = MAP_H;
  tiles = new Uint8Array(MAP_W * MAP_H);
  propAt: (Prop | null)[] = new Array(MAP_W * MAP_H).fill(null);
  roomAt: (RoomId | null)[] = new Array(MAP_W * MAP_H).fill(null);
  doorAt: (Door | null)[] = new Array(MAP_W * MAP_H).fill(null);
  rooms: Room[] = [];
  roomById = new Map<RoomId, Room>();
  doors: Door[] = [];
  props: Prop[] = [];
  fixtures: Fixture[] = [];
  spawn = { tx: 12, ty: 13 };
  private nextId = 1;

  constructor(rng: Rng, private opts: { secretLocker?: boolean } = {}) {
    this.build(rng);
  }

  idx(tx: number, ty: number) { return ty * MAP_W + tx; }
  inb(tx: number, ty: number) { return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H; }
  tile(tx: number, ty: number): Tile { return this.inb(tx, ty) ? (this.tiles[this.idx(tx, ty)] as Tile) : Tile.Void; }

  isFloorish(tx: number, ty: number) {
    const t = this.tile(tx, ty);
    return t === Tile.Floor || t === Tile.Door;
  }

  /** Transitable para la navegación (puertas cerradas con llave = bloqueo). */
  isWalkable(tx: number, ty: number): boolean {
    if (!this.inb(tx, ty)) return false;
    const i = this.idx(tx, ty);
    const t = this.tiles[i];
    if (t === Tile.Floor) return !this.propAt[i];
    if (t === Tile.Door) return !this.doorAt[i]?.locked;
    return false;
  }

  isSolidPx(x: number, y: number): boolean {
    return !this.isWalkable(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  roomAtPx(x: number, y: number): RoomId | null {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inb(tx, ty) ? this.roomAt[this.idx(tx, ty)] : null;
  }

  room(id: RoomId): Room { return this.roomById.get(id)!; }

  tileCenter(tx: number, ty: number) { return { x: tx * TILE + 8, y: ty * TILE + 10 }; }

  private carve(ox: number, oy: number, ow: number, oh: number, id: RoomId) {
    for (let y = oy; y < oy + oh; y++) {
      for (let x = ox; x < ox + ow; x++) {
        const border = x === ox || y === oy || x === ox + ow - 1 || y === oy + oh - 1;
        const i = this.idx(x, y);
        if (border) {
          if (this.tiles[i] !== Tile.Floor) this.tiles[i] = Tile.Wall;
        } else {
          this.tiles[i] = Tile.Floor;
          this.roomAt[i] = id;
        }
      }
    }
  }

  private makeDoor(tiles: { tx: number; ty: number }[], orient: 'h' | 'v', a: RoomId, b: RoomId) {
    const door: Door = { id: this.nextId++, tiles, orient, a, b, locked: false, open: 0, sprites: [] };
    for (const t of tiles) {
      const i = this.idx(t.tx, t.ty);
      this.tiles[i] = Tile.Door;
      this.doorAt[i] = door;
      this.roomAt[i] = a === 'pasillo' ? b : a;
    }
    this.doors.push(door);
    this.roomById.get(a)?.doors.push(door);
    this.roomById.get(b)?.doors.push(door);
    return door;
  }

  private addProp(kind: PropKind, tx: number, ty: number, room: RoomId, variant = 0): Prop {
    const d = PROP_DEFS[kind];
    const p: Prop = { id: this.nextId++, kind, tx, ty, w: d.w, h: d.h, room, blocks: d.blocks, spots: [], state: {}, variant };
    if (d.blocks) {
      for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) this.propAt[this.idx(x, y)] = p;
    }
    this.props.push(p);
    this.roomById.get(room)?.props.push(p);
    return p;
  }

  private build(rng: Rng) {
    const order = rng.shuffle(Object.keys(ROOM_DEFS) as Exclude<RoomId, 'pasillo'>[]);
    // pasillo central
    const corridor: Room = {
      id: 'pasillo', name: ROOM_NAMES.pasillo, def: null, slot: -1, x: 2, y: 12, w: 59, h: 3,
      floor: 'metal', accent: '#ffd23f', props: [], panel: null, pipe: null, doors: [], floorTiles: [],
    };
    this.rooms.push(corridor);
    this.roomById.set('pasillo', corridor);
    this.carve(1, 11, 61, 5, 'pasillo');

    order.forEach((id, slot) => {
      const def = ROOM_DEFS[id];
      const col = slot % 4, row = slot < 4 ? 0 : 1;
      const ox = 1 + col * 15, oy = row === 0 ? 1 : 15;
      const room: Room = {
        id, name: def.name, def, slot, x: ox + 1, y: oy + 1, w: 14, h: 9, floor: def.floor, accent: def.accent,
        props: [], panel: null, pipe: null, doors: [], floorTiles: [],
      };
      this.rooms.push(room);
      this.roomById.set(id, room);
      this.carve(ox, oy, 16, 11, id);
    });

    // puertas al pasillo
    for (const room of this.rooms) {
      if (room.id === 'pasillo') continue;
      const row = room.slot < 4 ? 0 : 1;
      const wy = row === 0 ? room.y + room.h : room.y - 1;
      this.makeDoor([{ tx: room.x + 6, ty: wy }, { tx: room.x + 7, ty: wy }], 'h', room.id, 'pasillo');
    }
    // puertas laterales entre salas vecinas (2 de 4 posibles)
    const pairs: [number, number][] = rng.shuffle([[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]] as [number, number][]).slice(0, 3);
    for (const [sa, sb] of pairs) {
      const A = this.rooms.find((r) => r.slot === sa)!;
      const B = this.rooms.find((r) => r.slot === sb)!;
      this.makeDoor([{ tx: B.x - 1, ty: A.y + 4 }], 'v', A.id, B.id);
    }

    // mobiliario
    for (const room of this.rooms) {
      if (!room.def) continue;
      for (const pl of room.def.props) {
        this.addProp(pl.kind, room.x + pl.x, room.y + pl.y, room.id, pl.kind === 'bed' || pl.kind === 'locker' || pl.kind === 'barrel' ? rng.int(0, 3) : 0);
      }
      const panel: Fixture = {
        id: this.nextId++, kind: 'panel', tx: room.x + room.def.panelX, ty: room.y - 1, room: room.id,
        spot: { tx: room.x + room.def.panelX, ty: room.y }, broken: false, leaking: false,
        isGravity: room.id === 'puente', patched: false, sparkT: 0, leakT: 0, graceT: 0, frozenT: 0,
      };
      room.panel = panel;
      this.fixtures.push(panel);
      if (room.def.pipeX !== undefined) {
        const pipe: Fixture = {
          id: this.nextId++, kind: 'pipe', tx: room.x + room.def.pipeX, ty: room.y - 1, room: room.id,
          spot: { tx: room.x + room.def.pipeX, ty: room.y }, broken: false, leaking: false,
          isGravity: false, patched: false, sparkT: 0, leakT: 0, graceT: 0, frozenT: 0,
        };
        room.pipe = pipe;
        this.fixtures.push(pipe);
      }
    }
    // pasillo: estación del conserje, vertedero, máquina expendedora y rejillas
    this.addProp('station', 12, 12, 'pasillo');
    this.addProp('station', 45, 12, 'pasillo');
    this.addProp('chute', 60, 12, 'pasillo');
    this.addProp('chute', 2, 14, 'pasillo');
    this.addProp('vending', 30, 12, 'pasillo');
    this.addProp('vent', 18, 14, 'pasillo');
    this.addProp('vent', 34, 13, 'pasillo');
    this.addProp('vent', 50, 14, 'pasillo');
    this.addProp('plant', 2, 12, 'pasillo');
    this.addProp('plant', 59, 12, 'pasillo');
    if (this.opts.secretLocker) this.addProp('secretLocker', 27, 12, 'pasillo');
    this.spawn = { tx: 12, ty: 13 };

    // casillas de suelo y puntos de actividad
    for (const room of this.rooms) {
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (this.isWalkable(x, y) && this.tile(x, y) === Tile.Floor) room.floorTiles.push({ tx: x, ty: y });
        }
      }
    }
    const reach = this.reachable(this.spawn.tx, this.spawn.ty);
    for (const p of this.props) {
      const seen = new Set<number>();
      const add = (tx: number, ty: number, face: Facing) => {
        const i = this.idx(tx, ty);
        if (seen.has(i) || !reach[i] || this.tile(tx, ty) !== Tile.Floor || !this.isWalkable(tx, ty)) return;
        if (this.roomAt[i] !== p.room) return;
        seen.add(i);
        p.spots.push({ tx, ty, face, prop: p, taken: null });
      };
      if (!p.blocks) {
        add(p.tx, p.ty, 'down');
        continue;
      }
      for (let x = p.tx; x < p.tx + p.w; x++) { add(x, p.ty + p.h, 'up'); add(x, p.ty - 1, 'down'); }
      for (let y = p.ty; y < p.ty + p.h; y++) { add(p.tx - 1, y, 'right'); add(p.tx + p.w, y, 'left'); }
    }
    for (const room of this.rooms) room.floorTiles = room.floorTiles.filter((t) => reach[this.idx(t.tx, t.ty)]);
  }

  reachable(sx: number, sy: number): Uint8Array {
    const seen = new Uint8Array(MAP_W * MAP_H);
    const q: number[] = [this.idx(sx, sy)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni]) continue;
        const t = this.tiles[ni];
        if ((t === Tile.Floor && !this.propAt[ni]) || t === Tile.Door) {
          seen[ni] = 1;
          q.push(ni);
        }
      }
    }
    return seen;
  }

  propsOf(kind: PropKind, room?: RoomId): Prop[] {
    return this.props.filter((p) => p.kind === kind && (!room || p.room === room));
  }

  randomFloor(rng: Rng, room: RoomId): { tx: number; ty: number } {
    const r = this.room(room);
    return rng.pick(r.floorTiles);
  }

  /** Casillas de pared frontal (cara visible) aptas para una brecha. */
  wallFaceTiles(room: RoomId): { tx: number; ty: number }[] {
    const r = this.room(room);
    const out: { tx: number; ty: number }[] = [];
    const y = r.y - 1;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (this.tile(x, y) !== Tile.Wall) continue;
      if (this.fixtures.some((f) => f.tx === x && f.ty === y)) continue;
      if (!this.isWalkable(x, y + 1)) continue;
      out.push({ tx: x, ty: y });
    }
    return out;
  }
}
