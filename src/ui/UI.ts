import { ICONS } from '../gfx/sprites';
import { characterSheet, CHAR_FRAMES } from '../gfx/characters';
import { WorldLabels } from './Labels';
import { Minimap } from './Minimap';
import { TouchControls } from './Touch';
import { mp, MP_AVAILABLE, shareLink } from '../net/Net';
import { VoiceChat } from '../net/Voice';
import { esc, fmtTime } from '../core/util';
import { TOOLS, TOOL_ORDER } from '../data/tools';
import { UPGRADES, SPECIALIZATIONS, type SpecId } from '../data/upgrades';
import { ROOM_NAMES } from '../data/rooms';
import { UNIFORM_COLORS, playerLook, type HatStyle } from '../data/crew';
import { CHALLENGES, MISSIONS, STORY } from '../data/missions';
import { CLORO } from '../data/lines';
import { NOTES } from '../systems/SecretsSystem';
import { ACHIEVEMENTS } from '../systems/HumorSystem';
import { audio } from '../systems/AudioManager';
import { saves } from '../systems/SaveManager';
import type { AlertInfo } from '../systems/EmergencySystem';
import type { Task } from '../systems/MissionManager';
import type { Report } from '../systems/Evaluation';
import type { ToolId, GameMode } from '../types';
import type { GameScene } from '../scenes/GameScene';
import type { ToolState } from '../entities/Player';

export interface HudState {
  hp: number; maxHp: number; stamina: number; o2: number; status: string;
  night: number; mode: GameMode; modeLabel: string; timeStr: string; subStr: string; progress: number;
  clean: number; integrity: number; power: number; oxygen: number; morale: number; zeroG: boolean; contam: number;
  credits: number;
  tool: ToolId; tools: Record<ToolId, ToolState>; available: ToolId[]; carrying: string | null; carryName: string | null;
  tasks: Task[]; alerts: AlertInfo[]; roomName: string; roomClean: number; favors: number;
  boss: { name: string; hp: number; hint: string; shield: boolean } | null;
  /** multijugador: conserjes de la sala */
  roster?: string[];
}

type Modal = 'menu' | 'brief' | 'pause' | 'eval' | 'shop' | 'ship' | 'map' | 'help' | 'mp' | 'lobby' | null;
export type StartMode = 'historia' | 'infinito' | 'zen' | 'caos' | 'desafio';

export interface UIHandlers {
  start: (mode: StartMode, seed: string, opts?: { challenge?: string }) => void;
  toMenu: () => void;
  /** multijugador */
  mpCreate: (name: string) => Promise<void>;
  mpJoin: (code: string, name: string) => Promise<void>;
  leaveRoom: () => void;
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const icon = (k: string, cls = '') => `<img class="px ${cls}" data-icon="${k}" src="${ICONS[k] ?? BLANK}" alt="">`;

/** Sombreros del vestuario y nivel necesario para desbloquearlos. */
const HATS: { id: HatStyle; name: string; level: number }[] = [
  { id: 'cap', name: 'Gorra reglamentaria', level: 1 },
  { id: 'beanie', name: 'Gorro de lana', level: 1 },
  { id: 'hardhat', name: 'Casco de obra', level: 2 },
  { id: 'helmet', name: 'Casco espacial', level: 3 },
  { id: 'medic', name: 'Gorro quirúrgico', level: 4 },
  { id: 'chef', name: 'Gorro de chef', level: 4 },
  { id: 'captain', name: 'Gorra de capitán', level: 6 },
  { id: 'alien', name: 'Antenas alienígenas', level: 8 },
];
const UNIFORM_LEVEL: Record<string, number> = { amarillo: 1, naranja: 1, menta: 2, rosa: 3, violeta: 5 };

/** Capa de interfaz en DOM (nítida a cualquier escala): HUD, menús y paneles. */
export class UI {
  root = document.getElementById('ui')!;
  labels = new WorldLabels(document.getElementById('labels')!);
  scene: GameScene | null = null;
  handlers!: UIHandlers;
  modal: Modal = null;
  pinned: string | null = null;
  touch!: TouchControls;
  private hud!: HTMLElement;
  private $: Record<string, HTMLElement> = {};
  private minimap!: Minimap;
  private overlay!: HTMLElement;
  private msgQueue: { text: string; sev: number }[] = [];
  private msgBusy = false;
  private lastRoom = '';
  private tasksCollapsed = false;
  private flashEl!: HTMLElement;
  private vignette!: HTMLElement;
  private toastsEl!: HTMLElement;
  private arrowsEl!: HTMLElement;
  private bigMap: Minimap | null = null;
  private lastAlertsKey = '';
  private lastTasksKey = '';
  private lastToolsKey = '';
  private alertsCollapsed = false;

  constructor() {
    this.buildHud();
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.touch = new TouchControls(this.root, () => this.scene, { map: () => this.toggleMap(), pause: () => this.pauseFromOutside() });
    this.applySettings();
    // pausa automática al cambiar de pestaña o de ventana
    const autoPause = () => { if (saves.data.settings.autoPause) this.pauseFromOutside(); };
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  }

  /** Escala de la interfaz y modo táctil según las opciones guardadas. */
  applySettings() {
    const s = saves.data.settings;
    document.documentElement.style.setProperty('--ui', String(s.uiScale || 1));
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const on = s.touch === 'on' || (s.touch === 'auto' && coarse);
    this.touch?.setEnabled(on);
    this.hud.classList.toggle('touchmode', on);
    if (this.scene) this.touch?.setVisible(!this.hud.classList.contains('hidden'));
  }

  private inGame() {
    const sc = this.scene;
    return !!sc && sc.started && !sc.over && sc.cfg.mode !== 'attract';
  }

  pauseFromOutside() {
    if (!this.inGame() || this.modal) return;
    // multijugador: cambiar de ventana no pausa (la nave es compartida); solo se sueltan los controles
    if (this.scene!.netRole !== 'solo') { this.scene!.releaseInput(); return; }
    this.scene!.setPaused(true);
    this.showPause();
  }

  // ───────────────────────── HUD ─────────────────────────

