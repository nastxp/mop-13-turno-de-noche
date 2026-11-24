import Phaser from 'phaser';
import { MAP_W, TILE } from '../config';
import { seedFromString } from '../core/Rng';
import { HD } from '../gfx/sprites';
import { Raster } from '../gfx/raster';
import { CHAR_FRAMES } from '../gfx/characters';
import { drawShipCanvas } from '../gfx/tiles';
import { ISO_CREATURES, ISO_FX, isoCreatureSheet, isoDoorSheet, isoFixtureSheet, isoFoamCoatSheet, isoFxSheet, isoIceSheet, isoLockSheet, isoTrapSheet, type IsoSheetInfo, type IsoSpriteSpec } from '../gfx/iso';
import { ISO_BAG, ISO_BILLBOARD, ISO_CHAR_FOOT, ISO_CHAR_H, ISO_CHAR_W, ISO_DIRT_CUBE, ISO_TOOL_FRAMES, ISO_WALL, isoBagTexture, isoCharacterSheet, isoDirtSheet, isoPropSheet, isoToolSheet, isoWallBlock, type IsoPropInfo } from '../gfx/iso';
import { RESIDUES, RESIDUE_IDS } from '../data/residues';
import { TOOL_ORDER } from '../data/tools';
import { ARCHETYPES, playerLook, type HatStyle } from '../data/crew';
import { PROP_DEFS, type PropKind } from '../data/rooms';
import { Tile } from '../world/ShipMap';
import { saves } from './SaveManager';
import type { RoomId } from '../types';
import type { GameScene } from '../scenes/GameScene';

type GO = Phaser.GameObjects.Sprite & Phaser.GameObjects.Image;
/** algo con huella rectangular en el suelo (mueble o bloque de muro) */
interface Occluder { go: GO; x0: number; x1: number; y0: number; y1: number; /** altura en pantalla (px de mundo) */ hz: number }
/** algo de pie que se ordena frente a los muebles y muros que tiene pegados */
interface Mover { go: GO; x: number; y: number; d: number; /** alto y medio ancho en pantalla */ h: number; hw: number; att?: any[] }
interface Saved {
  go: GO; x: number; y: number; rot: number; sx: number; sy: number; depth: number;
  key?: string; frame?: string | number; flip?: boolean; ox?: number; oy?: number;
  /** tenía recorte (litera de la vista clásica) */
  crop?: boolean;
}

const ROT = -Math.PI / 4;
/** objetos que se dibujan de pie como figuras recortadas */
const BILLBOARD_KEYS = new Set(['glorp', 'glorp_big', 'invasor', 'babosa', 'rata', 'insecto', 'rogue', 'cleanbot', 'reina', 'rey', 'fx_fire', 'fx_ghost', 'fx_lock', 'fix_panel', 'fix_pipe', 'fix_breach', 'emote', 'fx_cup', 'fx_bag', 'fx_foamcoat', 'fx_icecoat']);
/** criaturas, jefes y efectos con modelo de bloques propio */
const BLOCK_SPECS: Record<string, IsoSpriteSpec> = { ...ISO_CREATURES, ...ISO_FX };
const VARIANTS = (k: PropKind) => (k === 'bed' ? 4 : k === 'locker' ? 3 : k === 'barrel' ? 2 : 1);

/** mundo → pantalla sin escala de cámara: inversa de la proyección isométrica (para colgar adornos de los pies) */
const lift = (dx: number, dy: number) => ({ x: Math.SQRT1_2 * (dx + 2 * dy), y: Math.SQRT1_2 * (2 * dy - dx) });

/**
 * Vista «Bloques isométricos»: proyecta la cámara en isométrico, pone en pie los objetos verticales
 * (solo mientras se dibuja, sin tocar la lógica), sustituye personajes y muebles por su versión
 * de bloques y levanta los muros biomecánicos como bloques.
 */
export class IsoView {
  private saved: Saved[] = [];
  /** residuos que se ven como cubitos de pie (el resto, charco plano pixelado) */
  private uprightDirt = new Set<string>();
  /** sprites de suciedad plana ya convertidos (el cambio es permanente) */
  private flatDone = new WeakSet<object>();
  /** punto del suelo del que sale cada fantasma (sube en vertical en pantalla) */
  private ghostBase = new WeakMap<object, { x: number; y: number }>();
  private propInfo = new Map<string, IsoPropInfo>();
  /** hojas de bloques encuadradas automáticamente (puertas, paneles, candado, trampa) */
  private blockInfo = new Map<string, IsoSheetInfo>();
  /** cada hoja de puerta: orientación, hacia qué lado se recoge y centro de su casilla */
  private doorEnd = new Map<object, { orient: 'h' | 'v'; end: 'a' | 'b'; cx: number; cy: number }>();
  private walls: Phaser.GameObjects.Image[] = [];
  /** bloques de hielo para tripulantes congelados (solo existen en esta vista) */
  private icePool: Phaser.GameObjects.Image[] = [];
  /** bloque de muro por casilla (para ordenarlo frente a quien está pegado a él) */
  private wallAt = new Map<number, Phaser.GameObjects.Image>();
  private wallTall = new Set<number>();
  private hiddenBg: Phaser.GameObjects.GameObject[] = [];
  private inv = new Phaser.GameObjects.Components.TransformMatrix();
  private origPreRender: () => void;

