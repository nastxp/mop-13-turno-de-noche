import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { HD } from '../gfx/sprites';
import { CLORO } from '../data/lines';
import { saves } from './SaveManager';
import type { Dirt } from './ContaminationSystem';
import type { Prop } from '../world/ShipMap';
import type { GameScene } from '../scenes/GameScene';

export const NOTES = [
  'Nota de MOP-1, n.º 1: «Si lees esto, has heredado mi fregona. Cuídala. Ella te cuidará a ti. A veces.»',
  'Nota de MOP-1, n.º 2: «CL-0R0 no es un robot de supervisión. Es una aspiradora con ambición.»',
  'Nota de MOP-1, n.º 3: «La Mancha Eterna no es suciedad. Es una puerta. No la friegues de noche.»',
  'Nota de MOP-1, n.º 4: «El inodoro del fondo habla. No le cuentes tus secretos: los tira.»',
  'Nota de MOP-1, n.º 5: «Escondí la Superfregona en una taquilla dorada. Solo aparece cuando la nave lo decide.»',
  'Nota de MOP-1, n.º 6: «El Proyecto Desastre necesita suciedad para funcionar. Por eso nunca terminamos de limpiar.»',
];

interface Sock { x: number; y: number; sprite: Phaser.GameObjects.Image }

/** Secretos: notas del conserje legendario, calcetines de R-0B, el inodoro profético, la Mancha Eterna, la taquilla dorada y la conspiración. */
export class SecretsSystem {
  socks: Sock[] = [];
  prophetToilet: Prop | null = null;
  private prophetGlow: Phaser.GameObjects.Image | null = null;
  eternal: { x: number; y: number; t: number } | null = null;
  private eternalDirt: Dirt | null = null;
  private sockDropped = false;
  private conspiracyAt = -1;
  noteIndex = -1;
  usedProphecy = false;

  constructor(private w: GameScene) {}

  setup() {
    const w = this.w;
    const s = saves.data.secrets;
    if (w.attract) return;
    // nota oculta bajo una mancha grande
    if (w.rng.chance(0.4) && s.notes.length < NOTES.length) {
      const big = w.dirt.list.filter((d) => d.room && d.room !== 'pasillo' && d.amount > 0.6);
      if (big.length) { const d = w.rng.pick(big); d.secret = true; this.noteIndex = NOTES.findIndex((_, i) => !s.notes.includes(i)); }
    }
    // inodoro profético
    if (w.rng.chance(0.35)) {
      const toilets = w.map.props.filter((p) => p.kind === 'toilet');
      if (toilets.length) {
        this.prophetToilet = w.rng.pick(toilets);
        const p = this.prophetToilet;
        this.prophetGlow = w.add.image(p.tx * TILE + 8, p.ty * TILE + 6, 'fx_glow').setTint(0xc080ff).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setScale(0.6).setAlpha(0.5);
      }
    }
    // la Mancha Eterna
    if (w.rng.chance(0.3)) {
      const rooms = w.map.rooms.filter((r) => r.id !== 'pasillo');
      const r = w.rng.pick(rooms);
      const t = w.rng.pick(r.floorTiles);
      this.eternal = { x: t.tx * TILE + 8, y: t.ty * TILE + 10, t: 0 };
      this.eternalDirt = w.dirt.add('eterna', this.eternal.x, this.eternal.y, 0.9, { merge: false });
    }
    if (w.rng.chance(0.15)) this.conspiracyAt = w.rng.range(90, 300);
  }

  dropSock(x: number, y: number) {
    if (this.sockDropped || this.w.attract) return;
    this.sockDropped = true;
    const sprite = this.w.add.image(x, y, 'fx_sock').setScale(HD).setDepth(sortDepth(y));
    this.socks.push({ x, y, sprite });
  }

  sockNear(x: number, y: number): Sock | null {
    return this.socks.find((s) => Math.hypot(s.x - x, s.y - y) < 16) ?? null;
  }

  takeSock(s: Sock) {
    const i = this.socks.indexOf(s);
    if (i >= 0) this.socks.splice(i, 1);
    s.sprite.destroy();
    saves.data.secrets.socks++;
    saves.save();
    this.w.announce('sock', { n: saves.data.secrets.socks });
    audio.sfx('coin');
    this.w.stats.secretsFound++;
  }

  /** el inodoro profético revela (y programa) el próximo suceso */
  consultProphecy() {
    if (this.usedProphecy) return;
    this.usedProphecy = true;
    const name = this.w.director.prophesy();
    this.w.announce('prophecy', { event: name ?? 'Nada. El inodoro solo gorgotea.' });
    saves.data.secrets.prophecies++;
    saves.save();
    this.prophetGlow?.setAlpha(0.15);
    this.w.stats.secretsFound++;
    audio.sfx('flush');
  }

  onDirtRemoved(d: Dirt) {
    const w = this.w;
    if (d.secret && this.noteIndex >= 0) {
      const s = saves.data.secrets;
      if (!s.notes.includes(this.noteIndex)) s.notes.push(this.noteIndex);
      saves.save();
      w.announce('secretNote');
      w.ui.toast(NOTES[this.noteIndex], 'secret');
      w.stats.secretsFound++;
      audio.sfx('clean');
      bus.emit('secret:note', this.noteIndex);
    }
    if (d === this.eternalDirt && this.eternal) {
      saves.data.secrets.eternalCleans++;
      saves.save();
      this.eternal.t = 0;
      this.eternalDirt = null;
      bus.emit('secret:eternal', saves.data.secrets.eternalCleans);
    }
  }

  openLocker(by = this.w.player) {
    const w = this.w;
    if (by.hasSuper) return;
    by.hasSuper = true;
    by.unlockTool('superfregona');
    w.announce('secretLocker');
    w.stats.secretsFound++;
    saves.data.secrets.lockers++;
    saves.save();
    audio.sfx('capture');
  }

  update(dt: number) {
    const w = this.w;
    if (this.eternal && !this.eternalDirt) {
      this.eternal.t += dt;
      if (this.eternal.t > 20) {
        this.eternalDirt = w.dirt.add('eterna', this.eternal.x, this.eternal.y, 0.7, { merge: false });
        w.announce('eternal');
      }
    }
    if (this.conspiracyAt > 0 && w.t > this.conspiracyAt) {
      this.conspiracyAt = -1;
      const i = Math.floor(Math.random() * CLORO.conspiracy.length);
      w.ui.message(CLORO.conspiracy[i], 3);
      const s = saves.data.secrets;
      if (!s.conspiracy.includes(i)) s.conspiracy.push(i);
      saves.save();
      w.stats.secretsFound++;
    }
    if (this.prophetGlow && !this.usedProphecy) this.prophetGlow.setAlpha(0.35 + Math.sin(w.t * 3) * 0.15);
  }

  destroyAll() {
    for (const s of this.socks) s.sprite.destroy();
    this.socks = [];
    this.prophetGlow?.destroy();
  }
}