  private buildHud() {
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="vignette"></div>
        <div class="flash"></div>
        <div class="hud-tl panel">
          ${icon('mop13', 'portrait')}
          <div class="bars">
            <div class="bar hp"><span class="lbl">SALUD</span><div class="track"><i data-k="hp"></i></div></div>
            <div class="bar st"><span class="lbl">RESIST.</span><div class="track"><i data-k="st"></i></div></div>
            <div class="bar o2" data-k="o2row"><span class="lbl">OXÍGENO</span><div class="track"><i data-k="o2"></i></div></div>
            <div class="status" data-k="status"></div>
          </div>
        </div>
        <div class="clock panel">
          <div class="night" data-k="night"></div>
          <div class="time" data-k="time">22:00</div>
          <div class="sub" data-k="sub"></div>
          <div class="prog"><i data-k="prog"></i></div>
          <div class="zerog hidden" data-k="zerog">GRAVEDAD CERO</div>
          <div class="mp-roster hidden" data-k="roster"></div>
          <button class="mic-btn hidden" data-k="mic" title="Chat de voz · V"></button>
        </div>
        <div class="bossbar panel hidden" data-k="boss">
          <div class="bn">${icon('boss')}<span data-k="bossname"></span><b data-k="bossshield">ESCUDO</b></div>
          <div class="btrack"><i data-k="bosshp"></i></div>
          <div class="bh" data-k="bosshint"></div>
        </div>
        <div class="ship panel">
          ${['clean:Limpieza', 'integrity:Integridad', 'power:Energía', 'oxygen:Oxígeno', 'morale:Moral', 'contam:Contagio']
            .map((s) => { const [k, l] = s.split(':'); return `<div class="row" data-k="row_${k}"><span>${l.toUpperCase()}</span><div class="track"><i data-k="s_${k}"></i></div><b data-k="v_${k}"></b></div>`; }).join('')}
          <div class="credits"><span>${icon('coin')}CRÉDITOS (EST.)</span><span data-k="credits">0</span></div>
        </div>
        <div class="hud-tasks panel" data-k="tasks"></div>
        <div class="hud-alerts" data-k="alerts"></div>
        <div class="hud-tools panel">
          <div class="slots">${TOOL_ORDER.map((t) => `<div class="slot" data-slot="${t}"><span class="k"></span>${icon(t)}<div class="cap"><i></i></div></div>`).join('')}</div>
          <div class="toolinfo"><div class="n" data-k="toolname"></div><div class="d" data-k="tooldesc"></div><div class="carry" data-k="carry"></div></div>
        </div>
        <div class="hud-minimap panel" data-k="mm" title="Mapa [M]"><canvas data-k="mmc"></canvas><div class="room-name" data-k="room"></div></div>
        <div class="hud-msg idle" data-k="msg">${icon('cloro')}<div><div class="who">CL-0R0 · SUPERVISIÓN</div><div class="txt" data-k="msgtxt"></div></div></div>
        <div class="banner" data-k="banner"></div>
        <div class="toasts"></div>
        <div data-k="arrows"></div>
      </div>
      <div id="overlay"></div>`;
    this.hud = this.root.querySelector('#hud')!;
    this.overlay = this.root.querySelector('#overlay')!;
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (this.$[el.dataset.k!] = el));
    this.flashEl = this.hud.querySelector('.flash')!;
    this.vignette = this.hud.querySelector('.vignette')!;
    this.toastsEl = this.hud.querySelector('.toasts')!;
    this.arrowsEl = this.$.arrows;
    this.minimap = new Minimap(this.$.mmc as HTMLCanvasElement, 3);
    this.$.mm.style.pointerEvents = 'auto';
    this.$.mm.addEventListener('click', () => this.toggleMap());
    // micrófono del HUD: activar, silenciar (modo abierto) o mantener pulsado para hablar
    const mic = this.$.mic;
    mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const v = mp.voice;
      if (!v) return;
      if (!v.enabled) { void v.enable(); return; }
      if (v.settings.mode === 'ptt') { try { mic.setPointerCapture(e.pointerId); } catch { /* */ } v.setPtt(true); }
      else v.toggleMute();
    });
    const up = () => { if (mp.voice?.settings.mode === 'ptt') mp.voice.setPtt(false); };
    mic.addEventListener('pointerup', up);
    mic.addEventListener('pointercancel', up);
    this.$.tasks.addEventListener('click', () => this.toggleTasks());
    this.hud.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      el.style.pointerEvents = 'auto';
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const sc = this.scene;
        if (sc && sc.started && !sc.over) sc.player.setTool(el.dataset.slot as ToolId);
      });
    });
    this.$.alerts.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.ahdr')) {
        this.alertsCollapsed = !this.alertsCollapsed;
        this.lastAlertsKey = '';
        audio.sfx('click');
        return;
      }
      const el = (e.target as HTMLElement).closest('.alert') as HTMLElement | null;
      if (!el) return;
      const id = el.dataset.id!;
      this.pinned = this.pinned === id ? null : id;
      audio.sfx('click');
      this.lastAlertsKey = '';
    });
  }

  /** Rellena los iconos del HUD una vez generadas las texturas. */
  refreshIcons() {
    this.root.querySelectorAll<HTMLImageElement>('img[data-icon]').forEach((img) => {
      const src = ICONS[img.dataset.icon!];
      if (src) img.src = src;
    });
  }

  attach(scene: GameScene) {
    this.scene = scene;
    this.minimap.setMap(scene.map);
    this.pinned = null;
    this.lastRoom = '';
    this.msgQueue = [];
    this.lastAlertsKey = '';
    this.lastTasksKey = '';
    this.lastToolsKey = '';
    this.labels.clear();
    this.applySettings();
  }

  showHud(on: boolean) {
    this.hud.classList.toggle('hidden', !on);
    this.touch?.setVisible(on);
  }

  private bar(k: string, v: number) {
    const el = this.$[k];
    if (el) el.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
  }

  private shipRow(k: string, v: number, color: string) {
    const i = this.$[`s_${k}`];
    i.style.width = `${Math.round(v)}%`;
    i.style.background = color;
    const b = this.$[`v_${k}`];
    b.textContent = `${Math.round(v)}%`;
    b.style.color = color;
  }

  updateHud(s: HudState) {
    this.bar('hp', s.hp / s.maxHp);
    this.bar('st', s.stamina / 100);
    this.bar('o2', s.o2 / 100);
    this.$.o2row.classList.toggle('hidden', s.o2 >= 99.5 && s.oxygen > 30);
    this.$.status.textContent = s.status;
    this.$.night.textContent = s.modeLabel;
    this.$.time.textContent = s.timeStr;
    this.$.sub.textContent = s.subStr;
    (this.$.prog as HTMLElement).style.width = `${Math.round(s.progress * 100)}%`;
    this.$.zerog.classList.toggle('hidden', !s.zeroG);
    const col = (v: number) => (v >= 70 ? '#5dff9b' : v >= 40 ? '#ffd23f' : '#ff4d5a');
    this.shipRow('clean', s.clean, col(s.clean));
    this.shipRow('integrity', s.integrity, col(s.integrity));
    this.shipRow('power', s.power, col(s.power));
    this.shipRow('oxygen', s.oxygen, s.oxygen >= 60 ? '#4ff0ff' : col(s.oxygen));
    this.shipRow('morale', s.morale, col(s.morale));
    this.$.row_contam.classList.toggle('hidden', s.contam < 1);
    if (s.contam >= 1) this.shipRow('contam', s.contam, s.contam > 50 ? '#ff4d5a' : '#b8e04a');
    this.$.credits.textContent = `${s.credits}`;
    const rosterTxt = s.roster?.length ? `SALA ${mp.session?.code ?? ''} · ${s.roster.join(' · ')}` : '';
    this.$.roster.classList.toggle('hidden', !rosterTxt);
    if (this.$.roster.textContent !== rosterTxt) this.$.roster.textContent = rosterTxt;
    this.renderMicButton();
    // jefe
    this.$.boss.classList.toggle('hidden', !s.boss);
    if (s.boss) {
      this.$.bossname.textContent = s.boss.name.toUpperCase();
      this.$.bossshield.classList.toggle('hidden', !s.boss.shield);
      (this.$.bosshp as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, s.boss.hp)).toFixed(3)})`;
      this.$.bosshint.textContent = s.boss.hint;
    }
    // herramientas (solo las disponibles, numeradas en orden)
    const toolsKey = s.available.join(',');
    if (toolsKey !== this.lastToolsKey) {
      this.lastToolsKey = toolsKey;
      for (const t of TOOL_ORDER) {
        const el = this.hud.querySelector<HTMLElement>(`[data-slot="${t}"]`)!;
        const i = s.available.indexOf(t);
        el.classList.toggle('hidden', i < 0);
        el.querySelector('.k')!.textContent = i >= 0 ? String(i + 1) : '';
      }
    }
    for (const t of s.available) {
      const el = this.hud.querySelector<HTMLElement>(`[data-slot="${t}"]`)!;
      const st = s.tools[t];
      el.classList.toggle('on', s.tool === t);
      el.classList.toggle('broken', st.broken);
      const fill = el.querySelector<HTMLElement>('.cap i')!;
      const v = st.charge / st.cap;
      const tankLike = t === 'fregona' || t === 'superfregona' || t === 'aspiradora';
      fill.style.width = `${Math.round(v * 100)}%`;
      fill.style.background = tankLike ? (v > 0.85 ? '#ff4d5a' : v > 0.6 ? '#ffd23f' : '#5dff9b') : (v < 0.2 ? '#ff4d5a' : '#4ff0ff');
    }
    const ts = s.tools[s.tool];
    const def = TOOLS[s.tool];
    this.$.toolname.textContent = def.name.toUpperCase();
    const amount = s.tool === 'trampa' || s.tool === 'robot' ? `${Math.round(ts.charge)}` : `${Math.round((ts.charge / ts.cap) * 100)} %`;
    this.$.tooldesc.textContent = `${def.capacityLabel}: ${amount} · Estado: ${Math.round(ts.dur)} %  ·  [Q] cambiar`;
    this.$.carry.textContent = s.carrying === 'body' ? `Llevas a ${s.carryName ?? 'un tripulante'} → cápsula médica (enfermería)` : s.carrying ? 'Llevas una bolsa de basura → vertedero del pasillo' : '';
    // sala actual
    this.$.room.textContent = `${s.roomName.toUpperCase()} · ${Math.round(s.roomClean)} %`;
    if (s.roomName !== this.lastRoom) {
      this.lastRoom = s.roomName;
      const b = this.$.banner;
      b.innerHTML = `${esc(s.roomName.toUpperCase())}<small>LIMPIEZA ${Math.round(s.roomClean)} %</small>`;
      b.style.opacity = '1';
      clearTimeout((b as any)._t);
      (b as any)._t = setTimeout(() => (b.style.opacity = '0'), 1800);
    }
    this.renderTasks(s.tasks, s.favors);
    this.renderAlerts(s.alerts);
    const severe = s.alerts.some((a) => a.sev === 3 && !a.by);
    this.vignette.classList.toggle('on', severe);
    this.vignette.classList.toggle('calm', saves.data.settings.reduceFx);
    if (this.scene) this.minimap.draw(this.scene, s.alerts, this.pinned);
    if (this.bigMap && this.scene && this.modal === 'map') this.bigMap.draw(this.scene, s.alerts, this.pinned);
  }

