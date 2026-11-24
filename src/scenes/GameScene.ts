import Phaser from 'phaser';
import { DEPTH, sortDepth, TILE, WORLD_H, WORLD_W, SHIFT_START_HOUR, SHIFT_HOURS, SHIFT_SECONDS, DEBUG } from '../config';
import { bus } from '../core/EventBus';
import { Rng, seedFromString, randomSeedString } from '../core/Rng';
import { fmtTime, tpl } from '../core/util';
import { CLORO } from '../data/lines';
import { ROOM_NAMES, PROP_DEFS } from '../data/rooms';
import { RESIDUES, type ResidueId } from '../data/residues';
import type { ProfessionId } from '../data/crew';
import { TOOL_UNLOCK_LEVEL, type SpecId, type UpgradeId } from '../data/upgrades';
import { MISSIONS, STORY, type MissionDef, type MissionRule } from '../data/missions';
import { TOOL_ORDER } from '../data/tools';
import { HD, propTextureKey, genPlayerTexture, refreshPlayerIcon } from '../gfx/sprites';
import { playerLook } from '../data/crew';
import { drawShipCanvas, layoutDecor, makePlanet, makeSpaceBackground, type Decor } from '../gfx/tiles';
import { ShipMap, type Door } from '../world/ShipMap';
import { Navigation } from '../world/Navigation';
import { Player } from '../entities/Player';
import { Crew } from '../entities/Crew';
import { Creature, type SpeciesId } from '../entities/Creature';
import type { Actor } from '../entities/Actor';
import { ShipSystems } from '../systems/ShipSystems';
import { ContaminationSystem, type Dirt } from '../systems/ContaminationSystem';
import { CleaningSystem } from '../systems/CleaningSystem';
import { EmergencySystem, type AlertInfo } from '../systems/EmergencySystem';
import { EventDirector } from '../systems/EventDirector';
import { MissionManager } from '../systems/MissionManager';
import { HumorSystem } from '../systems/HumorSystem';
import { ShiftStats } from '../systems/ShiftStats';
import { Lighting } from '../systems/Lighting';
import { IsoView } from '../systems/IsoView';
import { Fx } from '../systems/Fx';
import { Interaction } from '../systems/Interaction';
import { CombatSystem } from '../systems/CombatSystem';
import { ResponseSystem } from '../systems/ResponseSystem';
import { DiseaseSystem } from '../systems/DiseaseSystem';
import { BossSystem } from '../systems/BossSystem';
import { SecretsSystem } from '../systems/SecretsSystem';
import { audio } from '../systems/AudioManager';
import { saves } from '../systems/SaveManager';
import { buildReport, type EndReason } from '../systems/Evaluation';
import { ui, type HudState } from '../ui/UI';
import { mp } from '../net/Net';
import { HostSync, ClientSync, ensurePeerTexture } from '../net/Sync';
import type { PeerLook } from '../net/Net';
import type { RoomId, ShiftConfig, ToolId } from '../types';

export interface Trap { id: number; x: number; y: number; sprite: Phaser.GameObjects.Sprite; caught: Creature | null }
export interface CleanBot { id: number; x: number; y: number; sprite: Phaser.GameObjects.Sprite; target: Dirt | null; broken: boolean; t: number; vx: number; vy: number }
export interface TouchState { active: boolean; dx: number; dy: number; aimActive: boolean; ax: number; ay: number; run: boolean; use: boolean; interact: boolean }

const EXTRA_PROFS: ProfessionId[] = ['diplomatico', 'paranoico', 'contrabandista'];

/** Escena principal: orquesta mapa, entidades y sistemas del turno. */
export class GameScene extends Phaser.Scene {
  cfg!: ShiftConfig;
  rng!: Rng;
  map!: ShipMap;
  nav!: Navigation;
  ship!: ShipSystems;
  dirt!: ContaminationSystem;
  emerg!: EmergencySystem;
  cleaning!: CleaningSystem;
  director!: EventDirector;
  missions!: MissionManager;
  stats!: ShiftStats;
  humor!: HumorSystem;
  lighting!: Lighting;
  /** vista «Bloques isométricos» (null = clásica) */
  iso: IsoView | null = null;
  fx!: Fx;
  interaction!: Interaction;
  combat!: CombatSystem;
  response!: ResponseSystem;
  disease!: DiseaseSystem;
  bosses!: BossSystem;
  secrets!: SecretsSystem;
  player!: Player;
  crew: Crew[] = [];
  creatures: Creature[] = [];
  inspector: Crew | null = null;
  ui = ui;
  upg: Partial<Record<UpgradeId, number>> = {};
  spec: SpecId | null = null;
  rules = new Set<MissionRule>();
  mission: MissionDef | null = null;
  touch: TouchState = { active: false, dx: 0, dy: 0, aimActive: false, ax: 0, ay: 1, run: false, use: false, interact: false };
  purgedAt = new Map<RoomId, number>();
  memoryFoamResist = false;
  memoryMoldResist = false;
  lastInvasionT = -999;
  traps: Trap[] = [];
  bots: CleanBot[] = [];
  t = 0;
  started = false;
  over = false;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  mouseDown = false;
  spaceUse = false;
  aimWorld = { x: 0, y: 0 };
  favors = 3;
  lastVomitT = -99;
  lieCount = 0;
  decor!: Decor;
  private gadgetId = 1;
  private bossAt = -1;
  private memoryNotes: string[] = [];
  private mouseMovedAt = -99;
  private hudT = 0;
  private cds: Record<string, number> = { foam: 0, purge: 0 };
  private interactLock = false;
  private causedMsgT = -99;
  private artFrame: Phaser.GameObjects.Image | null = null;
  private artWarnT = -99;
  private lampGlows: { img: Phaser.GameObjects.Image; room: RoomId; base: number }[] = [];
  private navGlows: { img: Phaser.GameObjects.Image; phase: number }[] = [];
  private runwayGlows: Phaser.GameObjects.Image[] = [];
  private steamT = 0;
  private panTimer?: Phaser.Time.TimerEvent;
  private tasksFolded = false;
  // ── multijugador ──
  /** solo = un jugador · host = simula la nave para todos · client = invitado que ve la nave del anfitrión */
  netRole: 'solo' | 'host' | 'client' = 'solo';
  /** todos los conserjes (local + remotos/réplicas); w.player es siempre el local */
  players: Player[] = [];
  /** luces dinámicas recibidas del anfitrión (solo en el invitado) */
  extraLights: { x: number; y: number; r: number; s: number }[] = [];
  /** en multijugador los menús no pausan el mundo: solo bloquean la entrada local */
  inputBlocked = false;
  /** pid del conserje cuyo efecto continuo se está generando (para no duplicarlo en su pantalla) */
  fxOwner = 0;
  interactions = new Map<Player, Interaction>();
  hostSync: HostSync | null = null;
  clientSync: ClientSync | null = null;
  /** objetos que nunca se replican (decorado local, suciedad, partículas, conserjes…) */
  nonet = new WeakSet<object>();
  /** ids estables (accesorios, paneles, puertas) que ambos lados crean igual desde la semilla */
  stableIds = new Map<object, string>();
  stableObjs = new Map<string, any>();
  private localDepth = 0;
  private respawns: { p: Player; at: number }[] = [];
  private netInteract = false;

  constructor() { super('Game'); }

  init(data: ShiftConfig) {
    this.cfg = data && data.mode ? data : { mode: 'attract', night: 1, seed: randomSeedString(), difficulty: 0.6, duration: null };
    this.crew = [];
    this.creatures = [];
    this.inspector = null;
    this.traps = [];
    this.bots = [];
    this.t = 0;
    this.started = false;
    this.over = false;
    this.mouseDown = false;
    this.spaceUse = false;
    this.favors = 3;
    this.lastVomitT = -99;
    this.lieCount = 0;
    this.cds = { foam: 0, purge: 0 };
    this.artFrame = null;
    this.purgedAt = new Map();
    this.lastInvasionT = -999;
    this.bossAt = -1;
    this.memoryNotes = [];
    this.tasksFolded = false;
    this.lampGlows = [];
    this.navGlows = [];
    this.runwayGlows = [];
    this.touch = { active: false, dx: 0, dy: 0, aimActive: false, ax: 0, ay: 1, run: false, use: false, interact: false };
    this.netRole = this.cfg.netRole && mp.session?.open ? this.cfg.netRole : 'solo';
    this.players = [];
    this.extraLights = [];
    this.inputBlocked = false;
    this.fxOwner = 0;
    this.interactions = new Map();
    this.hostSync = null;
    this.clientSync = null;
    this.nonet = new WeakSet();
    this.stableIds = new Map();
    this.stableObjs = new Map();
    this.localDepth = 0;
    this.respawns = [];
  }

  /** crea objetos que solo existen en esta pantalla (no se replican a los invitados) */
  netLocal<T>(fn: () => T): T {
    this.localDepth++;
    try { return fn(); } finally { this.localDepth--; }
  }

  private onAdded(go: object) { if (this.localDepth > 0) this.nonet.add(go); }

  private stable(go: object, id: string) { this.stableIds.set(go, id); this.stableObjs.set(id, go); }

  get attract() { return this.cfg.mode === 'attract'; }

