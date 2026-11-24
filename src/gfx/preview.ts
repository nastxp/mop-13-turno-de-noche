/**
 * Banco de pruebas gráfico (solo desarrollo): /gfx-preview.html?room=comedor&z=4
 * Genera todas las texturas y monta la nave sin la lógica del juego.
 */
import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE, WORLD_H, WORLD_W } from '../config';
import { Rng, seedFromString } from '../core/Rng';
import { ShipMap } from '../world/ShipMap';
import { drawShipCanvas, layoutDecor, makePlanet, makeSpaceBackground, ROOM_TINT } from './tiles';
import { generateAllTextures, HD, propTextureKey } from './sprites';
import { PROP_DEFS } from '../data/rooms';
import { ARCHETYPES } from '../data/crew';
import type { RoomId } from '../types';

const q = new URLSearchParams(location.search);

class Preview extends Phaser.Scene {
  constructor() { super('Preview'); }

  create() {
    const t0 = performance.now();
    generateAllTextures(this);
    const t1 = performance.now();
    const seed = seedFromString(q.get('seed') ?? 'PREVIEW');
    const map = new ShipMap(new Rng(seed), { secretLocker: true });
    const decor = layoutDecor(map, seed);
    this.textures.addCanvas('bg_space', makeSpaceBackground(1337));
    this.textures.addCanvas('bg_planet', makePlanet());
    this.textures.addCanvas('shipmap', drawShipCanvas(map, seed, decor));
    const t2 = performance.now();
    this.add.tileSprite(-420, -320, WORLD_W + 840, WORLD_H + 640, 'bg_space').setOrigin(0).setScrollFactor(0.25).setDepth(-20).setTileScale(HD, HD);
    this.add.image(WORLD_W - 40, -36, 'bg_planet').setScrollFactor(0.12).setDepth(-19).setScale(HD);
    this.add.image(0, 0, 'shipmap').setOrigin(0).setDepth(DEPTH.floor).setScale(HD);
    for (const p of map.props) {
      const d = PROP_DEFS[p.kind];
      const s = this.add.sprite(p.tx * TILE, (p.ty + p.h) * TILE, propTextureKey(p.kind, p.variant), 0).setOrigin(0, 1).setScale(HD);
      s.setDepth(d.floorLevel ? DEPTH.floorProp : sortDepth((p.ty + p.h) * TILE - 2));
    }
    for (const f of map.fixtures) this.add.sprite(f.tx * TILE + 8, f.ty * TILE + 8, f.kind === 'panel' ? 'fix_panel' : 'fix_pipe', f.kind === 'panel' ? (f.isGravity ? 2 : 0) : 0).setDepth(DEPTH.wallFix).setScale(HD);
    for (const d of map.doors) d.tiles.forEach((t, i) => {
      const s = this.add.sprite(t.tx * TILE, t.ty * TILE, d.orient === 'h' ? 'door_h' : 'door_v', 0).setOrigin(0).setDepth(DEPTH.wallFix).setScale(HD);
      if (d.orient === 'h' && i === 1) s.setFlipX(true);
    });
    const roomId = (q.get('room') ?? 'comedor') as RoomId;
    const room = map.room(roomId);
    // tripulación y bichos de muestra
    const profs = Object.keys(ARCHETYPES);
    room.floorTiles.slice(0, 40).forEach((t, i) => {
      if (i % 5 !== 0) return;
      const prof = profs[(i / 5) % profs.length];
      const c = map.tileCenter(t.tx, t.ty);
      this.add.ellipse(c.x, c.y, 10, 4, 0x000000, 0.35).setDepth(DEPTH.dirt + 0.9);
      this.add.sprite(c.x, c.y + 1, `char_${prof}`, (i * 3) % 30).setOrigin(0.5, 1).setScale(HD).setDepth(sortDepth(c.y));
    });
    const t = room.floorTiles[Math.floor(room.floorTiles.length / 2)];
    const c = map.tileCenter(t.tx, t.ty);
    this.add.sprite(c.x, c.y + 1, 'char_player', 0).setOrigin(0.5, 1).setScale(HD).setDepth(sortDepth(c.y));
    let k = 0;
    for (const sp of ['glorp', 'invasor', 'rata', 'babosa', 'rogue', 'insecto']) {
      const tt = room.floorTiles[(k++ * 7 + 13) % room.floorTiles.length];
      const cc = map.tileCenter(tt.tx, tt.ty);
      this.add.sprite(cc.x, cc.y, sp, 0).setOrigin(0.5, 0.9).setScale(HD).setDepth(sortDepth(cc.y));
    }
    // penumbra sencilla (sin el sistema de luz real)
    if (q.get('dark') !== '0') {
      const g = this.add.graphics().setDepth(DEPTH.light);
      for (const r of map.rooms) { g.fillStyle(ROOM_TINT[r.id], 0.3); g.fillRect((r.x - 1) * TILE, (r.y - 1) * TILE, (r.w + 2) * TILE, (r.h + 2) * TILE); }
    }
    const cam = this.cameras.main;
    cam.setZoom(Number(q.get('z') ?? 4));
    cam.centerOn((room.x + room.w / 2) * TILE, (room.y + room.h / 2) * TILE);
    cam.setBackgroundColor('#020304');
    const keys = this.input.keyboard!.createCursorKeys();
    this.events.on('update', () => {
      const s = 4 / cam.zoom;
      if (keys.left.isDown) cam.scrollX -= s; if (keys.right.isDown) cam.scrollX += s;
      if (keys.up.isDown) cam.scrollY -= s; if (keys.down.isDown) cam.scrollY += s;
    });
    (window as any).__prev = { texMs: Math.round(t1 - t0), shipMs: Math.round(t2 - t1), scene: this, map };
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#020304', pixelArt: true, roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: Math.max(800, window.innerWidth), height: Math.max(600, window.innerHeight), min: { width: 320, height: 240 } },
  scene: [Preview], banner: false,
});