  setTasksCollapsed(v: boolean) {
    this.tasksCollapsed = v;
    this.lastTasksKey = '';
  }

  private renderTasks(tasks: Task[], favors: number) {
    const key = tasks.map((t) => `${t.id}${t.progress}${t.target}${t.done}${t.failed}`).join('|') + favors + this.tasksCollapsed;
    if (key === this.lastTasksKey) return;
    this.lastTasksKey = key;
    const el = this.$.tasks;
    el.classList.toggle('collapsed', this.tasksCollapsed);
    const done = tasks.filter((t) => t.done).length;
    if (this.tasksCollapsed) {
      const next = tasks.find((t) => !t.done && !t.failed && t.kind !== 'survive');
      el.innerHTML = `<h4>TAREAS ${done}/${tasks.length} <small>[TAB] VER</small></h4>${next ? `<div class="next">▸ ${esc(next.title)}</div>` : ''}`;
      return;
    }
    const rows = tasks.map((t) => {
      const pr = t.pct ? `${t.progress}/${t.target}%` : t.kind === 'survive' ? '' : `${t.progress}/${t.target}`;
      return `<div class="task ${t.done ? 'done' : ''} ${t.failed ? 'failed' : ''}"><div class="box"></div><div>${esc(t.title)}</div><div class="pr">${pr}</div></div>`;
    }).join('');
    el.innerHTML = `<h4>TAREAS ${done}/${tasks.length} <small>[TAB] OCULTAR</small></h4>${rows}
      <div class="tip">Favores: ${favors} · acércate a un tripulante y pulsa [E].</div>`;
  }

  private renderAlerts(alerts: AlertInfo[]) {
    const sorted = alerts.slice().sort((a, b) => (b.id === this.pinned ? 9 : 0) - (a.id === this.pinned ? 9 : 0) || (a.by ? 1 : 0) - (b.by ? 1 : 0) || b.sev - a.sev);
    const shown = this.alertsCollapsed ? [] : sorted.slice(0, 4);
    const key = sorted.map((a) => `${a.id}${a.title}${a.timer ? Math.ceil(a.timer) : ''}${a.room}${a.by ?? ''}`).join('|') + this.pinned + this.alertsCollapsed;
    if (key === this.lastAlertsKey) return;
    this.lastAlertsKey = key;
    if (!sorted.length) { this.$.alerts.innerHTML = ''; return; }
    const worst = Math.max(...sorted.map((a) => a.sev));
    const head = `<div class="ahdr sev${worst}"><span>ALERTAS <b>${sorted.length}</b></span>
      ${this.alertsCollapsed ? `<span class="icons">${sorted.slice(0, 7).map((a) => icon(a.icon)).join('')}</span>` : ''}
      <small>${this.alertsCollapsed ? '▾' : '▴'}</small></div>`;
    const rows = shown.map((a) => {
      const pinned = a.id === this.pinned;
      return `<div class="alert sev${a.sev} ${pinned ? 'pinned' : ''} ${a.by ? 'handled' : ''}" data-id="${esc(a.id)}" title="${esc(a.risk ?? '')}">
        ${icon(a.icon)}
        <div class="body"><div class="t">${esc(a.title)}</div><div class="r">${esc(ROOM_NAMES[a.room])}${pinned ? ' · <span class="pin">PRIORIDAD</span>' : ''}</div>
          ${a.by ? `<div class="by">Atendido por ${esc(a.by)}</div>` : ''}${pinned && a.risk ? `<div class="risk">${esc(a.risk)}</div>` : ''}</div>
        <div class="tm">${a.timer !== undefined ? fmtTime(a.timer) : ''}</div>
      </div>`;
    }).join('');
    const more = !this.alertsCollapsed && sorted.length > shown.length ? `<div class="amore">+${sorted.length - shown.length} más · ver mapa [M]</div>` : '';
    this.$.alerts.innerHTML = head + rows + more;
  }

  /** Flechas en el borde de la pantalla hacia incidencias prioritarias fuera de vista. */
  updateArrows(alerts: AlertInfo[], view: { x: number; y: number; w: number; h: number }, zoom: number) {
    const targets = alerts.filter((a) => (a.id === this.pinned || (a.sev === 3 && !a.by)) && (a.x || a.y)).slice(0, 3);
    const W = window.innerWidth, H = window.innerHeight;
    const html: string[] = [];
    const p = this.scene?.player;
    for (const a of targets) {
      const pr = this.labels.project ? this.labels.project(a.x, a.y) : null;
      const sx = pr ? pr.x : (a.x - view.x) * zoom, sy = pr ? pr.y : (a.y - view.y) * zoom;
      if (sx > 40 && sy > 40 && sx < W - 40 && sy < H - 40) continue;
      const cx = W / 2, cy = H / 2;
      const ang = Math.atan2(sy - cy, sx - cx);
      const m = 60;
      const t = Math.min(Math.abs((W / 2 - m) / Math.cos(ang)), Math.abs((H / 2 - m) / Math.sin(ang)));
      const ax = cx + Math.cos(ang) * t, ay = cy + Math.sin(ang) * t;
      const col = a.id === this.pinned ? '#ffd23f' : '#ff4d5a';
      const dist = p ? Math.round(Math.hypot(a.x - p.x, a.y - p.y) / 16) : 0;
      html.push(`<div class="arrow" style="left:${ax}px;top:${ay}px">
        <svg class="tri" viewBox="0 0 34 34" style="transform:rotate(${ang}rad)"><polygon points="33,17 20,7 20,27" fill="${col}" stroke="#000" stroke-width="2"/><rect x="3" y="7" width="20" height="20" fill="#0d0b1d" stroke="${col}" stroke-width="2"/></svg>
        ${icon(a.icon)}<span class="dist">${dist} m</span></div>`);
    }
    const s = html.join('');
    if (this.arrowsEl.innerHTML !== s) this.arrowsEl.innerHTML = s;
  }

  // ───────────────────────── mensajes ─────────────────────────

  message(text: string, sev = 1) {
    if (sev >= 3) this.msgQueue.unshift({ text, sev });
    else this.msgQueue.push({ text, sev });
    if (this.msgQueue.length > 4) this.msgQueue.length = 4;
    if (!this.msgBusy) this.nextMsg();
  }

  private nextMsg() {
    const m = this.msgQueue.shift();
    const box = this.$.msg;
    if (!m) { this.msgBusy = false; box.classList.add('idle'); return; }
    this.msgBusy = true;
    audio.sfx('chime');
    box.classList.remove('idle');
    box.classList.toggle('sev3', m.sev >= 3);
    const txt = this.$.msgtxt;
    let i = 0;
    clearInterval((txt as any)._iv);
    (txt as any)._iv = setInterval(() => {
      i += 2;
      txt.textContent = m.text.slice(0, i);
      if (i >= m.text.length) clearInterval((txt as any)._iv);
    }, 22);
    setTimeout(() => this.nextMsg(), Math.max(3800, m.text.length * 55));
  }