  create() {
    bus.clear();
    audio.stopLoops();
    this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded, this);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded, this);
    // el vestuario cambia la textura del conserje entre turnos
    const lookKey = JSON.stringify(saves.data.look);
    if (this.registry.get('lookKey') !== lookKey) {
      genPlayerTexture(this.textures, playerLook(saves.data.look.uniform, saves.data.look.hat));
      refreshPlayerIcon(this.textures);
      ui.refreshIcons();
      this.registry.set('lookKey', lookKey);
    }
    const seedNum = seedFromString(this.cfg.seed);
    this.rng = new Rng(seedNum);
    this.setupRules();
    this.upg = this.attract ? {} : { ...saves.data.upgrades };
    this.spec = this.attract ? null : saves.data.spec;
    this.map = new ShipMap(this.rng, { secretLocker: !this.attract && this.rng.chance(0.3) });
    this.nav = new Navigation(this.map);
    if (this.textures.exists('shipmap')) this.textures.remove('shipmap');
    this.decor = layoutDecor(this.map, seedNum);
    if (!this.textures.exists('bg_space')) this.textures.addCanvas('bg_space', makeSpaceBackground(1337));
    if (!this.textures.exists('bg_planet')) this.textures.addCanvas('bg_planet', makePlanet());
    this.netLocal(() => {
      this.add.tileSprite(-420, -320, WORLD_W + 840, WORLD_H + 640, 'bg_space').setOrigin(0).setScrollFactor(0.25).setDepth(-20).setTileScale(HD, HD);
      this.add.image(WORLD_W - 40, -36, 'bg_planet').setScrollFactor(0.12).setDepth(-19).setScale(HD);
      this.textures.addCanvas('shipmap', drawShipCanvas(this.map, seedNum, this.decor));
      this.add.image(0, 0, 'shipmap').setOrigin(0).setDepth(DEPTH.floor).setScale(HD);
    });

    this.stats = new ShiftStats();
    this.ship = new ShipSystems(this);
    this.fx = this.netLocal(() => new Fx(this));
    this.fx.reduced = saves.data.settings.reduceFx;
    this.dirt = new ContaminationSystem(this);
    this.cleaning = new CleaningSystem(this);
    this.emerg = new EmergencySystem(this);
    this.director = new EventDirector(this);
    this.missions = new MissionManager(this);
    this.humor = new HumorSystem(this);
    this.combat = new CombatSystem(this);
    this.response = new ResponseSystem(this);
    this.disease = new DiseaseSystem(this);
    this.bosses = new BossSystem(this);
    this.secrets = new SecretsSystem(this);

    this.createProps();
    this.createFixtures();
    this.createDoors();
    this.netLocal(() => this.createDecor());

    const client = this.netRole === 'client';
    if (!this.attract && !client) this.applyMemory();
    const session = mp.session;
    const myPid = this.netRole !== 'solo' && session ? session.pid : 0;
    const sp = this.spawnPoint(myPid);
    this.player = this.netLocal(() => new Player(this, sp.x, sp.y, { pid: myPid, name: session?.peers.get(myPid)?.name }));
    this.players = [this.player];
    this.interaction = new Interaction(this, this.player);
    this.interactions.set(this.player, this.interaction);
    if (!client) {
      this.spawnCrew();
      this.seedDirt();
      this.secrets.setup();
    }
    this.lighting = this.netLocal(() => new Lighting(this));
    this.setupCamera();
    this.iso = saves.data.settings.view === 'iso' ? this.netLocal(() => new IsoView(this)) : null;
    ui.labels.project = this.iso ? (x: number, y: number) => this.iso!.worldToScreen(x, y) : null;
    this.setupInput();
    this.setupBus();
    if (this.rules.has('gravedad_cero')) this.ship.gravity = false;

    ui.attach(this);
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    if (this.attract) {
      this.player.active = false;
      this.director.intensity = 0.35;
      this.started = true;
      this.t = 50;
      ui.showHud(false);
      this.attractCamera();
    } else if (client) {
      ui.showHud(false);
      const b = this.cfg.netBrief;
      this.clientSync = new ClientSync(this, session!);
      ui.showBriefing(b?.title ?? this.briefTitle(), b?.memo ?? this.briefMemo(), (b?.tasks ?? []).map((title) => ({ title })) as any, () => this.beginShift());
    } else {
      this.missions.setup();
      const m = this.cfg.mode;
      this.director.intensity = m === 'zen' ? 0.4 : m === 'caos' || this.rules.has('caos') ? 1.7 : 1;
      if (this.mission) this.director.forced = [...this.mission.forced];
      if (this.mission?.boss) this.bossAt = this.mission.boss === 'reina' ? 45 : 70;
      ui.showHud(false);
      ui.showBriefing(this.briefTitle(), this.briefMemo(), this.missions.tasks, () => this.beginShift());
      if (this.netRole === 'host') this.hostSync = new HostSync(this, session!);
    }
    if (DEBUG) (window as any).__scene = this;
  }

  private setupRules() {
    const cfg = this.cfg;
    this.rules = new Set((cfg.rules ?? []) as MissionRule[]);
    this.mission = cfg.mission ? MISSIONS[cfg.mission] ?? null : null;
    if (this.mission) for (const r of this.mission.rules) this.rules.add(r);
    if (cfg.mode === 'zen') this.rules.add('zen');
    if (cfg.mode === 'caos') this.rules.add('caos');
  }

  briefTitle(): string {
    const c = this.cfg;
    if (c.mode === 'historia') return `NOCHE ${c.night} · ${this.mission ? this.mission.name.toUpperCase() : 'TURNO 22:00 – 06:00'}`;
    if (c.mode === 'zen') return 'LIMPIEZA ZEN';
    if (c.mode === 'caos') return 'MODO CAOS';
    if (c.mode === 'desafio') return `DESAFÍO · ${(c.challengeName ?? this.mission?.name ?? '').toUpperCase()}`;
    return 'TURNO INFINITO';
  }

  briefMemo(): string {
    const c = this.cfg;
    let memo: string;
    if (c.mode === 'historia') memo = this.mission?.memo ?? STORY[0].memo!;
    else if (c.mode === 'zen') memo = 'Esta noche no hay emergencias graves. Solo usted, la fregona y el zumbido del soporte vital. Puede fichar la salida desde la pausa cuando quiera.';
    else if (c.mode === 'caos') memo = 'El Director de Caos ha tomado demasiado café. Todo ocurrirá más rápido, más fuerte y más pegajoso. Puede fichar la salida desde la pausa.';
    else if (c.mode === 'desafio') memo = this.mission?.memo ?? (c.challengeDesc ?? 'Reglas especiales en vigor.');
    else memo = 'No hay hora de salida. La nave se volverá cada vez más caótica. Puede fichar la salida desde la pausa cuando quiera cobrar. O cuando ya no quede nave.';
    if (this.spec) memo += ` Especialización activa: ${this.specName()}.`;
    if (this.memoryNotes.length) memo += ` La nave recuerda: ${this.memoryNotes.join(' ')}`;
    return memo;
  }

  private specName() {
    return { sanitario: 'Conserje sanitario', emergencias: 'Técnico de emergencias', plagas: 'Cazador de plagas', antigravedad: 'Especialista antigravedad' }[this.spec!];
  }

  private beginShift() {
    this.started = true;
    if (this.netRole === 'client') {
      // el reloj y los avisos los pone el anfitrión
      audio.init();
      audio.startMusic();
      ui.showHud(true);
      return;
    }
    this.t = 0;
    audio.init();
    audio.startMusic();
    ui.showHud(true);
    if (this.cfg.mode === 'zen') this.announce('zenStart');
    else if (this.mission) this.announce('missionStart', { mission: this.mission.name });
    else this.announce('start');
    if (this.memoryNotes.length) this.time.delayedCall(9000, () => this.announce('memory', { note: this.memoryNotes[0] }));
  }

  // ───────────────────────── memoria de la nave ─────────────────────────

  private applyMemory() {
    const m = saves.data.memory;
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    if (m.foam.length >= 2 && avg(m.foam.slice(-3)) > 260) {
      this.memoryFoamResist = true;
      this.memoryNotes.push('los Glorps se han acostumbrado a su espuma y la toleran el doble.');
    }
    if (m.disinfect.length >= 2 && avg(m.disinfect.slice(-3)) > 240) {
      this.memoryMoldResist = true;
      this.memoryNotes.push('el moho ha desarrollado resistencia al desinfectante.');
    }
    let worst: string | null = null, wv = 101;
    for (const [room, arr] of Object.entries(m.roomClean)) {
      const v = avg(arr.slice(-3));
      if (arr.length >= 2 && v < wv) { wv = v; worst = room; }
    }
    if (worst && wv < 55) this.memoryNotes.push(`${ROOM_NAMES[worst as RoomId]} siempre acaba sucio, y la tripulación ya ni se esfuerza.`);
    (this as any)._memWorst = worst && wv < 55 ? worst : null;
  }

  private saveMemory() {
    const m = saves.data.memory;
    const push = (a: number[], v: number) => { a.push(Math.round(v)); if (a.length > 5) a.shift(); };
    push(m.foam, this.stats.foamUsed);
    push(m.disinfect, this.stats.disinfectUsed);
    for (const r of this.map.rooms) {
      if (r.id === 'pasillo') continue;
      const arr = m.roomClean[r.id] ?? (m.roomClean[r.id] = []);
      push(arr, this.dirt.roomClean(r.id));
    }
  }

  // ───────────────────────── construcción ─────────────────────────

  private createProps() {
    for (const p of this.map.props) {
      const d = PROP_DEFS[p.kind];
      const s = this.add.sprite(p.tx * TILE, (p.ty + p.h) * TILE, propTextureKey(p.kind, p.variant), 0).setOrigin(0, 1).setScale(HD);
      s.setDepth(d.floorLevel ? DEPTH.floorProp : sortDepth((p.ty + p.h) * TILE - 2));
      p.sprite = s;
      this.stable(s, `p${p.id}`);
      if (p.kind === 'bin') {
        p.state.fill = this.rng.chance(0.45) ? 100 : this.rng.int(10, 55);
        this.setFrameSafe(s, p.state.fill >= 100 ? 1 : 0);
      }
      if (p.kind === 'medkit') p.state.charges = 3;
    }
    // animación de consolas, tanques, plantas y aparatos
    let tick = 0;
    this.time.addEvent({ delay: 350, loop: true, callback: () => {
      tick++;
      for (const p of this.map.props) {
        const s = p.sprite;
        if (!s) continue;
        const n = s.texture.frameTotal - 1;
        if (n <= 1) continue;
        switch (p.kind) {
          case 'console': case 'tank': case 'holoTable': case 'medScanner': {
            if (p.state.broken) { this.setFrameSafe(s, n - 1); break; }
            const room = this.map.room(p.room);
            if (room.panel?.broken) { this.setFrameSafe(s, this.rng.chance(0.5) ? 0 : 1); s.setAlpha(this.rng.chance(0.5) ? 0.6 : 1); }
            else { if (tick % 2 === 0) this.setFrameSafe(s, (Number(s.frame.name) + 1) % Math.min(n, 3)); s.setAlpha(1); }
            break;
          }
          case 'gravityGen': this.setFrameSafe(s, this.ship.gravity ? tick % 2 : Math.min(2, n - 1)); break;
          case 'counter': this.setFrameSafe(s, this.crew.some((c) => c.activity?.id === 'cocinar' && c.state === 'act') ? 1 : 0); break;
          case 'vent': this.setFrameSafe(s, this.creatures.some((c) => c.alive && c.hidden) && Math.random() < 0.3 ? 1 : 0); break;
          case 'reactor': if (tick % 2 === 0) this.setFrameSafe(s, this.emerg.overheating ? (tick / 2) % 2 + 1 : 0); break;
          case 'plantBed': if (tick % 4 === 0) this.setFrameSafe(s, (tick / 4) % 2); break;
          case 'medPod': this.setFrameSafe(s, this.combat.corpses.length && tick % 4 < 2 ? 1 : 0); break;
        }
      }
    } });
  }

  private setFrameSafe(s: Phaser.GameObjects.Sprite, f: number) {
    const n = s.texture.frameTotal - 1;
    s.setFrame(Math.max(0, Math.min(n - 1, Math.floor(f))));
  }

  private createFixtures() {
    for (const f of this.map.fixtures) {
      const key = f.kind === 'panel' ? 'fix_panel' : 'fix_pipe';
      f.sprite = this.add.sprite(f.tx * TILE + 8, f.ty * TILE + 8, key, f.kind === 'panel' ? (f.isGravity ? 2 : 0) : 0).setDepth(DEPTH.wallFix).setScale(HD);
      this.stable(f.sprite, `f${f.id}`);
    }
  }

  private createDoors() {
    for (const d of this.map.doors) {
      d.tiles.forEach((t, i) => {
        const s = this.add.sprite(t.tx * TILE, t.ty * TILE, d.orient === 'h' ? 'door_h' : 'door_v', 0).setOrigin(0).setDepth(DEPTH.wallFix).setScale(HD);
        if (d.orient === 'h' && i === 1) s.setFlipX(true);
        d.sprites.push(s);
        this.stable(s, `d${d.id}_${i}`);
      });
      const cx = d.tiles.reduce((a, t) => a + t.tx, 0) / d.tiles.length * TILE + 8;
      const cy = d.tiles.reduce((a, t) => a + t.ty, 0) / d.tiles.length * TILE + 8;
      d.lockIcon = this.add.image(cx, cy, 'fx_lock').setDepth(DEPTH.overlay).setVisible(false).setScale(HD);
      this.stable(d.lockIcon, `dl${d.id}`);
    }
  }

  /** Brillos de lámparas, luces de navegación del casco y balizas del pasillo. */
  private createDecor() {
    const glow = (x: number, y: number, tint: number, scale: number, alpha: number) =>
      this.add.image(x, y, 'fx_glow').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow - 0.5).setScale(scale).setAlpha(alpha);
    for (const l of this.decor.lamps) {
      this.lampGlows.push({ img: glow(l.x, l.y - 4, l.color, 1.3, 0.1), room: l.room, base: 0.1 });
      this.lampGlows.push({ img: glow(l.wx, l.wy + 1, l.color, 0.3, 0.55), room: l.room, base: 0.55 });
    }
    for (const n of this.decor.nav) this.navGlows.push({ img: glow(n.x, n.y, n.color, 0.35, 0.8), phase: n.phase });
    for (const r of this.decor.runway) this.runwayGlows.push(glow(r.x, r.y, 0x4ff0ff, 0.2, 0.3));
  }

  private updateDecor(dt: number) {
    const t = this.t;
    for (const g of this.lampGlows) {
      const room = this.map.room(g.room);
      const light = this.ship.roomLight(g.room);
      let a = g.base * light;
      if (room.panel?.broken) a *= Math.random() < 0.15 ? 1.2 : 0.15;
      g.img.setAlpha(a);
    }
    for (const n of this.navGlows) n.img.setAlpha(Math.sin(t * 2.2 + n.phase) > 0.6 ? 0.95 : 0.12);
    const N = this.runwayGlows.length;
    this.runwayGlows.forEach((img, i) => {
      const k = ((t * 8 - i) % N + N) % N;
      img.setAlpha((k < 1.5 ? 0.85 : 0.18) * (this.ship.power / 100));
    });
    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 1.6 + Math.random() * 2;
      const pipes = this.map.props.filter((p) => p.kind === 'pipes');
      if (pipes.length) { const p = pipes[Math.floor(Math.random() * pipes.length)]; this.fx.steamPuff(p.tx * TILE + 8 + Math.random() * 16, p.ty * TILE - 6); }
    }
  }

  private randomFloor(room?: RoomId) {
    const rooms = room ? [this.map.room(room)] : this.map.rooms.filter((r) => r.floorTiles.length && r.id !== 'pasillo');
    const r = this.rng.pick(rooms);
    const t = this.rng.pick(r.floorTiles);
    return this.map.tileCenter(t.tx, t.ty);
  }

  private spawnCrew() {
    const profs: ProfessionId[] = ['capitan', 'cientifica', 'ingeniero', 'cocinero', 'turista', 'medica', 'robot', 'seguridad'];
    profs.push(this.rng.pick(EXTRA_PROFS));
    if (this.rules.has('invasion')) profs.push('seguridad');
    if (this.rules.has('diplomaticos')) profs.push('diplomatico');
    for (const prof of profs) {
      const c = this.randomFloor();
      this.crew.push(new Crew(this, prof, c.x, c.y));
    }
    if (this.rules.has('banquete') || this.rules.has('diplomaticos')) {
      const guests: ProfessionId[] = this.rules.has('banquete') ? ['turista', 'diplomatico', 'turista'] : ['turista', 'turista'];
      for (const g of guests) {
        const c = this.randomFloor('comedor');
        const guest = new Crew(this, g, c.x, c.y);
        guest.isGuest = true;
        this.crew.push(guest);
      }
    }
    // la tripulación recuerda a quien le ayudó
    if (!this.attract) for (const c of this.crew) c.relation = Math.min(100, c.relation + Math.min(25, (saves.data.memory.helped[c.prof] ?? 0) * 5));
  }

  private seedDirt() {
    const k = this.attract ? 0.6 : Math.min(1.5, 0.8 + 0.1 * (this.cfg.night - 1)) * (this.cfg.mode === 'zen' ? 1.3 : 1);
    for (const r of this.map.rooms) {
      const types = (r.def?.typicalDirt ?? ['polvo', 'huellas', 'polvo']) as ResidueId[];
      let n = Math.round(this.rng.int(3, 6) * k);
      if ((this as any)._memWorst === r.id) n += 4;
      if (r.id === 'comedor' && this.rules.has('banquete')) n += 4;
      for (let i = 0; i < n; i++) {
        const t = this.rng.pick(r.floorTiles);
        this.dirt.add(this.rng.pick(types), t.tx * TILE + this.rng.range(3, 13), t.ty * TILE + this.rng.range(5, 14), this.rng.range(0.4, 1));
      }
    }
    if (this.rules.has('moho')) for (let i = 0; i < 5; i++) { const c = this.randomFloor(); this.dirt.add('moho', c.x, c.y + 3, 0.7); }
    if (this.rules.has('inundacion')) for (let i = 0; i < 4; i++) { const c = this.randomFloor('banos'); this.dirt.add('aguas', c.x, c.y + 3, 0.8); }
  }

  /** Ensucia una sala con sus residuos típicos hasta bajar de cierto % de limpieza. */
  soilRoom(room: RoomId, maxClean: number) {
    const r = this.map.room(room);
    const types = (r.def?.typicalDirt ?? ['polvo', 'huellas']) as ResidueId[];
    for (let i = 0; i < 30 && this.dirt.roomClean(room) > maxClean; i++) {
      const t = this.rng.pick(r.floorTiles);
      this.dirt.add(this.rng.pick(types), t.tx * TILE + this.rng.range(3, 13), t.ty * TILE + this.rng.range(5, 14), this.rng.range(0.6, 1), { merge: false });
      this.dirt.invalidate();
    }
  }

  private setupCamera() {
    const cam = this.cameras.main;
    // margen extra para que MOP-13 quede centrado (y lejos de los paneles) también junto al casco
    cam.setBounds(-112, -80, WORLD_W + 224, WORLD_H + 160);
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#05040c');
    this.applyZoom();
    this.scale.on('resize', this.applyZoom, this);
    if (!this.attract) cam.startFollow(this.player.sprite, true, 0.14, 0.14);
    cam.fadeIn(400, 5, 4, 12);
    // viñeta sutil para dar profundidad (solo WebGL)
    (cam as any).postFX?.addVignette?.(0.5, 0.5, 0.95, 0.28);
  }

  /** Zoom par (2, 4, 6…) para que cada téxel HD ocupe un número entero de píxeles. */
  private applyZoom() {
    const h = this.scale.height;
    const z = Math.max(2, Math.round(h / 290 / 2) * 2);
    this.cameras.main.setZoom(z);
    // con zoom múltiplo de 1/HD cada téxel ocupa píxeles enteros (nítido); si no, se suaviza para no titilar
    const crisp = Math.abs(z * HD - Math.round(z * HD)) < 0.01 && z * HD >= 1;
    const mode = crisp ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR;
    this.textures.each((t: Phaser.Textures.Texture) => { if (!t.key.startsWith('__') && !t.key.startsWith('fx_light')) t.setFilter(mode); }, this);
  }

  private attractCamera() {
    const cam = this.cameras.main;
    const go = () => {
      const r = this.rng.pick(this.map.rooms);
      cam.pan((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE, 6000, 'Sine.easeInOut');
    };
    cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    go();
    this.panTimer = this.time.addEvent({ delay: 6500, loop: true, callback: go });
  }

  private setupInput() {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,SHIFT,Q,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.addCapture([Phaser.Input.Keyboard.KeyCodes.SPACE, Phaser.Input.Keyboard.KeyCodes.UP, Phaser.Input.Keyboard.KeyCodes.DOWN, Phaser.Input.Keyboard.KeyCodes.LEFT, Phaser.Input.Keyboard.KeyCodes.RIGHT]);
    const can = () => this.started && !this.over && !this.attract && !ui.modal;
    kb.on('keydown-Q', () => { if (can()) this.player.cycleTool(); });
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((k, i) => kb.on(`keydown-${k}`, () => {
      if (!can()) return;
      const id = this.player.available[i];
      if (id) this.player.setTool(id);
    }));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (!p.wasTouch) this.mouseMovedAt = this.t; });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.init();
      if (p.wasTouch) return;
      if (p.leftButtonDown()) this.mouseDown = true;
      if (p.rightButtonDown() && can()) this.player.cycleTool();
      this.mouseMovedAt = this.t;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => { if (!p.leftButtonDown()) this.mouseDown = false; });
    this.input.on('gameout', () => { this.mouseDown = false; });
  }

  private setupBus() {
    bus.on('npc:vomit', (c: Crew) => {
      if (this.rng.chance(0.5)) this.announce('vomit', { pct: Math.round(this.ship.morale) }, { room: c.room() ?? 'pasillo' });
    });
    bus.on('dirt:removed', (d: Dirt) => {
      if (d.art && this.artFrame) { this.artFrame.destroy(); this.artFrame = null; }
    });
    bus.on('art:touched', () => {
      if (this.t - this.artWarnT > 8) { this.artWarnT = this.t; this.floatText(this.player.x, this.player.y - 24, '¡Cuidado! Es una obra de arte', 'bad'); }
    });
    bus.on('gravity:off', () => {
      this.time.delayedCall(800, () => { for (const c of this.crew) if (c.available && this.rng.chance(0.5)) c.sayKey('zeroG', true); });
    });
    bus.on('fire:start', (room: RoomId, source?: string) => { if (source) this.stats.story.push(`Incendio en ${ROOM_NAMES[room]} por ${source}`); });
    bus.on('panel:broken', (f, cause: string) => this.stats.story.push(`Cortocircuito en ${ROOM_NAMES[f.room as RoomId]}: ${cause}`));
    bus.on('creature:killed', (c: Creature) => {
      this.stats.creaturesKilled++;
      if (c.sp.hostile) this.stats.emergenciesResolved++;
    });
  }

  // ───────────────────────── API para sistemas ─────────────────────────

  mouseActive() { return this.mouseDown || this.t - this.mouseMovedAt < 3; }

  consumeInteractKey() { this.interactLock = true; }

  /** Herramientas disponibles según nivel, mejoras, misión y reglas del desafío. */
  availableTools(): ToolId[] {
    if (this.attract || this.rules.has('solo_fregona')) return ['fregona'];
    const lv = saves.data.level;
    const out = new Set<ToolId>(['fregona', 'espuma', 'aspiradora']);
    if (lv >= TOOL_UNLOCK_LEVEL.desinfectante || this.rules.has('epidemia') || this.rules.has('moho') || this.spec === 'sanitario') out.add('desinfectante');
    if (lv >= TOOL_UNLOCK_LEVEL.crio || this.mission?.boss === 'glorp' || this.rules.has('inundacion')) out.add('crio');
    if (lv >= TOOL_UNLOCK_LEVEL.trampa || this.rules.has('plaga') || this.spec === 'plagas') out.add('trampa');
    if (this.upg.dron) out.add('robot');
    if (this.rules.has('sin_agua')) { out.delete('fregona'); out.add('desinfectante'); out.add('crio'); }
    return TOOL_ORDER.filter((t) => out.has(t));
  }

  announce(key: string, vars: Record<string, string | number> = {}, opts: { room?: RoomId } = {}) {
    if (this.attract || this.over) return;
    const lines = CLORO[key];
    if (!lines) return;
    let room = opts.room;
    if (room && this.lieCount > 0 && ['fire', 'breach', 'short', 'creature', 'vomit', 'clog', 'leak'].includes(key)) {
      const others = this.map.rooms.filter((r) => r.id !== room).map((r) => r.id);
      room = this.rng.pick(others);
      this.lieCount--;
      if (this.lieCount === 0) this.time.delayedCall(14000, () => this.announce('lie'));
    }
    const text = tpl(this.rng.pick(lines), { room: room ? ROOM_NAMES[room] : 'la nave', pct: Math.round(this.ship.morale), where: 'la ventilación', ...vars });
    const sev = ['breach', 'gravityOff', 'reactor', 'reactorBoom', 'fire', 'creature', 'invasion', 'bossSpawn', 'corpse'].includes(key) ? 3 : 1;
    ui.message(text, sev);
  }

  say(actor: Actor, text: string) {
    if (this.attract && actor !== this.player && Math.random() < 0.5) return;
    this.hostSync?.say(actor, text, actor instanceof Player ? actor.netPid : null);
    if (actor instanceof Player && !actor.isLocal && this.netRole === 'host') return;
    ui.labels.bubble(`b:${actor.uid}`, actor.label, text, () => (actor.hidden ? null : { x: actor.x, y: actor.y - 19 - actor.floatOff }), actor === this.player);
  }

  floatText(x: number, y: number, text: string, cls = 'info') {
    if (this.attract) return;
    this.hostSync?.floatText(x, y, text, cls);
    ui.labels.float(text, x, y, cls);
  }

  shake(intensity: number, dur = 200) {
    this.hostSync?.shake(intensity, dur);
    if (saves.data.settings.reduceFx || this.attract) return;
    this.cameras.main.shake(dur, intensity);
  }

  flashScreen(color: number) { if (!this.attract) ui.flash(color); }

  playerCaused(desc: string) {
    this.stats.playerCaused.push(desc);
    this.floatText(this.player.x, this.player.y - 26, 'Incidente provocado por el personal', 'bad');
    if (this.t - this.causedMsgT > 25) { this.causedMsgT = this.t; this.announce('playerCaused'); }
  }

  spawnCreature(species: SpeciesId, x: number, y: number, size = 1, origin = 'la ventilación', silent = false): Creature {
    const c = new Creature(this, species, x, y, size, origin);
    this.creatures.push(c);
    this.stats.creaturesSpawned++;
    if (species !== 'insecto' && species !== 'rata') this.stats.emergencies++;
    if (species === 'glorp' || species === 'babosa') audio.sfx('alien');
    if (!silent) {
      const room = this.map.roomAtPx(x, y) ?? 'pasillo';
      const key = species === 'rata' ? 'rats' : species === 'insecto' ? 'insects' : species === 'babosa' ? 'slug' : species === 'glorp' ? 'creature' : null;
      if (key) this.announce(key, { where: origin }, { room });
      this.stats.story.push(`${c.sp.name} salió de ${origin}`);
    }
    bus.emit('creature:spawn', c);
    return c;
  }

  /** Abordaje de Rasgadores: combate visible entre seguridad y los invasores. */
  startInvasion(): boolean {
    if (this.creatures.filter((c) => c.alive && c.species === 'invasor').length > 2) return false;
    const rooms = this.map.rooms.filter((r) => r.id !== 'pasillo' && r.floorTiles.length > 8);
    const r = this.rng.pick(rooms);
    const n = this.rng.int(3, this.rules.has('invasion') ? 5 : 4) + (this.cfg.mode === 'caos' ? 1 : 0);
    const cx = (r.x + r.w / 2) * TILE, top = r.y * TILE + 6;
    this.fx.explosion(cx, top);
    for (let i = 0; i < 5; i++) this.dirt.add('escombros', cx + this.rng.range(-20, 20), top + this.rng.range(4, 18), this.rng.range(0.5, 1));
    audio.sfx('explosion');
    this.shake(0.012, 500);
    this.ship.damage(3);
    for (let i = 0; i < n; i++) {
      this.time.delayedCall(400 + i * 650, () => {
        if (this.over) return;
        const t = this.rng.pick(r.floorTiles);
        const p = this.map.tileCenter(t.tx, t.ty);
        this.spawnCreature('invasor', p.x, p.y, 1, 'el casco', true);
        this.fx.debris(p.x, p.y);
      });
    }
    this.lastInvasionT = this.t;
    this.announce('invasion', {}, { room: r.id });
    this.stats.story.push(`Abordaje de ${n} Rasgadores en ${ROOM_NAMES[r.id]}`);
    this.flashScreen(0xff2030);
    // refuerzos de seguridad si hacen falta
    const guards = this.crew.filter((c) => c.alive && c.arch.role === 'combate').length;
    for (let i = guards; i < 2; i++) {
      this.time.delayedCall(4000 + i * 1500, () => {
        if (this.over) return;
        const e = this.entryPoint();
        const g = new Crew(this, 'seguridad', e.x, e.y);
        this.crew.push(g);
        g.say('¡Refuerzos de seguridad! ¿Dónde está la fiesta?', true);
      });
    }
    return true;
  }

  /** Esclusa del extremo del pasillo: llegada de reemplazos, inspectores y refuerzos. */
  entryPoint() {
    const corridor = this.map.room('pasillo');
    const tx = corridor.x + corridor.w - 2, ty = corridor.y + Math.floor(corridor.h / 2);
    return this.map.tileCenter(tx, ty);
  }

  spawnReplacement(prof: ProfessionId) {
    if (this.over || prof === 'inspector') return;
    const e = this.entryPoint();
    const c = new Crew(this, prof, e.x, e.y);
    this.crew.push(c);
    this.announce('replacement', { name: c.name });
    c.say('Hola. Me han dicho que hay una vacante. ¿Por qué hay una bolsa con mi talla?', true);
  }

  // ── gadgets del conserje: trampas y dron ──

  placeTrap(x: number, y: number) {
    if (this.netRole === 'client') { this.netAction({ a: 'place', tool: 'trampa', x, y }); return; }
    const sprite = this.add.sprite(x, y, 'fx_trap', 0).setScale(HD).setDepth(DEPTH.floorProp + 0.5);
    this.traps.push({ id: this.gadgetId++, x, y, sprite, caught: null });
    audio.sfx('trap');
    this.floatText(x, y - 10, 'Trampa colocada', 'info');
  }

  trapAt(x: number, y: number): boolean {
    return this.traps.some((t) => !t.caught && Math.abs(t.x - x) < 5 && Math.abs(t.y - y) < 4);
  }

  removeTrap(t: Trap) {
    const i = this.traps.indexOf(t);
    if (i >= 0) this.traps.splice(i, 1);
    t.sprite.destroy();
  }

  deployBot(x: number, y: number) {
    if (this.netRole === 'client') { this.netAction({ a: 'place', tool: 'robot', x, y }); return; }
    const sprite = this.add.sprite(x, y, 'cleanbot', 0).setScale(HD).setDepth(sortDepth(y));
    this.bots.push({ id: this.gadgetId++, x, y, sprite, target: null, broken: false, t: 0, vx: 0, vy: 0 });
    audio.sfx('ok');
    this.player.say('Ve, pequeño. Aspira por mí.', true);
  }

  removeBot(b: CleanBot) {
    const i = this.bots.indexOf(b);
    if (i >= 0) this.bots.splice(i, 1);
    b.sprite.destroy();
  }

  private updateGadgets(dt: number) {
    for (const t of this.traps) {
      if (t.caught) continue;
      for (const c of this.creatures) {
        if (!c.alive || !c.sp.trap || c.hidden || c === this.bosses.glorp || c.size > 1.3) continue;
        if (Math.hypot(c.x - t.x, c.y - t.y) > 8) continue;
        t.caught = c;
        c.capture(t.x, t.y);
        t.sprite.setFrame(1);
        this.stats.trapsCaught++;
        this.floatText(t.x, t.y - 12, `¡${c.sp.name} atrapado!`, 'good');
        audio.sfx('trap');
        break;
      }
    }
    for (const b of this.bots) {
      b.t += dt;
      if (b.broken) {
        if (Math.random() < dt * 2) this.fx.sparks(b.x, b.y - 4, 2);
        continue;
      }
      if (!b.target || !this.dirt.list.includes(b.target)) {
        b.target = null;
        const room = this.map.roomAtPx(b.x, b.y);
        let best: Dirt | null = null, bd = 140;
        for (const d of this.dirt.near(b.x, b.y, 140)) {
          const def = RESIDUES[d.type];
          if (!def.solid || def.eternal || d.art || d.room !== room) continue;
          const dd = Math.hypot(d.x - b.x, d.y - b.y);
          if (dd < bd) { bd = dd; best = d; }
        }
        b.target = best;
      }
      const d = b.target;
      if (d) {
        const dx = d.x - b.x, dy = d.y - b.y, dist = Math.hypot(dx, dy);
        if (dist > 3) {
          const sp = 34;
          b.vx = (dx / dist) * sp; b.vy = (dy / dist) * sp;
          b.x += b.vx * dt; b.y += b.vy * dt;
        } else {
          d.amount -= dt * 0.9;
          if (Math.random() < dt * 8) this.fx.suck(b.x, b.y, Math.random() * Math.PI * 2);
          if (d.amount <= 0.05) { this.dirt.remove(d, 'player'); this.stats.droneCleaned++; b.target = null; }
          else this.dirt.refresh(d);
          if ((d.type === 'combustible' || d.type === 'aceite') && Math.random() < dt * 0.3) {
            b.broken = true;
            b.sprite.setTint(0x666666);
            this.announce('droneBroken');
            this.fx.sparks(b.x, b.y, 8);
          }
        }
      } else {
        b.x += Math.sin(b.t * 0.9 + b.id) * 6 * dt;
        b.y += Math.cos(b.t * 0.7 + b.id) * 4 * dt;
      }
      if (this.map.isSolidPx(b.x, b.y)) { b.x -= b.vx * dt * 2; b.y -= b.vy * dt * 2; b.target = null; }
      b.sprite.setPosition(Math.round(b.x * 2) / 2, Math.round((b.y - 2 + Math.sin(b.t * 6) * 0.5) * 2) / 2).setDepth(sortDepth(b.y));
      b.sprite.setFrame(Math.floor(b.t * 8) % 2);
      if (Math.abs(b.vx) > 1) b.sprite.setFlipX(b.vx < 0);
    }
  }

  onPlayerDeath(cause: string, p: Player = this.player) {
    if (this.netRole === 'host') {
      // cooperativo: Recursos Humanos envía un conserje de repuesto y el turno sigue
      if (p.carrying === 'body' && p.body) this.combat.dropAt(p.body, p.x, p.y + 4);
      p.carrying = null;
      p.body = null;
      this.respawns.push({ p, at: this.t + 10 });
      ui.message(`${p.name} ha quedado fuera de servicio (${cause}). Recursos Humanos envía un repuesto en 10 s.`, 3);
      return;
    }
    ui.message(`MOP-13 ha quedado fuera de servicio (${cause}). Iniciando papeleo.`, 3);
    this.time.delayedCall(1600, () => this.endShift('death'));
  }

  respawnLeft(p: Player) { const r = this.respawns.find((x) => x.p === p); return r ? r.at - this.t : 0; }

  /** punto de aparición (los conserjes de una sala no aparecen unos encima de otros) */
  spawnPoint(pid: number) {
    const base = this.map.tileCenter(this.map.spawn.tx, this.map.spawn.ty);
    const off = pid > 1 ? (pid - 1) * 14 : 0;
    for (const dx of [off, -off, 0]) if (!this.map.isSolidPx(base.x + dx, base.y)) return { x: base.x + dx, y: base.y };
    return base;
  }

  /** conserje más cercano y su distancia (los muertos e inactivos no cuentan) */
  nearestPlayer(x: number, y: number): { p: Player | null; d: number } {
    let best: Player | null = null, bd = 9999;
    for (const p of this.players) {
      if (!p.active || p.dead) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return { p: best, d: bd };
  }

  minPlayerHp() { return Math.min(...this.players.filter((p) => !p.dead).map((p) => p.hp), 999); }

  /** ANFITRIÓN: un invitado entra en la nave */
  addRemote(pid: number, info: { name: string; look?: PeerLook; upg: Partial<Record<UpgradeId, number>>; spec: SpecId | null; available?: ToolId[] }) {
    const key = ensurePeerTexture(this, pid, info.look);
    const sp = this.spawnPoint(pid);
    const p = this.netLocal(() => new Player(this, sp.x, sp.y, { texKey: key, pid, name: info.name, kind: 'remote', upg: info.upg, spec: info.spec, available: info.available }));
    this.players.push(p);
    this.interactions.set(p, new Interaction(this, p));
    ui.toast(`${info.name} se une al turno de noche`, 'task');
    return p;
  }

  /** ANFITRIÓN: un invitado se va */
  removeRemote(pid: number) {
    const p = this.players.find((x) => x.netPid === pid && x.kind === 'remote');
    if (!p) return;
    if (p.carrying === 'body' && p.body) this.combat.dropAt(p.body, p.x, p.y + 4);
    this.players.splice(this.players.indexOf(p), 1);
    this.interactions.delete(p);
    this.cleaning.forget(p);
    this.respawns = this.respawns.filter((r) => r.p !== p);
    ui.labels.hide(`n:${pid}`);
    ui.toast(`${p.name} ha abandonado la nave`, 'task');
    p.destroy();
  }

  /** INVITADO: otro conserje visible (anfitrión u otro invitado) */
  addReplica(pid: number, name: string, look?: PeerLook) {
    const key = ensurePeerTexture(this, pid, look);
    const sp = this.spawnPoint(pid);
    const p = this.netLocal(() => new Player(this, sp.x, sp.y, { texKey: key, pid, name, kind: 'replica' }));
    this.players.push(p);
    return p;
  }

  removeReplica(p: Player) {
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    this.cleaning.forget(p);
    ui.labels.hide(`n:${p.netPid}`);
    p.destroy();
  }

  /** INVITADO: acción que decide el anfitrión */
  netAction(d: object) { this.clientSync?.send(d); }

  /** la ventana pierde el foco: se sueltan teclas, ratón y mandos (y el anfitrión deja de ver a este conserje usando la herramienta) */
  releaseInput() {
    this.mouseDown = false;
    this.spaceUse = false;
    try { this.input.keyboard?.resetKeys(); } catch { /* */ }
    const t = this.touch;
    t.dx = 0; t.dy = 0; t.use = false; t.interact = false; t.run = false; t.aimActive = false;
    this.cleaning?.stopLoops();
    mp.voice?.setPtt(false);
    this.clientSync?.sendIdle();
  }

  setCooldowns(foam: number, purge: number) { this.cds = { foam: this.t + foam, purge: this.t + purge }; }

  /** la mesa holográfica del puente: en la pantalla de quien la usa */
  openShipPanel(p: Player) {
    if (p.isLocal) ui.showShipPanel();
    else this.hostSync?.sendTo(p.netPid, { k: 'ui', a: 'ship' });
  }

  /** Favores de la tripulación: cada profesión ayuda a su manera (o no). */
  requestHelp(c: Crew, by: Player = this.player) {
    if (this.favors <= 0) return;
    const willing = c.coop * (0.5 + c.relation / 100);
    if (willing < 0.3 && this.rng.chance(0.6)) { c.sayKey('refuse', true); c.setEmote('anger', 1.2); return; }
    this.favors--;
    this.stats.favorsUsed++;
    saves.data.memory.helped[c.prof] = (saves.data.memory.helped[c.prof] ?? 0) + 1;
    audio.sfx('ok');
    const p = by;
    const refund = (msg: string) => { c.say(msg, true); this.favors++; this.stats.favorsUsed--; };
    switch (c.prof) {
      case 'ingeniero': case 'robot': {
        if (c.prof === 'robot' && this.rng.chance(0.5)) {
          const near = this.dirt.near(p.x, p.y, 90).filter((d) => RESIDUES[d.type].solid && !RESIDUES[d.type].eternal);
          if (near.length) {
            const d = near[0];
            c.assign({ kind: 'clean', room: d.room ?? 'pasillo', target: d, x: d.x, y: d.y, t: 0, work: 0 });
            c.say('PROTOCOLO DE LIMPIEZA ACTIVADO. MOP-13: USTED ES INEFICIENTE.', true);
            break;
          }
        }
        const all: { t: any; kind: 'fixture' | 'toilet' | 'reactor'; room: RoomId; x: number; y: number }[] = [
          ...this.map.fixtures.filter((f) => f.broken || f.leaking).map((f) => ({ t: f, kind: 'fixture' as const, room: f.room, ...this.map.tileCenter(f.spot.tx, f.spot.ty) })),
          ...this.map.props.filter((x) => x.kind === 'toilet' && x.state.clog && x.spots[0]).map((t) => ({ t, kind: 'toilet' as const, room: t.room, ...this.map.tileCenter(t.spots[0].tx, t.spots[0].ty) })),
          ...(this.emerg.overheating ? this.map.props.filter((x) => x.kind === 'reactorConsole' && x.spots[0]).map((t) => ({ t, kind: 'reactor' as const, room: t.room, ...this.map.tileCenter(t.spots[0].tx, t.spots[0].ty) })) : []),
        ].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        if (all.length) {
          const a = all[0];
          c.assign({ kind: a.kind, room: a.room, target: a.t, x: a.x, y: a.y, t: 0, work: 0 });
          c.say(c.prof === 'robot' ? 'REPARACIÓN EN CURSO. NO TOQUE NADA, HUMANO.' : 'Voy para allá. No toques nada.', true);
        } else refund('Todo funciona. Por ahora.');
        break;
      }
      case 'capitan': {
        c.say('¡Tranquilo, tengo un plan! …Fiesta.', true);
        for (const x of this.crew) x.morale = Math.min(100, x.morale + 10);
        this.announce('favorCaptain');
        if (this.rng.chance(0.45)) this.director.triggerById('fiesta');
        break;
      }
      case 'cientifica': {
        const cr = this.creatures.find((x) => x.alive);
        if (cr) {
          const tip: Record<SpeciesId, string> = {
            glorp: 'Es un Glorp. Odia la espuma, adora el agua. Si lo mojas, se divide.',
            invasor: 'Un Rasgador. No es asunto tuyo: deja que seguridad dispare y luego friega el ácido.',
            babosa: 'Babosa gigante. Lenta, pegajosa y muy resistente. La sal… digo, la espuma la frena.',
            rata: 'Roedor de chatarra. Trampas o aspiradora. No intentes razonar con él.',
            insecto: 'Insectos devoracables. Se comen los paneles. Aspíralos antes de que provoquen un apagón.',
            rogue: 'Una aspiradora rebelde. Atráela hacia un charco y se cortocircuitará.',
          };
          c.say(tip[cr.species], true);
          ui.pinned = `creatures:${cr.species}:${this.map.roomAtPx(cr.x, cr.y) ?? 'pasillo'}`;
          cr.noticed = true;
        } else {
          let n = 0;
          for (const d of this.dirt.near(c.x, c.y, 90)) if (d.type === 'quimico' || d.type === 'baba' || d.type === 'acido') { this.dirt.remove(d, 'other'); n++; }
          c.say(n ? `Neutralizados ${n} vertidos. Por la ciencia.` : 'No hay nada que analizar. Qué aburrimiento.', true);
          this.fx.sparkle(c.x, c.y - 6, 10);
        }
        break;
      }
      case 'cocinero': {
        p.stamina = 100;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        if (this.rng.chance(0.3)) { this.dirt.add('cafe', p.x + 6, p.y + 6, 0.9); c.say('¡Café recién hecho! Uy, recién derramado.', true); }
        else c.say('Toma, café triple. No preguntes de qué.', true);
        break;
      }
      case 'medica': {
        p.hp = Math.min(p.maxHp, p.hp + 45);
        p.o2 = Math.min(100, p.o2 + 30);
        const sick = this.disease.infected().sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (sick) { c.assign({ kind: 'treat', room: sick.room() ?? 'pasillo', target: sick, x: sick.x, y: sick.y, t: 0, work: 0 }); c.say('Te curo eso y voy a ver a ' + sick.name + '. Lávate las manos.', true); }
        else c.say('Vendado. No toques nada viscoso durante 5 minutos.', true);
        this.fx.sparkle(p.x, p.y - 8, 8);
        break;
      }
      case 'seguridad': {
        const threat = this.creatures.filter((x) => x.alive && !x.hidden).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (threat) {
          c.assign({ kind: 'fight', room: this.map.roomAtPx(threat.x, threat.y) ?? 'pasillo', target: threat, x: threat.x, y: threat.y, t: 0, work: 0 });
          c.say('Entendido. Apártate y tráete la fregona para luego.', true);
        } else refund('Zona despejada. Mi arma y yo nos aburrimos.');
        break;
      }
      case 'diplomatico': {
        for (const x of this.crew) { x.morale = Math.min(100, x.morale + 6); x.stress = Math.max(0, x.stress - 15); }
        c.say('He negociado un alto el fuego entre la tripulación y la suciedad. Ella no lo respetará.', true);
        break;
      }
      case 'paranoico': {
        c.fear = 0;
        c.stress = 0;
        c.morale = Math.min(100, c.morale + 25);
        c.say('Vale… vale. Respiro. Pero los conductos me miran.', true);
        break;
      }
      case 'contrabandista': {
        const tools = p.available.filter((t) => t !== 'fregona' && t !== 'aspiradora');
        for (const t of tools) { p.tools[t].charge = p.tools[t].cap; p.tools[t].broken = false; }
        p.tools.fregona.charge = 0;
        c.say(this.secrets.eternal ? 'Te he rellenado todo. Y un consejo gratis: hay una mancha que nunca se va. Nunca.' : 'Recargas de estraperlo. Tú no me has visto.', true);
        break;
      }
      case 'turista': {
        let n = 0;
        if (this.rng.chance(0.5)) {
          for (const d of this.dirt.near(c.x, c.y, 70)) if ((d.type === 'basura' || d.type === 'comida') && n < 3) { this.dirt.remove(d, 'other'); n++; }
        }
        if (n) c.say('¡Mira, ayudo! ¿Salgo bien en la foto?', true);
        else { c.say('¡Selfi con el conserje!', true); ui.flash(0xffffff); if (this.rng.chance(0.4)) this.time.delayedCall(1200, () => c.vomit()); }
        break;
      }
      default: refund('No puedo ayudarte, estoy muy ocupado no haciendo nada.');
    }
  }

  private actorsInDoor(d: Door): boolean {
    const actors: Actor[] = [this.player, ...this.crew.filter((c) => c.alive), ...this.creatures.filter((c) => c.alive)];
    return actors.some((a) => d.tiles.some((t) => Math.abs(a.x - (t.tx * TILE + 8)) < 12 && Math.abs(a.y - (t.ty * TILE + 8)) < 12));
  }

  toggleDoor(d: Door, silent = false): boolean {
    if (!d.locked && this.actorsInDoor(d)) {
      if (!silent) { this.floatText(d.tiles[0].tx * TILE + 8, d.tiles[0].ty * TILE - 4, 'Algo obstruye la puerta', 'bad'); audio.sfx('error'); }
      return false;
    }
    d.locked = !d.locked;
    d.lockIcon?.setVisible(d.locked);
    if (!silent) audio.sfx('door');
    return true;
  }

  lockRoom(room: RoomId) {
    if (this.netRole === 'client') { this.netAction({ a: 'panel', op: 'lock', room }); return; }
    const r = this.map.room(room);
    const lockAll = !r.doors.every((d) => d.locked);
    let blocked = 0;
    for (const d of r.doors) if (d.locked !== lockAll) { if (!this.toggleDoor(d, true)) blocked++; }
    audio.sfx(lockAll ? 'door' : 'ok');
    ui.message(lockAll ? `Compartimento ${ROOM_NAMES[room]} sellado${blocked ? ` (salvo ${blocked} puerta obstruida)` : ''}. Nadie entra, nadie sale.` : `${ROOM_NAMES[room]}: puertas desbloqueadas.`);
  }

  cooldownLeft(k: string) { return Math.max(0, (this.cds[k] ?? 0) - this.t); }

  suppressFire(room: RoomId, auto = false) {
    if (this.netRole === 'client') { this.netAction({ a: 'panel', op: 'foam', room }); return; }
    if (!auto && this.cooldownLeft('foam') > 0) return;
    if (!auto) this.cds.foam = this.t + 60;
    const r = this.map.room(room);
    for (const f of [...this.emerg.fires.values()]) if (f.room === room) this.emerg.extinguish(f, 5, false);
    for (let i = 0; i < 24; i++) {
      const t = this.rng.pick(r.floorTiles);
      this.dirt.add('espuma', t.tx * TILE + this.rng.range(2, 14), t.ty * TILE + this.rng.range(4, 14), this.rng.range(0.5, 1));
      if (i % 3 === 0) this.fx.foamPuff(t.tx * TILE + 8, t.ty * TILE + 4);
    }
    for (const c of this.crew) if (c.available && c.room() === room && this.rng.chance(0.5)) c.fall(this.rng.range(-1, 1), 1);
    for (const c of this.creatures) if (c.alive && this.map.roomAtPx(c.x, c.y) === room) c.foam(3);
    audio.sfx('steam');
    if (auto) {
      if (!this.attract) ui.message(`Protocolo antiincendios automático: ${ROOM_NAMES[room]} inundada de espuma. Alguien tendrá que fregarla. Usted.`, 3);
      this.stats.story.push(`El sistema antiincendios inundó ${ROOM_NAMES[room]} de espuma`);
    } else {
      ui.message(`Sistema antiincendios activado en ${ROOM_NAMES[room]}. Disfrute de la espuma.`);
      this.stats.story.push(`Inundaste ${ROOM_NAMES[room]} de espuma`);
    }
  }

  purgeVents(room: RoomId) {
    if (this.netRole === 'client') { this.netAction({ a: 'panel', op: 'purge', room }); return; }
    if (this.cooldownLeft('purge') > 0) return;
    this.cds.purge = this.t + 45;
    this.purgedAt.set(room, this.t);
    let n = 0;
    for (const d of [...this.dirt.list]) if (d.room === room && (d.type === 'polvo' || d.type === 'confeti' || d.type === 'esporas')) { this.dirt.remove(d, 'player'); n++; }
    this.disease.contam.set(room, Math.max(0, (this.disease.contam.get(room) ?? 0) - 40));
    this.ship.oxygen = Math.max(0, this.ship.oxygen - 12);
    const r = this.map.room(room);
    for (let i = 0; i < 6; i++) this.fx.smoke((r.x + this.rng.range(0, r.w)) * TILE, (r.y + this.rng.range(0, r.h)) * TILE);
    audio.sfx('steam');
    ui.message(`Ventilación purgada en ${ROOM_NAMES[room]}: ${n} residuos aspirados. Oxígeno −12 %.${room === 'hidroponico' && this.bosses.active && this.bosses.kind === 'reina' ? ' La Reina del Moho se queda sin esporas: ¡ataca su núcleo!' : ''}`);
  }

  restorePower() {
    if (this.netRole === 'client') { this.netAction({ a: 'panel', op: 'power' }); return; }
    if (this.emerg.blackoutT > 0) this.emerg.blackoutT = 0.01;
  }

  startInspector(): boolean {
    if (this.inspector) return false;
    const rooms = this.rng.shuffle(this.map.rooms.filter((r) => r.id !== 'pasillo').map((r) => r.id)).slice(0, 3);
    const routeNames = rooms.map((r) => ROOM_NAMES[r]).join(', ');
    this.announce('inspectorSoon', { route: routeNames, sec: 25 });
    this.missions.add({ kind: 'inspection', title: `Inspección: ${routeNames}`, target: 3, reward: 0 });
    this.time.delayedCall(25000, () => {
      if (this.over) return;
      const c0 = this.entryPoint();
      const insp = new Crew(this, 'inspector', c0.x, c0.y);
      this.crew.push(insp);
      this.inspector = insp;
      insp.startInspection(rooms);
      this.announce('inspectorArrive');
      insp.say('Buenas noches. Vengo a inspeccionar. Que nadie se mueva. Sobre todo la suciedad.', true);
    });
    return true;
  }

  markArt(): boolean {
    const cand = this.dirt.list.filter((d) => d.amount > 0.7 && d.room && d.room !== 'pasillo' && !d.art);
    if (!cand.length) return false;
    const d = cand.sort((a, b) => b.amount * RESIDUES[b.type].weight - a.amount * RESIDUES[a.type].weight)[0];
    d.art = true;
    this.stats.artMarked = true;
    this.artFrame = this.add.image(d.x, d.y, 'fx_frame').setDepth(DEPTH.dirt + 0.5).setScale(HD);
    ui.labels.place('art', 'OBRA DE ARTE · NO LIMPIAR', d.x, d.y - 12, 'wl artlabel');
    this.announce('art', {}, { room: d.room! });
    return true;
  }

  setPaused(p: boolean) {
    if (this.netRole !== 'solo') {
      // en compañía el mundo no se detiene: solo deja de responder tu conserje
      this.inputBlocked = p;
      this.mouseDown = false;
      if (p) this.cleaning.stopLoops();
      return;
    }
    if (p) {
      this.mouseDown = false;
      this.cleaning.stopLoops();
      audio.stopLoops();
      this.scene.pause();
    } else {
      this.mouseDown = false;
      this.scene.resume();
    }
  }

  restartShift() {
    this.scene.restart({ ...this.cfg });
  }

  // ───────────────────────── bucle ─────────────────────────

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    if (this.netRole === 'client') { this.updateClient(dt); return; }
    if (this.netRole === 'host') this.inputBlocked = !!ui.modal;
    if (!this.started || this.over) {
      this.netLocal(() => this.lighting.update(dt));
      this.hostSync?.tick(dt);
      return;
    }
    this.t += dt;
    const cam = this.cameras.main;
    const ptr = this.input.activePointer;
    const wp = this.iso ? this.iso.screenToWorld(ptr.x, ptr.y) : cam.getWorldPoint(ptr.x, ptr.y);
    this.aimWorld = { x: wp.x, y: wp.y };

    const k = this.keys;
    const eDown = k.E.isDown || this.touch.interact;
    if (this.interactLock && !eDown && !k.SPACE.isDown) this.interactLock = false;
    const hasTarget = !!this.interaction.current;
    const holdE = !this.interactLock && (eDown || (k.SPACE.isDown && hasTarget));
    this.spaceUse = k.SPACE.isDown && !hasTarget && !this.interactLock;

    if (this.bossAt > 0 && this.t >= this.bossAt && this.mission?.boss) { this.bossAt = -1; this.bosses.spawn(this.mission.boss); }

    this.player.update(dt);
    for (const p of this.players) if (p.kind === 'remote') p.remoteTick(dt);
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      if (this.t < r.at) continue;
      this.respawns.splice(i, 1);
      const sp = this.entryPoint();
      r.p.respawn(sp.x, sp.y);
      r.p.netTp = { seq: (r.p.netTp?.seq ?? 0) + 1, x: Math.round(sp.x), y: Math.round(sp.y) };
      this.say(r.p, 'MOP de repuesto incorporado. Sigo fregando donde lo dejó el anterior.');
    }
    for (const c of this.crew) c.update(dt);
    for (const c of this.creatures) c.update(dt);
    // limpieza de criaturas desaparecidas
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if ((c.state === 'gone' || c.state === 'captured') && !this.tweens.isTweening(c.sprite)) { c.destroy(); this.creatures.splice(i, 1); }
    }
    for (let i = this.crew.length - 1; i >= 0; i--) {
      const c = this.crew[i];
      if (c.state === 'gone' && c === this.inspector) { c.destroy(); this.crew.splice(i, 1); this.inspector = null; }
    }
    if (this.hostSync) this.hostSync.quiet(() => this.dirt.update(dt)); else this.dirt.update(dt);
    this.cleaning.update(dt);
    this.emerg.update(dt);
    this.combat.update(dt);
    this.response.update(dt);
    this.disease.update(dt);
    this.bosses.update(dt);
    this.secrets.update(dt);
    this.updateGadgets(dt);
    this.ship.update(dt);
    if (this.rules.has('oscuridad')) this.ship.power = Math.min(this.ship.power, 30);
    if (this.rules.has('gravedad_cero')) this.ship.gravity = false;
    this.director.update(dt);
    if (!this.attract) {
      this.missions.update(dt);
      this.humor.update(dt);
      this.interaction.update(dt, holdE && !this.inputBlocked);
      for (const [p, it] of this.interactions) if (p.kind === 'remote') it.update(dt, !!p.net?.e);
    }
    this.updateDoors(dt);
    if (this.hostSync) this.hostSync.quiet(() => this.updateDecor(dt)); else this.updateDecor(dt);
    this.netLocal(() => this.lighting.update(dt));
    this.updateNameLabels();
    this.hostSync?.tick(dt);
    audio.setIntensity(Math.min(1, this.emerg.threatLoad() / 4 + (this.bosses.active ? 0.4 : 0)));

    if (!this.attract) {
      this.hudT -= dt;
      if (this.hudT <= 0) { this.hudT = 0.12; ui.updateHud(this.hudState()); }
      if (!this.tasksFolded && this.t > 18) { this.tasksFolded = true; ui.setTasksCollapsed(true); }
      if (this.cfg.duration && this.t >= this.cfg.duration) this.endShift('time');
      else if (this.ship.integrity <= 0) {
        this.shake(0.03, 1200);
        audio.sfx('explosion');
        this.fx.explosion(this.player.x, this.player.y);
        ui.message('Integridad estructural: 0 %. La nave se ha partido. Se ruega abandonar el puesto ordenadamente.', 3);
        this.time.delayedCall(1200, () => this.endShift('destroyed'));
        this.over = true;
      }
    } else {
      // la demo del menú no debe degenerar: se repara sola
      if (this.ship.integrity < 40) this.ship.integrity = 80;
      if (this.t > 400) { this.t = 50; }
    }
  }

  /** INVITADO: su conserje se mueve aquí; el resto llega del anfitrión */
  private updateClient(dt: number) {
    const cs = this.clientSync!;
    this.inputBlocked = !!ui.modal;
    const cam = this.cameras.main;
    const ptr = this.input.activePointer;
    const wp = this.iso ? this.iso.screenToWorld(ptr.x, ptr.y) : cam.getWorldPoint(ptr.x, ptr.y);
    this.aimWorld = { x: wp.x, y: wp.y };
    const k = this.keys;
    const eDown = k.E.isDown || this.touch.interact;
    if (this.interactLock && !eDown && !k.SPACE.isDown) this.interactLock = false;
    const hasTarget = !!cs.prompt;
    const holdE = !this.interactLock && !this.inputBlocked && (eDown || (k.SPACE.isDown && hasTarget));
    this.spaceUse = k.SPACE.isDown && !hasTarget && !this.interactLock;
    if (this.started && !this.over) this.player.update(dt);
    cs.update(dt, holdE);
    this.dirt.update(dt);
    this.cleaning.update(dt);
    this.updateDecor(dt);
    this.lighting.update(dt);
    this.updateNameLabels();
    if (this.started && !this.over) {
      this.hudT -= dt;
      if (this.hudT <= 0) { this.hudT = 0.12; ui.updateHud(this.hudState()); }
      if (!this.tasksFolded && this.t > 18) { this.tasksFolded = true; ui.setTasksCollapsed(true); }
    }
  }

  /** nombre sobre cada compañero */
  private updateNameLabels() {
    if (this.netRole === 'solo') return;
    const voice = mp.voice;
    for (const p of this.players) {
      if (p.isLocal) continue;
      if (p.hidden || !p.active) { ui.labels.hide(`n:${p.netPid}`); continue; }
      const talk = !!voice?.speaking(p.netPid);
      ui.labels.place(`n:${p.netPid}`, p.name.replace(/[<>&]/g, ''), p.x, p.y - 27 - p.floatOff, `wl pname${p.dead ? ' dead' : ''}${talk ? ' talk' : ''}`);
    }
    // voz por proximidad: el volumen de cada compañero depende de lo lejos que esté en la nave
    if (voice?.enabled) {
      const pos = new Map<number, { x: number; y: number }>();
      for (const p of this.players) if (!p.isLocal) pos.set(p.netPid, { x: p.x, y: p.y });
      voice.updateSpatial(this.player.dead ? null : { x: this.player.x, y: this.player.y }, pos);
    }
  }

  private updateDoors(dt: number) {
    const actors: Actor[] = [...this.players, ...this.crew, ...this.creatures];
    for (const d of this.map.doors) {
      const cx = d.tiles.reduce((a, t) => a + t.tx, 0) / d.tiles.length * TILE + 8;
      const cy = d.tiles.reduce((a, t) => a + t.ty, 0) / d.tiles.length * TILE + 8;
      const near = !d.locked && actors.some((a) => !a.hidden && Math.abs(a.x - cx) < 26 && Math.abs(a.y - cy) < 26 && (!(a instanceof Player) || a.active));
      const prev = d.open;
      d.open = Math.max(0, Math.min(1, d.open + (near ? 5 : -3) * dt));
      if (prev === 0 && d.open > 0 && Math.hypot(this.player.x - cx, this.player.y - cy) < 120) audio.sfx('door');
      const f = Math.round(d.open * 3);
      for (const s of d.sprites) s.setFrame(f);
    }
  }

  /** Quién atiende cada alerta (para «Atendido por…»). */
  private alertAssignee(a: AlertInfo): string | null {
    const [kind, id, room] = a.id.split(':');
    const r = this.response;
    switch (kind) {
      case 'fire': return r.assigneeName('fire', id);
      case 'breach': return r.assigneeName('breach', this.emerg.breaches.find((b) => String(b.id) === id));
      case 'panel': case 'pipe': return r.assigneeName('fixture', this.map.fixtures.find((f) => String(f.id) === id));
      case 'toilet': return r.assigneeName('toilet', this.map.props.find((p) => String(p.id) === id));
      case 'reactor': return r.assigneeName('reactor', this.map.props.find((p) => p.kind === 'reactorConsole'));
      case 'rescue': return r.assigneeName('revive', this.crew.find((c) => String(c.uid) === id));
      case 'creatures': {
        const c = this.crew.find((x) => x.state === 'respond' && x.task?.kind === 'fight' && x.task.target?.species === id && (this.map.roomAtPx(x.task.target.x, x.task.target.y) ?? 'pasillo') === room);
        return c ? c.name : null;
      }
      case 'outbreak': {
        const c = this.crew.find((x) => x.state === 'respond' && x.task?.kind === 'treat');
        return c ? c.name : null;
      }
    }
    return null;
  }

  /** Alertas completas: emergencias + cadáveres, brotes, jefes, falsas alarmas y quién las atiende. */
  allAlerts(): AlertInfo[] {
    if (this.clientSync) return this.clientSync.alerts;
    const out = this.emerg.alerts();
    for (const c of this.combat.corpses) {
      if (c.carried) continue;
      out.push({ id: `corpse:${c.id}`, icon: 'corpse', title: `Cuerpo de ${c.name}`, room: c.room ?? 'pasillo', x: c.x, y: c.y, sev: 1, risk: 'Recógelo con [E] y llévalo a la cápsula médica de la enfermería.' });
    }
    const inf = this.disease.infected();
    if (inf.length) out.push({ id: 'outbreak', icon: 'virus', title: `Infectados: ${inf.length}`, room: inf[0].room() ?? 'pasillo', x: inf[0].x, y: inf[0].y, sev: inf.length >= 3 ? 2 : 1, risk: 'La médica los trata. El desinfectante (4) también cura y descontamina.' });
    if (this.bosses.active) out.push({ id: 'boss', icon: 'boss', title: this.bosses.name, room: this.bosses.room ?? 'pasillo', x: this.bosses.x, y: this.bosses.y, sev: 3, risk: this.bosses.hint });
    for (const f of this.response.fakes) {
      out.push({ id: `fake:${f.id}`, icon: f.icon, title: f.icon === 'fire' ? 'Incendio (sin confirmar)' : f.icon === 'creature' ? 'Criatura avistada' : 'Alarma activada', room: f.room, x: f.x, y: f.y, sev: 2, risk: `Aviso de ${f.by}. Compruébalo en persona.` });
    }
    for (const a of out) { const by = this.alertAssignee(a); if (by) a.by = by; }
    return out;
  }

  /** parte del HUD común a todos los conserjes (el anfitrión se la manda a los invitados) */
  sharedHud() {
    const dur = this.cfg.duration;
    const gameMin = dur ? (this.t / dur) * SHIFT_HOURS * 60 : (this.t / SHIFT_SECONDS) * SHIFT_HOURS * 60;
    const hh = Math.floor(SHIFT_START_HOUR + gameMin / 60) % 24;
    const mm = Math.floor(gameMin % 60);
    const s = this.stats;
    const clean = this.ship.hygiene;
    const base = dur ? 100 * Math.min(1, this.t / dur) : (this.t / 60) * 14;
    const credits = Math.round(base + clean * 0.6 + s.emergenciesResolved * 6 + s.taskRewards + s.crewRescued * 10 + s.creaturesCaptured * 25 + s.creaturesRepelled * 10
      + s.bodiesRecovered * 12 + s.bossesDefeated * 40 + s.secretsFound * 5 + s.curedByPlayer * 6
      - s.mopsBroken * 15 - s.vacuumsBroken * 20 - s.playerCaused.length * 5 - s.foamOnCrew * 3 - (100 - this.ship.integrity) * 0.5);
    const b = this.bosses;
    return {
      modeLabel: this.modeLabel(),
      timeStr: `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`,
      subStr: dur ? `quedan ${fmtTime(dur - this.t)}` : `llevas ${fmtTime(this.t)}`,
      progress: dur ? this.t / dur : (this.t % 60) / 60,
      credits,
      favors: this.favors,
      boss: b.active ? { name: b.name, hp: b.maxHp ? b.hp / b.maxHp : 0, hint: b.hint, shield: b.shield } : null,
    };
  }

  hudState(): HudState {
    if (this.clientSync) return this.clientSync.hudState();
    const p = this.player;
    const room = this.map.roomAtPx(p.x, p.y) ?? 'pasillo';
    let status = '';
    if (this.ship.zeroG) status = 'Sin gravedad: inercia total';
    else if (p.invertT > 0) status = '¡Controles invertidos!';
    else if (p.isDown) status = '¡Resbalón!';
    else if (p.stunT > 0) status = 'Aturdido';
    else if (p.carrying === 'body') status = `Cargando a ${p.body?.name ?? 'alguien'} → enfermería`;
    else if (p.carrying) status = 'Cargando basura → vertedero';
    else if (p.stamina < 15) status = 'Agotado';
    else if (this.emerg.pullAt(p.x, p.y).x !== 0) status = '¡La succión te arrastra!';
    if (p.dead && this.netRole === 'host') status = `Fuera de servicio · repuesto en ${Math.ceil(this.respawnLeft(p))} s`;
    const sh = this.sharedHud();
    const alerts = this.allAlerts();
    const view = this.cameras.main.worldView;
    ui.updateArrows(alerts, { x: view.x, y: view.y, w: view.width, h: view.height }, this.cameras.main.zoom);
    return {
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina, o2: p.o2, status,
      night: this.cfg.night, mode: this.cfg.mode, modeLabel: sh.modeLabel,
      timeStr: sh.timeStr, subStr: sh.subStr, progress: sh.progress,
      clean: this.ship.hygiene, integrity: this.ship.integrity, power: this.ship.power, oxygen: this.ship.oxygen, morale: this.ship.morale, zeroG: this.ship.zeroG,
      contam: this.disease.globalContam(),
      credits: sh.credits,
      tool: p.tool, tools: p.tools, available: p.available, carrying: p.carrying, carryName: p.body?.name ?? null,
      tasks: this.missions.tasks, alerts, roomName: ROOM_NAMES[room], roomClean: this.dirt.roomClean(room), favors: this.favors,
      boss: sh.boss,
      roster: this.netRole === 'host' ? this.players.map((x) => (x.isLocal ? `${x.name} (tú)` : x.name)) : undefined,
    };
  }

  private modeLabel() {
    const c = this.cfg;
    if (c.mode === 'historia') return `NOCHE ${c.night}${this.mission ? ' · ' + this.mission.name.toUpperCase() : ' · USC DESASTRE'}`;
    if (c.mode === 'zen') return 'LIMPIEZA ZEN';
    if (c.mode === 'caos') return 'MODO CAOS';
    if (c.mode === 'desafio') return `DESAFÍO · ${(c.challengeName ?? '').toUpperCase()}`;
    return 'TURNO INFINITO';
  }

  private onPostRender() {
    if (!this.sys.isActive() && !this.sys.isPaused()) return;
    const cam = this.cameras.main;
    ui.labels.update(cam.worldView, cam.zoom);
  }

  endShift(reason: EndReason) {
    if (this.over && reason !== 'destroyed') return;
    if (this.stats.timeSurvived > 0) return;
    this.over = true;
    this.missions.finish(reason === 'time');
    this.stats.timeSurvived = Math.max(1, this.t);
    this.cleaning.stopLoops();
    audio.stopLoops();
    audio.setIntensity(0);
    audio.party = false;
    const report = buildReport(this, reason);
    this.hostSync?.endShift(report);
    const d = saves.data;
    d.credits = Math.max(0, d.credits + report.total);
    d.shifts++;
    const won = reason === 'time' || (reason === 'quit' && !this.cfg.duration);
    if (this.cfg.mode === 'historia' && reason === 'time') d.night = Math.max(d.night, this.cfg.night + 1);
    if (this.mission && reason === 'time' && !d.missionsDone.includes(this.mission.id)) d.missionsDone.push(this.mission.id);
    if (this.cfg.mode === 'desafio' && won && this.cfg.challenge && !d.missionsDone.includes(`c_${this.cfg.challenge}`)) d.missionsDone.push(`c_${this.cfg.challenge}`);
    if (this.stats.bossesDefeated && this.mission?.boss && !d.bosses.includes(this.mission.boss)) d.bosses.push(this.mission.boss);
    if (this.cfg.mode === 'infinito') d.bestInfinite = Math.max(d.bestInfinite, this.t);
    for (const a of this.stats.achievements) if (!d.achievements.includes(a)) d.achievements.push(a);
    this.saveMemory();
    const ups = saves.addXp(report.xp);
    d.history.push({ date: new Date().toISOString(), mode: this.cfg.mode, grade: report.grade, credits: report.total, night: this.cfg.night });
    if (d.history.length > 20) d.history.shift();
    d.lastSeed = this.cfg.seed;
    saves.save();
    ui.labels.clear();
    audio.sfx(report.grade === 'DESPEDIDO' ? 'error' : 'coin');
    const mode = this.cfg.mode;
    this.time.delayedCall(reason === 'time' ? 400 : 200, () => {
      ui.showEvaluation(report, ups,
        () => ui.handlers.start(mode === 'attract' ? 'historia' : mode, '', { challenge: this.cfg.challenge }),
        () => { ui.close(); this.scene.restart({ ...this.cfg }); },
        () => ui.handlers.toMenu());
    });
  }

  private cleanup() {
    this.iso?.destroy();
    this.iso = null;
    ui.labels.project = null;
    this.hostSync?.destroy();
    this.hostSync = null;
    this.clientSync?.destroy();
    this.clientSync = null;
    this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded, this);
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    this.scale.off('resize', this.applyZoom, this);
    this.panTimer?.remove();
    this.missions?.destroy();
    this.humor?.destroy();
    this.cleaning?.destroyAll();
    this.emerg?.destroyAll();
    this.combat?.destroyAll();
    this.bosses?.destroyAll();
    this.secrets?.destroyAll();
    for (const t of this.traps) t.sprite.destroy();
    for (const b of this.bots) b.sprite.destroy();
    this.traps = [];
    this.bots = [];
    audio.stopLoops();
    ui.labels.clear();
    bus.clear();
  }
}