  constructor(private w: GameScene) {
    const t0 = performance.now();
    this.ensureTextures();
    (window as any).__isoGenMs = Math.round(performance.now() - t0);
    this.buildFloor();
    this.buildWalls();
    for (const go of w.children.list as any[]) {
      const k = go.texture?.key;
      if (k === 'bg_space' || k === 'bg_planet') { go.setVisible(false); this.hiddenBg.push(go); }
    }
    const cam = w.cameras.main;
    cam.setBackgroundColor('#05070a');
    cam.removeBounds();
    cam.setRoundPixels(false);
    this.origPreRender = cam.preRender.bind(cam);
    cam.preRender = () => this.preRender();
    w.events.on(Phaser.Scenes.Events.POST_UPDATE, this.apply, this);
    w.events.on(Phaser.Scenes.Events.RENDER, this.restore, this);
    w.scale.on('resize', this.filters, this);
    this.filters();
  }

  // ───────────── texturas ─────────────

  private addFrames(key: string, canvas: HTMLCanvasElement, count: number) {
    const tex = this.w.textures;
    if (tex.exists(key)) tex.remove(key);
    const t = tex.addCanvas(key, canvas)!;
    const fw = canvas.width / count;
    for (let i = 0; i < count; i++) t.add(i, 0, Math.round(i * fw), 0, Math.round(fw), canvas.height);
  }

  private ensureChar(key: string): string | null {
    const isoKey = `iso_${key}`;
    if (this.w.textures.exists(isoKey)) return isoKey;
    let look = null;
    if (key === 'char_player') look = playerLook(saves.data.look.uniform, saves.data.look.hat);
    else if (key.startsWith('char_net_')) { const p = key.split('_'); look = playerLook(p[3], p.slice(4).join('_') as HatStyle); }
    else { const a = (ARCHETYPES as any)[key.slice(5)]; look = a?.look ?? null; }
    if (!look) return null;
    this.addFrames(isoKey, isoCharacterSheet(look), 3 * CHAR_FRAMES);
    return isoKey;
  }

  private ensureTextures() {
    const tex = this.w.textures;
    for (const t of TOOL_ORDER) if (!tex.exists(`iso_tool_${t}`)) this.addFrames(`iso_tool_${t}`, isoToolSheet(t), 3 * ISO_TOOL_FRAMES);
    for (const id of RESIDUE_IDS) {
      const key = `iso_dirt_${id}`;
      const { canvas, upright } = isoDirtSheet(RESIDUES[id]);
      if (upright) this.uprightDirt.add(`dirt_${id}`);
      if (!tex.exists(key)) this.addFrames(key, canvas, 3);
    }
    for (const [key, sp] of Object.entries(ISO_CREATURES)) if (!tex.exists(`iso_${key}`)) this.addFrames(`iso_${key}`, isoCreatureSheet(key)!, sp.frames);
    for (const [key, sp] of Object.entries(ISO_FX)) if (!tex.exists(`iso_${key}`)) this.addFrames(`iso_${key}`, isoFxSheet(key)!, sp.frames);
    const block = (key: string, make: () => { canvas: HTMLCanvasElement; info: IsoSheetInfo }) => {
      const cached = (tex as any).__isoInfo?.[key] as IsoSheetInfo | undefined;
      if (cached && tex.exists(key)) { this.blockInfo.set(key, cached); return; }
      const { canvas, info } = make();
      this.addFrames(key, canvas, info.frames);
      this.blockInfo.set(key, info);
      ((tex as any).__isoInfo ??= {})[key] = info;
    };
    for (const o of ['h', 'v'] as const) for (const e of ['a', 'b'] as const) block(`iso_door_${o}_${e}`, () => isoDoorSheet(o, e));
    for (const k of ['fix_panel', 'fix_pipe', 'fix_breach'] as const) block(`iso_${k}`, () => isoFixtureSheet(k));
    block('iso_fx_lock', isoLockSheet);
    block('iso_fx_icecoat', () => isoIceSheet('creature'));
    block('iso_fx_foamcoat', isoFoamCoatSheet);
    block('iso_ice_crew', () => isoIceSheet('crew'));
    block('iso_fx_trap', isoTrapSheet);
    if (!tex.exists('iso_fx_bag')) this.addFrames('iso_fx_bag', isoBagTexture('bag'), 1);
    if (!tex.exists('iso_fx_bodybag')) this.addFrames('iso_fx_bodybag', isoBagTexture('body'), 1);
    this.ensureChar('char_player');
    for (const id of Object.keys(ARCHETYPES)) this.ensureChar(`char_${id}`);
    for (const kind of Object.keys(PROP_DEFS) as PropKind[]) {
      if (ISO_BILLBOARD.has(kind) || PROP_DEFS[kind].floorLevel) continue;
      for (let v = 0; v < VARIANTS(kind); v++) {
        const key = VARIANTS(kind) > 1 ? `prop_${kind}_${v}` : `prop_${kind}`;
        const isoKey = `iso_${key}`;
        const cached = (tex as any).__isoInfo?.[isoKey] as IsoPropInfo | undefined;
        if (cached && tex.exists(isoKey)) { this.propInfo.set(key, cached); continue; }
        const { canvas, info } = isoPropSheet(kind, v);
        this.addFrames(isoKey, canvas, info.frames);
        this.propInfo.set(key, info);
        ((tex as any).__isoInfo ??= {})[isoKey] = info;
      }
    }
  }