  toast(text: string, ic = 'task') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon(ic === 'achievement' ? 'coin' : ic)}<span>${esc(text)}</span>`;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 3900);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove();
  }

  removeLabel(id: string) { this.labels.hide(id); }

  flash(color: number) {
    if (saves.data.settings.reduceFx) return;
    this.flashEl.style.background = `#${color.toString(16).padStart(6, '0')}`;
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = '0.28';
    setTimeout(() => { this.flashEl.style.transition = 'opacity 0.5s'; this.flashEl.style.opacity = '0'; }, 30);
  }

  // ───────────────────────── modales ─────────────────────────

  private open(modal: Modal, html: string, dim = true) {
    this.modal = modal;
    this.overlay.innerHTML = `<div class="screen ${dim ? 'dim' : ''}">${html}</div>`;
    const first = this.overlay.querySelector<HTMLElement>('button.primary, button');
    first?.focus({ preventScroll: true });
    this.touch?.setVisible(false);
  }

  close() {
    this.modal = null;
    this.overlay.innerHTML = '';
    this.bigMap = null;
    this.touch?.setVisible(!this.hud.classList.contains('hidden'));
  }

  private on(sel: string, fn: (el: HTMLElement) => void) {
    this.overlay.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => { audio.sfx('click'); fn(el); }));
  }

  private volumeControls(): string {
    const s = saves.data.settings;
    return `<div class="vol">
      <span>General</span><input type="range" min="0" max="1" step="0.05" value="${s.master}" data-vol="master">
      <span>Música</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-vol="music">
      <span>Efectos</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-vol="sfx">
      <label class="chk"><input type="checkbox" data-k="reduce" ${s.reduceFx ? 'checked' : ''}> Reducir efectos visuales intensos (destellos, temblores)</label>
    </div>`;
  }

  private bindVolume() {
    this.overlay.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.vol as 'master' | 'music' | 'sfx';
      saves.data.settings[k] = parseFloat(el.value);
      audio.setVolumes({ [k]: saves.data.settings[k] });
      saves.save();
    }));
    const chk = this.overlay.querySelector<HTMLInputElement>('[data-k="reduce"]');
    chk?.addEventListener('change', () => { saves.data.settings.reduceFx = chk.checked; saves.save(); if (this.scene) this.scene.fx.reduced = chk.checked; });
  }

  /** Nombre de la próxima noche del modo Historia. */
  private nextNightName(): string {
    const n = saves.data.night;
    const m = STORY[(n - 1) % STORY.length]?.mission;
    const id = n > STORY.length ? STORY[1 + ((n - 2) % (STORY.length - 1))].mission : m;
    return id ? MISSIONS[id].name : 'Turno de prueba';
  }

  showMenu() {
    const d = saves.data;
    this.showHud(false);
    const specOk = d.level >= 5;
    this.open('menu', `
      <div class="card menu">
        <div class="subtitle">USC DESASTRE · DEPARTAMENTO DE LIMPIEZA</div>
        <div class="logo">MOP-13</div>
        <div class="subtitle">TURNO DE NOCHE EN EL ESPACIO</div>
        <div class="tagline">«Puedes salvar la galaxia, pero si no has fregado el comedor, no cobrarás las horas extra.»</div>
        <div class="menu-grid">
          <button class="primary wide" data-act="story">Historia · Noche ${d.night}<small>${esc(this.nextNightName())}</small></button>
          <button class="wide mp-btn" data-act="mp">Multijugador cooperativo<small>${mp.session?.code ? `En la sala ${mp.session.code} · volver a la sala` : 'Hasta 4 conserjes en la misma nave compartiendo un código'}</small></button>
          <button data-act="infinite">Turno infinito<small>Récord ${fmtTime(d.bestInfinite)}</small></button>
          <button data-act="zen">Limpieza zen<small>Sin emergencias graves</small></button>
          <button data-act="chaos">Modo caos<small>Todo, a la vez</small></button>
          <button data-act="challenges">Desafíos<small>${d.missionsDone.filter((x) => x.startsWith('c_')).length}/${CHALLENGES.length} superados</small></button>
          <button data-act="shop">Taquilla de mejoras<small>${d.credits} créditos</small></button>
          <button data-act="wardrobe">Vestuario<small>Uniforme y gorro</small></button>
          <button data-act="spec" ${specOk ? '' : 'disabled'}>Especialización<small>${specOk ? (d.spec ? SPECIALIZATIONS[d.spec].name : 'Sin elegir') : 'Nivel 5'}</small></button>
          <button data-act="secrets">Archivo secreto<small>${this.secretCount()} hallazgos</small></button>
          <button data-act="badges">Logros<small>${d.achievements.length}/${Object.keys(ACHIEVEMENTS).length}</small></button>
          <button data-act="options">Opciones</button>
          <button data-act="help">Cómo se juega</button>
        </div>
        <div class="seed-row"><span>Semilla de la nave</span><input data-k="seed" maxlength="12" placeholder="ALEATORIA" value=""></div>
        <div class="profile">NIVEL <b>${d.level}</b> · XP <b>${d.xp}/${saves.xpForLevel(d.level)}</b> · TURNOS <b>${d.shifts}</b></div>
        <div class="foot">${this.touch.enabled ? 'Joystick izquierdo: mover · Joystick derecho: apuntar y usar · E: interactuar' : 'WASD mover · Clic/Espacio usar · E interactuar · Q/1-8 herramientas · M mapa'}</div>
      </div>`, false);
    const seed = () => (this.overlay.querySelector<HTMLInputElement>('[data-k="seed"]')?.value ?? '').trim().toUpperCase();
    this.on('[data-act="story"]', () => this.handlers.start('historia', seed()));
    this.on('[data-act="infinite"]', () => this.handlers.start('infinito', seed()));
    this.on('[data-act="zen"]', () => this.handlers.start('zen', seed()));
    this.on('[data-act="chaos"]', () => this.handlers.start('caos', seed()));
    this.on('[data-act="challenges"]', () => this.showChallenges(seed()));
    this.on('[data-act="shop"]', () => this.showShop());
    this.on('[data-act="wardrobe"]', () => this.showWardrobe());
    this.on('[data-act="spec"]', () => this.showSpecs());
    this.on('[data-act="secrets"]', () => this.showSecrets());
    this.on('[data-act="options"]', () => this.showOptions(() => this.showMenu()));
    this.on('[data-act="help"]', () => this.showHelp(() => this.showMenu()));
    this.on('[data-act="badges"]', () => this.showBadges());
    this.on('[data-act="mp"]', () => (mp.session?.code ? this.showLobby() : this.showMultiplayer()));
  }

  // ───────────────────────── multijugador ─────────────────────────

  private mpName(): string {
    try { return localStorage.getItem('mop13-mpname') || ''; } catch { return ''; }
  }

  private saveMpName(n: string) {
    try { localStorage.setItem('mop13-mpname', n); } catch { /* sin almacenamiento */ }
  }

  /** Pantalla para crear una sala o unirse con un código. */
  showMultiplayer(code = '', error = '') {
    if (!MP_AVAILABLE) {
      this.open('mp', `<div class="card mp"><h2>MULTIJUGADOR COOPERATIVO</h2>
        <p>El multijugador necesita el servidor (versión Hostinger).</p>
        <p style="color:var(--muted)">Esta versión es una página estática sin servidor. Publica el juego con el paquete de Node.js y comparte el enlace de tu dominio.</p>
        <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
      this.on('[data-act="back"]', () => this.showMenu());
      return;
    }
    const name = this.mpName() || `MOP-${Math.floor(10 + Math.random() * 89)}`;
    this.open('mp', `<div class="card mp"><h2>MULTIJUGADOR COOPERATIVO</h2>
      <p style="color:var(--muted)">Hasta 4 conserjes en la misma nave. El anfitrión crea la sala y comparte el código; la tripulación, los bichos y las emergencias son los mismos para todos.</p>
      <div class="mp-row"><label>Tu nombre</label><input data-k="name" maxlength="16" value="${esc(name)}"></div>
      <div class="mp-cols">
        <div class="mp-box"><h3>CREAR SALA</h3><p>Serás el anfitrión: tu ordenador simula la nave.</p>
          <button class="primary" data-act="create">Crear sala</button></div>
        <div class="mp-box"><h3>UNIRSE</h3><p>Escribe el código que te han pasado.</p>
          <input class="mp-code" data-k="code" maxlength="5" placeholder="ABCDE" value="${esc(code)}" autocomplete="off" spellcheck="false">
          <button data-act="join">Unirse</button></div>
      </div>
      <div class="mp-status ${error ? 'err' : ''}" data-k="mpstatus">${esc(error)}</div>
      <div class="row-btns"><button data-act="back">Volver</button></div></div>`);
    const $ = (k: string) => this.overlay.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!;
    const status = (t: string, err = false) => { const el = $('mpstatus'); el.textContent = t; el.classList.toggle('err', err); };
    const getName = () => { const n = $('name').value.trim().slice(0, 16) || name; this.saveMpName(n); return n; };
    const busy = (b: boolean) => this.overlay.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = b));
    $('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    this.on('[data-act="back"]', () => this.showMenu());
    this.on('[data-act="create"]', async () => {
      busy(true); status('Conectando con el servidor…');
      try { await this.handlers.mpCreate(getName()); } catch (e) { busy(false); status((e as Error).message || 'No se pudo crear la sala.', true); }
    });
    this.on('[data-act="join"]', async () => {
      const c = $('code').value.trim();
      if (c.length !== 5) { status('El código tiene 5 caracteres.', true); return; }
      busy(true); status('Buscando la sala…');
      try { await this.handlers.mpJoin(c, getName()); } catch (e) { busy(false); status((e as Error).message || 'No se pudo entrar.', true); }
    });
    if (code.length === 5) $('code').focus();
  }

  /** Sala de espera: código grande, enlace y lista de conserjes. */
  showLobby() {
    const s = mp.session;
    if (!s?.code) { this.showMultiplayer(); return; }
    const host = s.isHost;
    const peers = [...s.peers.values()].sort((a, b) => a.pid - b.pid);
    const link = shareLink(s.code);
    this.open('lobby', `<div class="card mp lobby"><h2>SALA DE CONSERJES</h2>
      <div class="mp-codebig" title="Código de la sala">${esc(s.code)}</div>
      <div class="mp-link"><input data-k="link" readonly value="${esc(link)}"><button data-act="copy">Copiar enlace</button></div>
      <h3>CONSERJES (${peers.length}/4)</h3>
      <ul class="mp-peers">${peers.map((p) => `<li data-pid="${p.pid}" class="${mp.voice?.speaking(p.pid) ? 'talk' : ''}"><i style="background:${esc(UNIFORM_COLORS[p.look?.uniform]?.top ?? '#ffcf33')}"></i>${esc(p.name)}${p.host ? ' <b>ANFITRIÓN</b>' : ''}${p.pid === s.pid ? ' <small>(tú)</small>' : ''}<span class="vstate">${this.peerVoiceTag(p.pid)}</span></li>`).join('')}</ul>
      <div class="voice-box" data-voice>${this.voiceInner()}</div>
      ${host
        ? `<h3>MODO</h3><div class="mp-modes">
            <button class="primary" data-mode="historia">Historia · Noche ${saves.data.night}</button>
            <button data-mode="infinito">Turno infinito</button><button data-mode="zen">Limpieza zen</button><button data-mode="caos">Modo caos</button></div>
            <p style="color:var(--muted)">Puedes empezar solo: quien se una después entrará directamente en la nave.</p>`
        : '<p class="mp-wait">Esperando a que el anfitrión empiece el turno…</p>'}
      <div class="row-btns"><button data-act="leave">Salir de la sala</button><button data-act="menu">Menú</button></div></div>`);
    this.on('[data-act="copy"]', () => {
      const inp = this.overlay.querySelector<HTMLInputElement>('[data-k="link"]')!;
      const done = () => this.toast('Enlace copiado. Pásaselo a tu tripulación.', 'task');
      try { navigator.clipboard.writeText(link).then(done, () => { inp.select(); document.execCommand('copy'); done(); }); }
      catch { inp.select(); document.execCommand('copy'); done(); }
    });
    this.on('[data-mode]', (el) => this.handlers.start(el.dataset.mode as StartMode, ''));
    this.on('[data-act="leave"]', () => this.handlers.leaveRoom());
    this.on('[data-act="menu"]', () => this.showMenu());
    this.bindVoice();
  }

  /** la lista de la sala cambia: si está abierta, se redibuja */
  onRoomChange() { if (this.modal === 'lobby') this.showLobby(); }

  // ───────────────────────── chat de voz ─────────────────────────

  private peerVoiceTag(pid: number): string {
    const v = mp.voice;
    if (!v) return '';
    if (pid === mp.session?.pid) return v.enabled ? (v.micOk ? (v.transmitting ? 'MIC' : 'SILENCIO') : 'ESCUCHA') : '';
    if (!v.members.has(pid)) return '';
    const st = v.linkState(pid);
    return st === 'conectado' ? 'VOZ' : st === 'sin conexión' ? 'SIN VOZ' : v.enabled ? '···' : 'EN VOZ';
  }

  /** contenido del panel de voz (sala de espera y pausa) */
  private voiceInner(): string {
    const v = mp.voice;
    if (!v) return '';
    if (!VoiceChat.supported) return '<h3>VOZ</h3><p class="vnote">Este navegador no permite el chat de voz.</p>';
    const set = v.settings;
    const others = [...v.links.values()];
    const status = !v.enabled
      ? 'Desactivado. Nadie te oye y tú no oyes a nadie.'
      : !v.micOk ? (v.micError || 'Solo escuchas.')
      : set.mode === 'ptt' ? (v.ptt ? 'Hablando…' : 'Mantén pulsada V (o el botón del micrófono) para hablar.')
      : v.muted ? 'Micrófono silenciado. Pulsa V para volver a hablar.' : 'Micrófono abierto. Pulsa V para silenciarlo.';
    const failed = others.some((l) => l.state === 'sin conexión');
    return `<h3>VOZ</h3>
      <div class="vrow">
        <button data-v="toggle" class="${v.enabled ? '' : 'primary'}">${v.enabled ? 'Salir del chat de voz' : 'Activar micrófono'}</button>
        ${v.enabled && !v.micOk && VoiceChat.secure ? '<button data-v="retry">Volver a pedir el micrófono</button>' : ''}
      </div>
      <p class="vnote ${v.enabled && !v.micOk ? 'warn' : ''}">${esc(status)}</p>
      ${!VoiceChat.secure ? '<p class="vnote warn">El navegador solo deja usar el micrófono en páginas HTTPS (o en localhost).</p>' : ''}
      <div class="vol vgrid">
        <span>Modo</span><select data-v="mode">
          <option value="open" ${set.mode === 'open' ? 'selected' : ''}>Micrófono abierto (V silencia)</option>
          <option value="ptt" ${set.mode === 'ptt' ? 'selected' : ''}>Pulsar V para hablar</option></select>
        <span>Volumen de voces</span><input type="range" min="0" max="1" step="0.05" value="${set.volume}" data-v="vol">
        <label class="chk"><input type="checkbox" data-v="prox" ${set.proximity ? 'checked' : ''}> Voz por proximidad: a quien está lejos en la nave se le oye más bajo</label>
      </div>
      ${v.enabled && others.length ? `<p class="vnote">Conexiones: ${others.map((l) => `${esc(mp.session?.peers.get(l.pid)?.name ?? '?')} · ${l.state}`).join(' · ')}</p>` : ''}
      ${failed ? '<p class="vnote warn">Alguna conexión directa ha fallado (redes muy cerradas). El servidor admite un TURN propio: mira el README.</p>' : ''}`;
  }

  private bindVoice() {
    const box = this.overlay.querySelector<HTMLElement>('[data-voice]');
    const v = mp.voice;
    if (!box || !v) return;
    box.querySelector('[data-v="toggle"]')?.addEventListener('click', () => { audio.sfx('click'); if (v.enabled) v.disable(); else void v.enable(); });
    box.querySelector('[data-v="retry"]')?.addEventListener('click', () => { audio.sfx('click'); void v.openMic(); });
    const mode = box.querySelector<HTMLSelectElement>('[data-v="mode"]');
    mode?.addEventListener('change', () => { v.settings.mode = mode.value as 'open' | 'ptt'; v.ptt = false; v.muted = false; v.saveSettings(); });
    const vol = box.querySelector<HTMLInputElement>('[data-v="vol"]');
    vol?.addEventListener('input', () => { v.settings.volume = parseFloat(vol.value); v.saveSettings(); });
    const prox = box.querySelector<HTMLInputElement>('[data-v="prox"]');
    prox?.addEventListener('change', () => { v.settings.proximity = prox.checked; v.saveSettings(); });
  }

  /** el estado del chat de voz cambió: se refresca el panel (sin tocar lo que se está arrastrando) */
  onVoiceChange() {
    this.renderMicButton();
    const box = this.overlay.querySelector<HTMLElement>('[data-voice]');
    // si el jugador está tocando un control del panel (deslizador, desplegable) no se redibuja bajo su dedo
    const busy = box?.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName !== 'BUTTON';
    if (box && !busy) { box.innerHTML = this.voiceInner(); this.bindVoice(); }
    this.overlay.querySelectorAll<HTMLElement>('.mp-peers li[data-pid]').forEach((li) => {
      const tag = li.querySelector('.vstate');
      if (tag) tag.textContent = this.peerVoiceTag(Number(li.dataset.pid));
    });
  }

  /** quién está hablando ahora mismo */
  onVoiceLevels() {
    const v = mp.voice;
    this.overlay.querySelectorAll<HTMLElement>('.mp-peers li[data-pid]').forEach((li) => li.classList.toggle('talk', !!v?.speaking(Number(li.dataset.pid))));
    this.renderMicButton();
  }

  private renderMicButton() {
    const btn = this.$.mic;
    const v = mp.voice;
    const show = !!v && !!mp.session?.code && VoiceChat.supported && !!this.scene && this.scene.netRole !== 'solo';
    btn.classList.toggle('hidden', !show);
    if (!show || !v) return;
    const label = !v.enabled ? 'VOZ: NO' : !v.micOk ? 'SOLO ESCUCHAS' : v.settings.mode === 'ptt' ? (v.ptt ? 'HABLANDO' : 'MIC: MANTÉN V') : v.muted ? 'MIC SILENCIADO' : 'MIC ABIERTO';
    if (btn.textContent !== label) btn.textContent = label;
    btn.classList.toggle('on', v.transmitting);
    btn.classList.toggle('talk', !!mp.session && v.speaking(mp.session.pid));
  }

  private secretCount() {
    const s = saves.data.secrets;
    return s.notes.length + (s.socks ? 1 : 0) + (s.prophecies ? 1 : 0) + s.conspiracy.length + (s.eternalCleans ? 1 : 0) + (s.lockers ? 1 : 0);
  }

  showChallenges(seed = '') {
    const done = new Set(saves.data.missionsDone);
    this.open('help', `<div class="card challenges"><h2>DESAFÍOS Y MISIONES</h2>
      <p style="color:var(--muted)">Reglas especiales y misiones de la campaña, cuando quieras. Superarlas cuenta para tu expediente.</p>
      <div class="chal-grid">${CHALLENGES.map((c) => `<button class="chal ${done.has(`c_${c.id}`) ? 'done' : ''}" data-ch="${c.id}">
        <span class="n">${done.has(`c_${c.id}`) ? '✔ ' : ''}${esc(c.name)}</span><span class="d">${esc(c.desc)}</span>
        ${c.mission && MISSIONS[c.mission].boss ? '<span class="tag">JEFE</span>' : ''}</button>`).join('')}</div>
      <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
    this.on('[data-act="back"]', () => this.showMenu());
    this.on('[data-ch]', (el) => this.handlers.start('desafio', seed, { challenge: el.dataset.ch }));
  }

  showWardrobe() {
    const d = saves.data;
    let uniform = d.look.uniform;
    let hat = d.look.hat;
    const render = () => {
      this.open('help', `<div class="card wardrobe"><h2>VESTUARIO</h2>
        <div class="wr">
          <canvas class="preview" width="216" height="72"></canvas>
          <div>
            <h3>UNIFORME</h3>
            <div class="opts">${Object.entries(UNIFORM_COLORS).map(([id, u]) => {
              const lock = (UNIFORM_LEVEL[id] ?? 1) > d.level;
              return `<button data-u="${id}" class="${id === uniform ? 'on' : ''}" ${lock ? 'disabled' : ''}><i style="background:${u.top}"></i>${esc(u.label)}${lock ? ` · nv ${UNIFORM_LEVEL[id]}` : ''}</button>`;
            }).join('')}</div>
            <h3>GORRO</h3>
            <div class="opts">${HATS.map((h) => {
              const lock = h.level > d.level;
              return `<button data-h="${h.id}" class="${h.id === hat ? 'on' : ''}" ${lock ? 'disabled' : ''}>${esc(h.name)}${lock ? ` · nv ${h.level}` : ''}</button>`;
            }).join('')}</div>
          </div>
        </div>
        <div class="row-btns"><button class="primary" data-act="save">Guardar y volver</button><button data-act="back">Cancelar</button></div></div>`);
      const cv = this.overlay.querySelector<HTMLCanvasElement>('.preview')!;
      const g = cv.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const sheet = characterSheet(playerLook(uniform, hat));
      // los fotogramas son cuadrados del alto de la hoja (64 texeles con la densidad actual)
      const fw = sheet.height;
      [0, 2 * CHAR_FRAMES, CHAR_FRAMES].forEach((f, i) => g.drawImage(sheet, f * fw, 0, fw, fw, i * 72 + 4, 4, 64, 64));
      this.on('[data-u]', (el) => { uniform = el.dataset.u!; render(); });
      this.on('[data-h]', (el) => { hat = el.dataset.h as HatStyle; render(); });
      this.on('[data-act="back"]', () => this.showMenu());
      this.on('[data-act="save"]', () => {
        d.look = { uniform, hat };
        saves.save();
        audio.sfx('coin');
        this.handlers.toMenu();
      });
    };
    render();
  }

  showSpecs() {
    const d = saves.data;
    this.open('help', `<div class="card"><h2>ESPECIALIZACIÓN</h2>
      <p style="color:var(--muted)">A partir del nivel 5, MOP-13 puede especializarse. Puedes cambiarla entre turnos.</p>
      ${(Object.keys(SPECIALIZATIONS) as SpecId[]).map((id) => `<div class="up spec ${d.spec === id ? 'on' : ''}"><div><span class="n">${esc(SPECIALIZATIONS[id].name)}</span>
        <div class="d">${esc(SPECIALIZATIONS[id].desc)}</div></div><button data-spec="${id}" ${d.spec === id ? 'disabled' : ''}>${d.spec === id ? 'ACTIVA' : 'ELEGIR'}</button></div>`).join('')}
      <div class="row-btns"><button class="primary" data-act="back">Volver</button>${d.spec ? '<button data-act="none">Sin especialización</button>' : ''}</div></div>`);
    this.on('[data-spec]', (el) => { d.spec = el.dataset.spec as SpecId; saves.save(); audio.sfx('coin'); this.showSpecs(); });
    this.on('[data-act="none"]', () => { d.spec = null; saves.save(); this.showSpecs(); });
    this.on('[data-act="back"]', () => this.showMenu());
  }

  showSecrets() {
    const s = saves.data.secrets;
    const notes = NOTES.map((n, i) => s.notes.includes(i) ? `<p class="note">📄 ${esc(n)}</p>` : `<p class="note locked">📄 ??? — nota sin encontrar</p>`).join('');
    const consp = CLORO.conspiracy.map((c, i) => s.conspiracy.includes(i) ? `<p class="note">📡 ${esc(c)}</p>` : '<p class="note locked">📡 ??? — transmisión interceptada</p>').join('');
    this.open('help', `<div class="card secrets"><h2>ARCHIVO SECRETO DE MOP-13</h2>
      <p style="color:var(--muted)">Cosas que la Corporación preferiría que no supieras. Se encuentran limpiando, mirando donde no se debe y desobedeciendo con educación.</p>
      <div class="sec-stats">
        <span>🧦 Calcetines misteriosos <b>${s.socks}</b></span>
        <span>🚽 Profecías del inodoro <b>${s.prophecies}</b></span>
        <span>♾ Mancha Eterna limpiada <b>${s.eternalCleans}</b></span>
        <span>🔒 Taquilla de MOP-1 <b>${s.lockers ? 'abierta' : 'sin encontrar'}</b></span>
      </div>
      <h3>NOTAS BAJO LA SUCIEDAD (${s.notes.length}/${NOTES.length})</h3>${notes}
      <h3>MENSAJES DE CL-0R0 QUE NO DEBERÍAS HABER OÍDO (${s.conspiracy.length}/${CLORO.conspiracy.length})</h3>${consp}
      <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
    this.on('[data-act="back"]', () => this.showMenu());
  }

  showOptions(back: () => void) {
    const s = saves.data.settings;
    this.open('help', `<div class="card options" style="max-width:560px"><h2>OPCIONES</h2>
      ${this.volumeControls()}
      <div class="vol">
        <span>Tamaño de la interfaz</span><input type="range" min="0.8" max="1.4" step="0.05" value="${s.uiScale}" data-k="uiscale">
        <span>Estilo gráfico</span><select data-k="viewsel">
          <option value="iso" ${s.view === 'iso' ? 'selected' : ''}>Bloques isométricos</option>
          <option value="classic" ${s.view !== 'iso' ? 'selected' : ''}>Pixel art 3/4 (clásico)</option></select>
        <span>Controles táctiles</span><select data-k="touchsel">
          <option value="auto" ${s.touch === 'auto' ? 'selected' : ''}>Automático</option>
          <option value="on" ${s.touch === 'on' ? 'selected' : ''}>Siempre</option>
          <option value="off" ${s.touch === 'off' ? 'selected' : ''}>Nunca</option></select>
        <label class="chk"><input type="checkbox" data-k="autopause" ${s.autoPause ? 'checked' : ''}> Pausar al cambiar de ventana o pestaña</label>
      </div>
      <div class="row-btns"><button class="primary" data-act="back">Volver</button><button data-act="reset">Borrar partida guardada</button></div></div>`);
    this.bindVolume();
    const ui = this.overlay.querySelector<HTMLInputElement>('[data-k="uiscale"]')!;
    ui.addEventListener('input', () => { s.uiScale = parseFloat(ui.value); saves.save(); this.applySettings(); });
    const ts = this.overlay.querySelector<HTMLSelectElement>('[data-k="touchsel"]')!;
    ts.addEventListener('change', () => { s.touch = ts.value as 'auto' | 'on' | 'off'; saves.save(); this.applySettings(); });
    const vs = this.overlay.querySelector<HTMLSelectElement>('[data-k="viewsel"]')!;
    vs.addEventListener('change', () => {
      s.view = vs.value === 'iso' ? 'iso' : 'classic';
      s.viewSet = true;
      saves.save();
      // se aplica al reiniciar la escena (en partida, al empezar el siguiente turno)
      if (!this.scene || !this.scene.started || this.scene.cfg.mode === 'attract') this.handlers.toMenu();
      else this.toast('El estilo gráfico se aplicará en el próximo turno', 'task');
    });
    const ap = this.overlay.querySelector<HTMLInputElement>('[data-k="autopause"]')!;
    ap.addEventListener('change', () => { s.autoPause = ap.checked; saves.save(); });
    this.on('[data-act="back"]', back);
    this.on('[data-act="reset"]', (el) => {
      if (el.dataset.confirm) { saves.reset(); this.applySettings(); this.handlers.toMenu(); return; }
      el.dataset.confirm = '1';
      el.textContent = '¿Seguro? Pulsa otra vez para borrarlo todo';
    });
  }

  showBadges() {
    const got = new Set(saves.data.achievements);
    this.open('help', `<div class="card"><h2>LOGROS</h2>
      ${Object.entries(ACHIEVEMENTS).map(([id, a]) => `<p style="opacity:${got.has(id) ? 1 : 0.45}">${got.has(id) ? '🏆' : '·'} <b>${esc(a.name)}</b> — ${esc(a.desc)}</p>`).join('')}
      <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
    this.on('[data-act="back"]', () => this.showMenu());
  }

  showHelp(back: () => void) {
    this.open('help', `<div class="card help"><h2>CÓMO SE JUEGA</h2>
      <p>Eres MOP-13, conserje de tercera en la USC Desastre. La tripulación se encarga de las emergencias: seguridad dispara, ingeniería repara, la médica reanima. Tú limpias lo que dejan. Y a veces echas una mano.</p>
      <h3>CONTROLES</h3>
      <ul>
        <li><kbd>WASD</kbd>/<kbd>FLECHAS</kbd> moverse · <kbd>SHIFT</kbd> correr (gasta resistencia y resbalas más)</li>
        <li><kbd>CLIC IZQ.</kbd> o <kbd>ESPACIO</kbd> usar herramienta (apunta con el ratón)</li>
        <li><kbd>E</kbd> mantener para interactuar: reparar, desatascar, reanimar, recoger cuerpos, vaciar papeleras, bloquear puertas…</li>
        <li><kbd>Q</kbd> / <kbd>1</kbd>–<kbd>8</kbd> cambiar herramienta · <kbd>TAB</kbd> tareas · <kbd>M</kbd> mapa · <kbd>ESC</kbd> pausa</li>
        <li>En móvil: joystick izquierdo para moverte, derecho para apuntar y usar, botón <kbd>E</kbd> para interactuar.</li>
      </ul>
      <h3>HERRAMIENTAS</h3>
      <ul>
        <li><b>Fregona</b>: limpia casi todo. Acláralo en la Estación del conserje. Deja el suelo mojado… también para los alienígenas.</li>
        <li><b>Espuma</b>: apaga incendios, sella fugas y sella inodoros. Inmoviliza criaturas.</li>
        <li><b>Aspiradora</b>: sólidos, ratas, insectos y criaturas aturdidas. Los líquidos la averían.</li>
        <li><b>Desinfectante</b> (nivel 2): moho, esporas, mocos y vómito. Cura a los infectados.</li>
        <li><b>Criogenia</b> (nivel 3): congela charcos, tuberías y criaturas. El hielo se derrite.</li>
        <li><b>Trampas</b> y <b>dron</b>: colócalos y deja que trabajen por ti.</li>
      </ul>
      <h3>CONSEJOS</h3>
      <ul>
        <li>Si alguien muere, recoge el cuerpo con [E] y llévalo a la cápsula médica de la enfermería. No, por el vertedero no.</li>
        <li>El agua cerca de un panel provoca cortocircuitos. El aceite y la basura arden.</li>
        <li>Las alertas muestran quién las está atendiendo. Si nadie puede, te toca.</li>
        <li>Desde la mesa holográfica del puente puedes bloquear salas, inundarlas de espuma o purgar la ventilación.</li>
        <li>Haz clic en una alerta para marcarla como prioridad y verás una flecha hacia ella.</li>
      </ul>
      <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
    this.on('[data-act="back"]', back);
  }

  showShop() {
    const d = saves.data;
    const render = () => {
      this.open('shop', `<div class="card shop"><h2>TAQUILLA DE MEJORAS</h2>
        <div class="wallet">CRÉDITOS DISPONIBLES: ${d.credits} · NIVEL ${d.level}</div>
        ${UPGRADES.map((u) => {
          const lv = d.upgrades[u.id] ?? 0;
          const max = lv >= u.costs.length;
          const cost = max ? 0 : u.costs[lv];
          const locked = (u.minLevel ?? 1) > d.level;
          return `<div class="up"><div><span class="n">${esc(u.name)}</span><span class="br">${u.branch.toUpperCase()}</span>
            <div class="d">${esc(u.desc)}</div><div class="lv">NIVEL ${lv}/${u.costs.length}${locked ? ` · REQUIERE NIVEL ${u.minLevel}` : ''}</div></div>
            <button data-buy="${u.id}" ${max || locked || d.credits < cost ? 'disabled' : ''}>${max ? 'MÁXIMO' : `${cost} CR`}</button></div>`;
        }).join('')}
        <div class="row-btns"><button class="primary" data-act="back">Volver</button></div></div>`);
      this.on('[data-act="back"]', () => this.showMenu());
      this.on('[data-buy]', (el) => {
        const u = UPGRADES.find((x) => x.id === el.dataset.buy)!;
        const lv = d.upgrades[u.id] ?? 0;
        const cost = u.costs[lv];
        if (cost === undefined || d.credits < cost || (u.minLevel ?? 1) > d.level) return;
        d.credits -= cost;
        d.upgrades[u.id] = lv + 1;
        saves.save();
        audio.sfx('coin');
        render();
      });
    };
    render();
  }

  showBriefing(title: string, memo: string, tasks: Task[], onStart: () => void) {
    this.open('brief', `<div class="card brief"><h2>${esc(title)}</h2>
      <div class="memo"><div class="hdr"><span>MEMORÁNDUM INTERNO · CL-0R0</span><span>CONFIDENCIAL</span></div>
        <p>${esc(memo)}</p>
        <p><b>Tareas asignadas:</b></p>
        <ul>${tasks.map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul>
      </div>
      <div class="controls">
        <div><kbd>WASD</kbd> moverse · <kbd>SHIFT</kbd> correr</div>
        <div><kbd>CLIC</kbd>/<kbd>ESPACIO</kbd> usar herramienta</div>
        <div><kbd>E</kbd> (mantener) interactuar</div>
        <div><kbd>Q</kbd> <kbd>1</kbd>–<kbd>8</kbd> herramienta</div>
        <div><kbd>TAB</kbd> tareas · <kbd>M</kbd> mapa</div>
        <div><kbd>ESC</kbd> pausa</div>
      </div>
      <div class="row-btns"><button class="primary" data-act="go">Fichar y empezar el turno</button></div></div>`);
    this.on('[data-act="go"]', () => { this.close(); onStart(); });
  }

  showPause() {
    const sc = this.scene;
    if (!sc) return;
    const guest = sc.netRole === 'client';
    this.open('pause', `<div class="card" style="max-width:520px"><h2>PAUSA</h2>
      <p>Semilla de esta nave: <b style="color:var(--yellow)">${esc(sc.cfg.seed)}</b> · Favores restantes: ${sc.favors}</p>
      ${sc.netRole !== 'solo' ? `<p style="color:var(--yellow)">Sala ${esc(mp.session?.code ?? '')}: la nave no se detiene mientras estás en pausa.</p>` : ''}
      ${sc.netRole !== 'solo' && mp.voice ? `<div class="voice-box" data-voice>${this.voiceInner()}</div>` : ''}
      ${this.volumeControls()}
      <div class="row-btns">
        <button class="primary" data-act="resume">Continuar</button>
        <button data-act="help">Controles</button>
        <button data-act="options">Opciones</button>
        ${guest ? '' : '<button data-act="restart">Reiniciar turno</button>'}
        <button data-act="quit">${guest ? 'Salir de la sala' : sc.cfg.duration ? 'Abandonar el turno' : 'Fichar la salida'}</button>
      </div></div>`);
    this.bindVolume();
    this.bindVoice();
    this.on('[data-act="resume"]', () => { this.close(); sc.setPaused(false); });
    this.on('[data-act="help"]', () => this.showHelp(() => this.showPause()));
    this.on('[data-act="options"]', () => this.showOptions(() => this.showPause()));
    this.on('[data-act="restart"]', () => { this.close(); sc.restartShift(); });
    this.on('[data-act="quit"]', () => { this.close(); sc.setPaused(false); if (guest) this.handlers.leaveRoom(); else sc.endShift('quit'); });
  }

  showShipPanel() {
    const sc = this.scene;
    if (!sc || this.modal) return;
    sc.setPaused(true);
    const render = () => {
      const rooms = sc.map.rooms.filter((r) => r.id !== 'pasillo');
      this.open('ship', `<div class="card shippanel"><h2>PANEL DE CONTROL DE LA NAVE</h2>
        <p>Energía ${Math.round(sc.ship.power)} % · Oxígeno ${Math.round(sc.ship.oxygen)} % · Gravedad ${sc.ship.gravity ? 'ACTIVA' : 'DESACTIVADA'} · Contagio ${Math.round(sc.disease.globalContam())} %</p>
        <div class="rooms">${rooms.map((r) => {
          const locked = r.doors.length > 0 && r.doors.every((d) => d.locked);
          const threat = sc.emerg.roomThreat(r.id);
          const fires = sc.emerg.roomFireCount(r.id);
          const contam = Math.round(sc.disease.contam.get(r.id) ?? 0);
          return `<div class="rm ${threat ? 'threat' : ''}"><div class="n" style="color:${r.accent}">${esc(r.name.toUpperCase())}</div>
            <div class="s">Limpieza ${Math.round(sc.dirt.roomClean(r.id))} %${contam ? ` · contagio ${contam} %` : ''}${fires ? ` · ${fires} focos de fuego` : ''}${sc.emerg.breachIn(r.id) ? ' · FUGA' : ''}</div>
            <button data-lock="${r.id}">${locked ? 'Desbloquear' : 'Bloquear'} puertas</button>
            <button data-foam="${r.id}" ${sc.cooldownLeft('foam') > 0 ? 'disabled' : ''}>Supresión de incendios</button>
            <button data-purge="${r.id}" ${sc.cooldownLeft('purge') > 0 ? 'disabled' : ''}>Purgar ventilación</button></div>`;
        }).join('')}</div>
        <p style="font-size:17px;color:var(--muted)">Supresión: llena la sala de espuma (apaga el fuego… y lo pone todo perdido). Purga: elimina polvo, esporas y contagio de la sala, pero consume oxígeno. Recarga: ${Math.ceil(sc.cooldownLeft('foam'))} s / ${Math.ceil(sc.cooldownLeft('purge'))} s.</p>
        <div class="row-btns">
          ${sc.emerg.blackoutT > 0 ? '<button data-act="power">Reiniciar energía</button>' : ''}
          <button class="primary" data-act="close">Cerrar [ESC]</button></div></div>`);
      this.on('[data-act="close"]', () => { this.close(); sc.setPaused(false); });
      this.on('[data-act="power"]', () => { sc.restorePower(); render(); });
      this.on('[data-lock]', (el) => { sc.lockRoom(el.dataset.lock as any); render(); });
      this.on('[data-foam]', (el) => { sc.suppressFire(el.dataset.foam as any); this.close(); sc.setPaused(false); });
      this.on('[data-purge]', (el) => { sc.purgeVents(el.dataset.purge as any); render(); });
    };
    render();
  }

  toggleMap() {
    const sc = this.scene;
    if (!sc || !this.inGame() || (this.modal && this.modal !== 'map')) return;
    if (this.modal === 'map') { this.close(); sc.setPaused(false); return; }
    sc.setPaused(true);
    this.open('map', `<div class="card bigmap" style="max-width:960px"><h2>MAPA DE LA USC DESASTRE</h2>
      <canvas data-k="big"></canvas>
      <div class="legend"><span><i style="background:#ffd23f"></i>MOP-13</span><span><i style="background:#e8e6f8"></i>Tripulación</span><span><i style="background:#5dff9b"></i>Criatura</span><span><i style="background:#ff8a3d"></i>Fuego</span><span><i style="background:#ff4d5a"></i>Puerta bloqueada / alerta grave</span></div>
      <div class="legend">${sc.map.rooms.map((r) => `<span><i style="background:${r.accent}"></i>${esc(r.name)} · ${Math.round(sc.dirt.roomClean(r.id))} %</span>`).join('')}</div>
      <div class="row-btns"><button class="primary" data-act="close">Cerrar [M]</button></div></div>`);
    const c = this.overlay.querySelector<HTMLCanvasElement>('[data-k="big"]')!;
    this.bigMap = new Minimap(c, 7);
    this.bigMap.setMap(sc.map);
    this.bigMap.draw(sc, sc.allAlerts(), this.pinned);
    this.on('[data-act="close"]', () => { this.close(); sc.setPaused(false); });
  }

  toggleTasks() {
    this.tasksCollapsed = !this.tasksCollapsed;
    this.lastTasksKey = '';
  }

  showEvaluation(r: Report, levelUps: number, onNext: () => void, onRetry: () => void, onMenu: () => void, opts: { guest?: boolean } = {}) {
    this.showHud(false);
    const ledger = r.ledger.map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.amount >= 0 ? 'good' : 'bad'}">${l.amount >= 0 ? '+' : ''}${l.amount}</td></tr>`).join('');
    const modeName: Record<string, string> = { historia: `Noche ${r.night}`, infinito: 'Turno infinito', zen: 'Limpieza zen', caos: 'Modo caos', desafio: 'Desafío' };
    const d = saves.data;
    const specUnlocked = levelUps && d.level >= 5 && d.level - levelUps < 5;
    this.open('eval', `<div class="card eval" style="max-width:900px">
      <h2>INFORME CORPORATIVO DE FIN DE TURNO</h2>
      <p style="color:var(--muted);font-size:18px">${esc(modeName[r.mode] ?? r.mode)} · Semilla ${esc(r.seed)} · ${esc(r.survived)}</p>
      <div class="stamp ${r.grade}">${r.grade}</div>
      <div class="corp">${esc(r.corporate)}</div>
      <p style="color:var(--muted)">«${esc(r.gradeLine)}» — CL-0R0</p>
      <div class="cols">
        <div><h3>ESTADÍSTICAS</h3><table>${r.stats.map((s) => `<tr><td>${esc(s.label)}</td><td class="${s.cls ?? ''}">${esc(s.value)}</td></tr>`).join('')}</table>
          ${r.story.length ? `<h3>LO QUE PASÓ ESTA NOCHE</h3>${r.story.map((x) => `<div class="caused" style="color:var(--muted)">· ${esc(x)}</div>`).join('')}` : ''}</div>
        <div><h3>NÓMINA</h3><table>${ledger}<tr class="total"><td>TOTAL A COBRAR</td><td>${r.total >= 0 ? '+' : ''}${r.total} CR</td></tr></table>
          <p style="font-size:17px;color:var(--muted)">+${r.xp} XP${levelUps ? ` · ¡Subes al nivel ${d.level}!` : ''}${specUnlocked ? ' · ¡Especialización desbloqueada!' : ''}</p>
          ${r.playerCaused.length ? `<h3>INCIDENTES PROVOCADOS POR USTED</h3>${r.playerCaused.map((c) => `<div class="caused">· ${esc(c)}</div>`).join('')}` : ''}
          ${r.badges.length ? `<h3>INSIGNIAS</h3><div class="badges">${r.badges.map((b) => `<span class="badge" title="${esc(b.desc)}">🏆 ${esc(b.name)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="row-btns">
        ${opts.guest
          ? '<p class="mp-wait" style="flex-basis:100%">Esperando a que el anfitrión empiece el siguiente turno…</p><button data-act="shop">Taquilla de mejoras</button><button data-act="menu">Salir de la sala</button>'
          : `<button class="primary" data-act="next">${r.mode === 'historia' && r.reason === 'time' ? 'Siguiente noche' : 'Nuevo turno'}</button>
        <button data-act="retry">Repetir esta nave</button>
        <button data-act="shop">Taquilla de mejoras</button>
        <button data-act="menu">${mp.session?.code ? 'Volver a la sala' : 'Menú principal'}</button>`}
      </div></div>`);
    this.on('[data-act="next"]', onNext);
    this.on('[data-act="retry"]', onRetry);
    this.on('[data-act="menu"]', onMenu);
    this.on('[data-act="shop"]', () => this.showShop());
  }

  private onKey(e: KeyboardEvent) {
    const sc = this.scene;
    const inGame = this.inGame();
    if (e.key === 'Tab') {
      e.preventDefault();
      if (inGame && !this.modal) this.toggleTasks();
      return;
    }
    if (e.key === 'Escape') {
      if (!inGame) return;
      e.preventDefault();
      if (this.modal === 'pause') { this.close(); sc!.setPaused(false); }
      else if (this.modal === 'ship' || this.modal === 'map') { this.close(); sc!.setPaused(false); }
      else if (this.modal === 'help') { this.showPause(); }
      else if (!this.modal) { sc!.setPaused(true); this.showPause(); }
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && inGame && (!this.modal || this.modal === 'map')) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT') return;
      this.toggleMap();
    }
  }
}

export const ui = new UI();