  private buildFloor() {
    const w = this.w;
    const key = 'shipmap_iso';
    if (w.textures.exists(key)) w.textures.remove(key);
    w.textures.addCanvas(key, drawShipCanvas(w.map, seedFromString(w.cfg.seed), w.decor, { iso: true }));
    for (const go of w.children.list as any[]) if (go.texture?.key === 'shipmap') go.setTexture(key);
  }

  private buildWalls() {
    const w = this.w, m = w.map;
    const tex = w.textures;
    const made = new Map<string, { ox: number; oy: number; fw: number; fh: number }>();
    const wallKey = (tall: boolean, room: RoomId | null) => {
      const accent = room ? m.room(room).accent : '#ffb040';
      const key = `iso_wall_${tall ? 'tall' : 'low'}_${room ?? 'x'}`;
      if (!made.has(key)) {
        const info = (tex as any).__isoInfo?.[key];
        if (info && tex.exists(key)) made.set(key, info);
        else {
          const b = isoWallBlock(tall ? ISO_WALL.tall : ISO_WALL.low, accent);
          if (tex.exists(key)) tex.remove(key);
          tex.addCanvas(key, b.canvas);
          const inf = { ox: b.ox, oy: b.oy, fw: b.canvas.width, fh: b.canvas.height };
          made.set(key, inf);
          ((tex as any).__isoInfo ??= {})[key] = inf;
        }
      }
      return { key, info: made.get(key)! };
    };
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      if (m.tile(tx, ty) !== Tile.Wall) continue;
      const voidAt = (a: number, b: number) => !m.inb(a, b) || m.tile(a, b) === Tile.Void;
      // muros traseros (norte y oeste) altos; el resto bajos para ver el interior
      const tall = voidAt(tx, ty - 1) || voidAt(tx - 1, ty);
      const room = m.roomAt[m.idx(tx, Math.min(m.h - 1, ty + 1))] ?? m.roomAt[m.idx(Math.min(m.w - 1, tx + 1), ty)] ?? m.roomAt[m.idx(tx, Math.max(0, ty - 1))] ?? null;
      const { key, info } = wallKey(tall, room);
      const cx = tx * TILE + 8, cy = ty * TILE + 8;
      const img = w.add.image(cx, cy, key)
        .setRotation(ROT).setScale(HD, HD * 2).setDepth(10 + (cx + cy + 14) / 200);
      // el lienzo está a densidad nativa (Raster.SCALE texeles por unidad de diseño)
      img.setOrigin((info.ox * Raster.SCALE) / info.fw, (info.oy * Raster.SCALE) / info.fh);
      this.walls.push(img);
      this.wallAt.set(m.idx(tx, ty), img);
      if (tall) this.wallTall.add(m.idx(tx, ty));
    }
  }

  /** zoom propio (múltiplo de 1/HD para que los bloques sean nítidos) y suelo suavizado al girar */
  private filters() {
    const h = this.w.scale.height;
    this.w.cameras.main.setZoom(h < 560 ? 2 : h < 1500 ? 4 : 8);
    const L = Phaser.Textures.FilterMode.LINEAR;
    const tex = this.w.textures;
    if (tex.exists('shipmap_iso')) tex.get('shipmap_iso').setFilter(L);
    tex.each((t: Phaser.Textures.Texture) => { if (t.key.startsWith('dirt_') || t.key === 'fx_wet' || t.key.startsWith('door_')) t.setFilter(L); }, this);
  }

  // ───────────── cámara ─────────────

  private preRender() {
    const cam = this.w.cameras.main;
    this.origPreRender();
    const m = (cam as any).matrix as Phaser.GameObjects.Components.TransformMatrix;
    const ox = cam.width * cam.originX, oy = cam.height * cam.originY;
    const sh = cam.shakeEffect as any;
    const sx = sh.isRunning ? sh._offsetX ?? 0 : 0, sy = sh.isRunning ? sh._offsetY ?? 0 : 0;
    m.loadIdentity();
    m.translate(cam.x + ox + sx, cam.y + oy + sy);
    m.scale(cam.zoom, cam.zoom);
    m.scale(1, 0.5);
    m.rotate(Math.PI / 4);
    m.translate(-ox, -oy);
  }

  worldToScreen(x: number, y: number) {
    const cam = this.w.cameras.main;
    const p = ((cam as any).matrix as Phaser.GameObjects.Components.TransformMatrix).transformPoint(x - cam.scrollX, y - cam.scrollY, { x: 0, y: 0 });
    return { x: p.x, y: p.y };
  }

  screenToWorld(px: number, py: number) {
    const cam = this.w.cameras.main;
    this.inv.copyFrom((cam as any).matrix);
    this.inv.invert();
    const p = this.inv.transformPoint(px, py, { x: 0, y: 0 });
    return { x: p.x + cam.scrollX, y: p.y + cam.scrollY };
  }

  /** controles relativos a la pantalla: arriba = noreste del mundo, derecha = sureste */
  static remap(ix: number, iy: number) { return { x: ix + iy, y: iy - ix }; }

  // ───────────── pasada «de pie» ─────────────

  private save(go: GO): Saved {
    const s: Saved = { go, x: go.x, y: go.y, rot: go.rotation, sx: go.scaleX, sy: go.scaleY, depth: go.depth };
    this.saved.push(s);
    return s;
  }

  private stand(go: GO, fx: number, fy: number, depthBias = 0) {
    go.setRotation(ROT);
    go.setScale(go.scaleX, go.scaleY * 2);
    go.setDepth(10 + (fx + fy) / 200 + depthBias);
  }

  private apply() {
    this.saved.length = 0;
    const w = this.w;
    // adornos colgados de los actores (emoticono, herramienta, bolsa, taza)
    const anchors = new Map<object, { x: number; y: number; down?: boolean; sleep?: boolean; d?: number }>();
    const sleepers = new Set<any>();
    const props: Occluder[] = [];
    const movers: Mover[] = [];
    const toolOwner = new Map<object, any>();
    const mover = new Map<object, { vx: number; vy: number }>();
    const actorOf = new Map<object, any>();
    for (const c of w.creatures as any[]) if (c?.sprite) mover.set(c.sprite, c);
    const actors: any[] = [...((w as any).players ?? [w.player]), ...w.crew, ...w.creatures];
    for (const a of actors) {
      if (!a || !a.sprite) continue;
      actorOf.set(a.sprite, a);
      const f = { x: a.x, y: a.y };
      const bed = a.sprite.isCropped ? a.spot?.prop : null;
      if (bed) {
        // dormido: el «zzz» sale de la almohada y se dibuja por encima de la litera
        const front = bed.tx * TILE + bed.w * TILE + (bed.ty + bed.h) * TILE - 2;
        anchors.set(a.emote, { x: (bed.tx + bed.w / 2) * TILE, y: (bed.ty + bed.h / 2) * TILE - bed.h * 8 + 5, sleep: true, d: 10 + front / 200 + 0.006 });
      } else anchors.set(a.emote, { ...f, down: !!(a.isDown || a.ko || a.dead) });
      if (a.toolSprite) toolOwner.set(a.toolSprite, a);
      if (a.bagSprite) anchors.set(a.bagSprite, f);
      if (a.cup) anchors.set(a.cup, f);
    }
    for (const obj of w.children.list as any[]) {
      const go = obj as GO;
      if (!go.visible || !go.texture) continue;
      const key = go.texture.key;
      if (key.startsWith('iso_') || key.startsWith('shipmap')) continue;
      // herramienta en la mano: modelo de bloques según hacia dónde mira y si se está usando
      const owner = toolOwner.get(go);
      if (owner) {
        const isoKey = `iso_tool_${owner.tool}`;
        if (!w.textures.exists(isoKey)) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.flip = go.flipX; s.ox = go.originX; s.oy = go.originY;
        const fc = owner.facing as string;
        const row = fc === 'up' || fc === 'left' ? 1 : 0;
        const col = owner.using ? 1 + (Math.floor(owner.animT * 9) % 4) : 0;
        go.setTexture(isoKey, row * ISO_TOOL_FRAMES + col);
        go.setFlipX(fc === 'right' || fc === 'left');
        go.setOrigin(ISO_CHAR_FOOT.x / ISO_CHAR_W, ISO_CHAR_FOOT.y / ISO_CHAR_H);
        go.setPosition(owner.x, owner.y + 1);
        go.setRotation(ROT).setScale(HD, HD * 2);
        go.setDepth(10 + (owner.x + owner.y) / 200 + (row === 0 ? 0.004 : -0.004));
        continue;
      }
      const anchor = anchors.get(go);
      if (anchor) {
        const s = this.save(go);
        const isBag = key === 'fx_bag' || key === 'fx_bodybag';
        // la bolsa descansa sobre la cabeza de bloques (más baja que en la vista clásica)
        // tumbado, el emoticono (mareo, zzz…) flota sobre el cuerpo, no donde estaría la cabeza de pie
        const off = isBag ? lift(0, -14.5) : anchor.sleep && key === 'emote' ? lift(0, -14) : anchor.down && key === 'emote' ? lift(0, -9) : lift(go.x - anchor.x, go.y - anchor.y);
        if (isBag) {
          s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
          go.setTexture(`iso_${key}`, 0).setOrigin(ISO_BAG.fx / ISO_BAG.w, ISO_BAG.fy / ISO_BAG.h);
        } else if (key === 'fx_cup') {
          const sp = ISO_FX.fx_cup;
          s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
          go.setTexture('iso_fx_cup', 0).setOrigin(sp.fx / sp.w, sp.fy / sp.h);
        }
        go.setPosition(anchor.x + off.x, anchor.y + off.y);
        this.stand(go, anchor.x, anchor.y, 0.003);
        if (anchor.d !== undefined) go.setDepth(anchor.d);
        continue;
      }
      if (key.startsWith('dirt_')) {
        if (!this.uprightDirt.has(key)) {
          // charco pixelado: cambio de textura permanente, sigue plano en el suelo
          if (!this.flatDone.has(go)) { go.setTexture(`iso_${key}`, go.frame.name); this.flatDone.add(go); }
          continue;
        }
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
        go.setTexture(`iso_${key}`, go.frame.name).setOrigin(ISO_DIRT_CUBE.fx / ISO_DIRT_CUBE.w, ISO_DIRT_CUBE.fy / ISO_DIRT_CUBE.h);
        this.stand(go, go.x, go.y, -0.02);
        movers.push({ go, x: go.x, y: go.y, d: go.depth, h: 6, hw: 7 });
        continue;
      }
      if (key === 'fx_bodybag') {
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
        go.setTexture('iso_fx_bodybag', 0).setOrigin(ISO_BAG.fx / ISO_BAG.w, ISO_BAG.fy / ISO_BAG.h);
        this.stand(go, go.x, go.y, -0.01);
        continue;
      }
      if (key.startsWith('char_')) {
        const isoKey = this.ensureChar(key);
        if (!isoKey) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.flip = go.flipX; s.ox = go.originX; s.oy = go.originY;
        go.setOrigin(ISO_CHAR_FOOT.x / ISO_CHAR_W, ISO_CHAR_FOOT.y / ISO_CHAR_H);
        const sleeper = go.isCropped ? actorOf.get(go) : null;
        const bed = sleeper?.spot?.prop;
        if (bed) {
          // dormido: tumbado a lo largo de la litera, cabeza en la almohada, encima del colchón
          s.crop = true;
          go.isCropped = false;
          go.setTexture(isoKey, CHAR_FRAMES + 9).setFlipX(false);
          const cx = (bed.tx + bed.w / 2) * TILE, cy = (bed.ty + bed.h / 2) * TILE;
          const off = lift(0, bed.kind === 'medBed' ? -5.5 : -4);
          go.setPosition(cx + off.x, cy - bed.h * 8 + 9 + off.y);
          const front = bed.tx * TILE + bed.w * TILE + (bed.ty + bed.h) * TILE - 2;
          go.setRotation(ROT).setScale(go.scaleX, go.scaleY * 2).setDepth(10 + front / 200 + 0.003);
          sleepers.add(sleeper);
          continue;
        }
        if (Math.abs(go.angle) >= 45) {
          // tumbado (resbalón, KO o cadáver): figura de bloques echada en el suelo
          go.setTexture(isoKey, 9);
          go.setFlipX(go.angle < 0);
          go.setPosition(go.x, go.y + 2);
          this.stand(go, go.x, go.y, -0.005);
          continue;
        }
        const f0 = Number(go.frame.name) || 0;
        const row = Math.floor(f0 / CHAR_FRAMES), fr = f0 % CHAR_FRAMES;
        let nrow = row, flip = false;
        if (row === 2) { nrow = go.flipX ? 1 : 0; flip = true; }
        go.setTexture(isoKey, nrow * CHAR_FRAMES + fr);
        go.setFlipX(flip);
        this.stand(go, go.x, go.y);
        continue;
      }
      if (key.startsWith('prop_')) {
        const rest = key.slice(5);
        const kind = (rest.match(/^[a-zA-Z]+/)?.[0] ?? rest) as PropKind;
        const def = PROP_DEFS[kind];
        if (!def || def.floorLevel) continue;
        const cx = go.x + def.w * 8, cy = go.y - def.h * 8;
        const s = this.save(go);
        const info = this.propInfo.get(key);
        props.push({ go, x0: cx - def.w * 8, x1: cx + def.w * 8, y0: cy - def.h * 8, y1: cy + def.h * 8, hz: info ? info.h / 2 : 16 });
        s.ox = go.originX; s.oy = go.originY;
        if (info) {
          s.key = key; s.frame = go.frame.name;
          go.setTexture(`iso_${key}`, go.frame.name);
          go.setOrigin((info.ox * 2) / (info.w * 2), (info.oy * 2) / (info.h * 2));
          go.setPosition(cx, cy);
          // orden por la esquina delantera de la huella (la más cercana al espectador), no por el centro
          const front = go.x + def.w * 16 + go.y - 2;
          this.stand(go, front / 2, front / 2);
        } else {
          go.setOrigin(0.5, 1);
          go.setPosition(cx, cy + def.h * 4);
          this.stand(go, cx, cy);
        }
        continue;
      }
      // puertas correderas de bloques (cada hoja se recoge hacia su jamba)
      if (key === 'door_h' || key === 'door_v') {
        if (!this.doorEnd.size) this.indexDoors();
        const de = this.doorEnd.get(go);
        const ik = de ? `iso_door_${de.orient}_${de.end}` : '';
        const inf = this.blockInfo.get(ik);
        if (!de || !inf) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.flip = go.flipX; s.ox = go.originX; s.oy = go.originY;
        go.setTexture(ik, Math.min(3, Number(go.frame.name) || 0)).setFlipX(false).setOrigin(inf.fx / inf.w, inf.fy / inf.h);
        go.setPosition(de.cx, de.cy);
        this.stand(go, de.cx, de.cy);
        props.push({ go, x0: de.cx - 8, x1: de.cx + 8, y0: de.cy - 8, y1: de.cy + 8, hz: 12 });
        continue;
      }
      // paneles eléctricos, tuberías y brechas: colgados de la cara sur del bloque de muro
      if (key === 'fix_panel' || key === 'fix_pipe' || key === 'fix_breach') {
        const inf = this.blockInfo.get(`iso_${key}`);
        if (!inf) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
        const cx = go.x, cy = key === 'fix_breach' ? go.y - 2 : go.y;
        go.setTexture(`iso_${key}`, Math.min(inf.frames - 1, Number(go.frame.name) || 0)).setOrigin(inf.fx / inf.w, inf.fy / inf.h);
        go.setPosition(cx, cy);
        this.stand(go, cx, cy + 16, 0.001);
        props.push({ go, x0: cx - 8, x1: cx + 8, y0: cy - 8, y1: cy + 11, hz: 8 });
        continue;
      }
      // candado de puerta bloqueada: flota sobre la puerta
      if (key === 'fx_lock' || key === 'fx_trap') {
        const ik = `iso_${key}`, inf = this.blockInfo.get(ik);
        if (!inf) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
        go.setTexture(ik, Math.min(inf.frames - 1, Number(go.frame.name) || 0)).setOrigin(inf.fx / inf.w, inf.fy / inf.h);
        if (key === 'fx_lock') {
          const off = lift(0, -9);
          go.setPosition(go.x + off.x, go.y + off.y);
          this.stand(go, s.x, s.y + 12, 0.02);
        } else this.stand(go, go.x, go.y, -0.01);
        continue;
      }
      // criaturas, jefes, fuego, fantasma y partículas del pulverizador: modelo de bloques
      const spec = BLOCK_SPECS[key];
      if (spec && (go.type === 'Sprite' || go.type === 'Image') && w.textures.exists(`iso_${key}`)) {
        if (Math.abs(go.angle) >= 45) continue;
        const s = this.save(go);
        s.key = key; s.frame = go.frame.name; s.flip = go.flipX; s.ox = go.originX; s.oy = go.originY;
        const fi = Math.max(0, Math.min(spec.frames - 1, Number(go.frame.name) || 0));
        go.setTexture(`iso_${key}`, fi).setOrigin(spec.fx / spec.w, spec.fy / spec.h);
        // el modelo mira a +x del mundo (abajo-derecha en pantalla); se voltea si va hacia la izquierda de la pantalla
        const m = mover.get(go);
        if (m) { const sdx = m.vx - m.vy; if (Math.abs(sdx) > 3) go.setFlipX(sdx < 0); }
        if (key === 'fx_ghost') {
          let b = this.ghostBase.get(go);
          if (!b) { b = { x: go.x, y: go.y + 10 }; this.ghostBase.set(go, b); }
          const off = lift(go.x - b.x, go.y - b.y);
          go.setPosition(b.x + off.x, b.y + off.y);
          this.stand(go, b.x, b.y, 0.01);
        } else this.stand(go, go.x, go.y, key === 'fx_fire' ? 0.003 : key.startsWith('fx_') ? 0.004 : 0);
        if (key === 'fx_fire') movers.push({ go, x: go.x, y: go.y, d: go.depth, h: 10, hw: 6 });
        else if (key === 'reina' || key === 'rey') movers.push({ go, x: go.x, y: go.y, d: go.depth, h: 30, hw: 24 });
        continue;
      }
      if (BILLBOARD_KEYS.has(key)) {
        if (Math.abs(go.angle) >= 45) continue;
        const s = this.save(go);
        if (key === 'fx_foamcoat' || key === 'fx_icecoat') {
          // la criatura queda DENTRO de un bloque de hielo translúcido (o bajo un montón de espuma)
          const inf = this.blockInfo.get(`iso_${key}`);
          if (inf) {
            s.key = key; s.frame = go.frame.name; s.ox = go.originX; s.oy = go.originY;
            go.setTexture(`iso_${key}`, 0).setOrigin(inf.fx / inf.w, inf.fy / inf.h);
            go.setPosition(go.x, go.y - 1);
          }
          this.stand(go, go.x, go.y, 0.0045);
          continue;
        }
        if (key.startsWith('fix_')) {
          s.ox = go.originX; s.oy = go.originY;
          go.setOrigin(0.5, 1);
          go.setPosition(go.x, go.y + 9);
          this.stand(go, go.x, go.y, 0.002);
        } else this.stand(go, go.x, go.y);
      }
    }
    // todo lo que está de pie y puede quedar pegado a un mueble o un muro
    for (const a of actors) {
      if (!a?.sprite?.visible || sleepers.has(a)) continue;
      const down = !!(a.isDown || a.ko || a.dead), creature = a.sp !== undefined;
      movers.push({ go: a.sprite, x: a.x, y: a.y, d: a.sprite.depth, h: down ? 8 : creature ? 12 : 22, hw: down ? 12 : 8, att: [a.toolSprite, a.bagSprite, a.emote, a.cup, a.coat] });
    }
    this.placeMovers(props, movers);
    // tripulantes congelados: encerrados en un bloque de hielo
    let ice = 0;
    const info = this.blockInfo.get('iso_ice_crew');
    if (info) for (const c of w.crew as any[]) {
      if (!(c.frozenT > 0) || !c.sprite?.visible || c.sprite.isCropped) continue;
      let img = this.icePool[ice];
      if (!img) { img = w.add.image(0, 0, 'iso_ice_crew', 0); this.icePool.push(img); }
      ice++;
      img.setTexture('iso_ice_crew', 0).setOrigin(info.fx / info.w, info.fy / info.h).setPosition(c.x, c.y + 1)
        .setRotation(ROT).setScale(HD, HD * 2).setDepth(c.sprite.depth + 0.0045).setVisible(true);
    }
  }

  /**
   * Muros y muebles conservan SIEMPRE su orden (por su esquina delantera): así nunca se pisan entre ellos ni
   * parpadean. Lo que se mueve o está de pie se coloca en el hueco correcto: por encima de los bloques que tiene
   * detrás (está al sur o al este de su huella) y por debajo de los que tiene delante, solo si se solapan en pantalla.
   */
  private placeMovers(props: Occluder[], movers: Mover[]) {
    const m = this.w.map;
    const SA = Math.SQRT1_2, SB = Math.SQRT1_2 / 2;
    const grid = new Map<number, Occluder[]>();
    for (const p of props) {
      for (let ty = Math.floor(p.y0 / TILE); ty <= Math.floor((p.y1 - 0.01) / TILE); ty++) for (let tx = Math.floor(p.x0 / TILE); tx <= Math.floor((p.x1 - 0.01) / TILE); tx++) {
        if (!m.inb(tx, ty)) continue;
        const k = m.idx(tx, ty);
        const l = grid.get(k);
        if (l) l.push(p); else grid.set(k, [p]);
      }
    }
    for (const mv of movers) {
      const msx = (mv.x - mv.y) * SA, msy = (mv.x + mv.y) * SB;
      let lb = -Infinity, ub = Infinity;
      const test = (go: GO, x0: number, x1: number, y0: number, y1: number, hz: number) => {
        if (go === mv.go) return;
        // dentro de la huella (sentado en la silla, en la camilla…): se respeta el orden propio
        if (mv.x > x0 + 1 && mv.x < x1 - 1 && mv.y > y0 + 1 && mv.y < y1 - 1) return;
        const ox0 = (x0 - y1) * SA, ox1 = (x1 - y0) * SA, oy0 = (x0 + y0) * SB - hz, oy1 = (x1 + y1) * SB;
        if (ox1 < msx - mv.hw || ox0 > msx + mv.hw || oy1 < msy - mv.h || oy0 > msy + 2) return;
        if (mv.x >= x1 - 1 || mv.y >= y1 - 1) lb = Math.max(lb, go.depth);
        else ub = Math.min(ub, go.depth);
      };
      const tx = Math.floor(mv.x / TILE), ty = Math.floor(mv.y / TILE);
      const seen = new Set<object>();
      for (let y = ty - 3; y <= ty + 2; y++) for (let x = tx - 3; x <= tx + 2; x++) {
        if (!m.inb(x, y)) continue;
        const k = m.idx(x, y);
        const img = this.wallAt.get(k);
        if (img) test(img as GO, x * TILE, (x + 1) * TILE, y * TILE, (y + 1) * TILE, this.wallTall.has(k) ? 36 : 7);
        const l = grid.get(k);
        if (l) for (const p of l) if (!seen.has(p)) { seen.add(p); test(p.go, p.x0, p.x1, p.y0, p.y1, p.hz); }
      }
      if (lb === -Infinity && ub === Infinity) continue;
      let d = mv.d;
      if (lb < ub) d = ub - lb > 0.012 ? Math.min(Math.max(d, lb + 0.006), ub - 0.006) : (lb + ub) / 2;
      else d = ub - 0.006; // conflicto: nunca ver a través de un muro
      if (d === mv.d) continue;
      const dd = d - mv.d;
      mv.go.setDepth(d);
      if (mv.att) for (const at of mv.att) if (at?.visible && at.scene) at.setDepth(at.depth + dd);
    }
  }

  private indexDoors() {
    for (const d of this.w.map.doors as any[]) {
      d.sprites.forEach((sp: object, i: number) => {
        const t = d.tiles[i];
        if (!t) return;
        this.doorEnd.set(sp, { orient: d.orient, end: d.tiles.length > 1 && i === d.tiles.length - 1 ? 'b' : 'a', cx: t.tx * TILE + 8, cy: t.ty * TILE + 8 });
      });
    }
  }

  private restore() {
    for (let i = this.saved.length - 1; i >= 0; i--) {
      const s = this.saved[i], go = s.go;
      if (!go.scene) continue;
      if (s.crop) go.isCropped = true;
      if (s.key !== undefined) go.setTexture(s.key, s.frame);
      if (s.flip !== undefined) go.setFlipX(s.flip);
      if (s.ox !== undefined) go.setOrigin(s.ox, s.oy);
      go.setPosition(s.x, s.y).setRotation(s.rot).setScale(s.sx, s.sy).setDepth(s.depth);
    }
    this.saved.length = 0;
    for (const img of this.icePool) img.setVisible(false);
  }

  destroy() {
    const w = this.w;
    w.events.off(Phaser.Scenes.Events.POST_UPDATE, this.apply, this);
    w.events.off(Phaser.Scenes.Events.RENDER, this.restore, this);
    w.scale.off('resize', this.filters, this);
    for (const img of this.walls) img.destroy();
    this.walls = [];
    for (const img of this.icePool) img.destroy();
    this.icePool = [];
    this.wallAt.clear();
  }
}
