import Phaser from 'phaser';
import { MAP_W, TILE } from '../config';
import { bus } from '../core/EventBus';
import { audio } from '../systems/AudioManager';
import { saves } from '../systems/SaveManager';
import { ui, type HudState } from '../ui/UI';
import { characterSheet, CHAR_FRAMES } from '../gfx/characters';
import { playerLook } from '../data/crew';
import { TOOL_ORDER } from '../data/tools';
import { ROOM_NAMES } from '../data/rooms';
import type { NetSession, Peer, PeerLook } from './Net';
import type { GameScene } from '../scenes/GameScene';
import type { Player, NetPlayerState } from '../entities/Player';
import type { Dirt, NetDirt } from '../systems/ContaminationSystem';
import type { AlertInfo, Breach, FireCell } from '../systems/EmergencySystem';
import type { Task } from '../systems/MissionManager';
import type { Report } from '../systems/Evaluation';
import type { RoomId, ShiftConfig, ToolId } from '../types';

/*
 * MULTIJUGADOR COOPERATIVO
 * ─ El anfitrión simula toda la nave. Cada invitado mueve a su conserje en su pantalla y envía su estado (20 Hz).
 * ─ El anfitrión envía 12 instantáneas por segundo:
 *     · réplica visual de los objetos dinámicos (tripulación, criaturas, fuego, cadáveres, disparos…) como deltas;
 *     · suciedad como datos lógicos (altas, bajas y cambios), porque el invitado la necesita para resbalar y para el HUD;
 *     · estado lógico mínimo (nave, fuegos, brechas, paneles, puertas, luces) y eventos (partículas, sonidos, mensajes).
 */

type GO = any;
const SNAP_DT = 1 / 12;
const SKIP_SFX = new Set(['step', 'squelch', 'click']);
const FX_NAMES = ['sparkle', 'splash', 'sparks', 'smoke', 'steamPuff', 'vomit', 'confetti', 'crumbs', 'debris', 'zap', 'foamPuff', 'gasPuff', 'dust', 'muzzle', 'iceBurst', 'explosion', 'drip', 'gasStream', 'suck'];
const FX_CAP: Record<string, number> = { gasStream: 4, suck: 3, splash: 8, sparks: 8, smoke: 6 };

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** textura de un conserje con el aspecto (uniforme + gorro) de otro jugador */
export function ensurePeerTexture(scene: Phaser.Scene, pid: number, look: PeerLook | undefined): string {
  const l = look ?? { uniform: 'amarillo', hat: 'cap' };
  const key = `char_net_${pid}_${l.uniform}_${l.hat}`;
  if (scene.textures.exists(key)) return key;
  const canvas = characterSheet(playerLook(l.uniform, l.hat));
  const t = scene.textures.addCanvas(key, canvas)!;
  // fotogramas cuadrados (3 direcciones × CHAR_FRAMES); el tamaño sale del lienzo, sea cual sea la densidad
  const n = 3 * CHAR_FRAMES;
  const fw = canvas.height, fh = canvas.height;
  for (let i = 0; i < n; i++) t.add(i, 0, i * fw, 0, fw, fh);
  return key;
}

/** tupla visual de un objeto: [id,tipo,clave,fotograma,x,y,prof,flags,alfa,sx,sy,ángulo,tinte,ox,oy,mezcla,recorte,(alfaRelleno,w,h)] */
function tuple(go: GO, id: string): any[] {
  const flags = (go.visible ? 1 : 0) | (go.flipX ? 2 : 0) | (go.flipY ? 4 : 0) | (go.tintFill ? 8 : 0);
  if (go.type === 'Ellipse') {
    return [id, 'e', '', 0, r1(go.x), r1(go.y), r4(go.depth), flags, r2(go.alpha), r3(go.scaleX), r3(go.scaleY), r1(go.angle), go.fillColor, r2(go.originX), r2(go.originY), go.blendMode, 0, r2(go.fillAlpha), go.width, go.height];
  }
  const c = go.isCropped && go._crop ? [go._crop.x, go._crop.y, go._crop.width, go._crop.height] : 0;
  return [id, 's', go.texture.key, go.frame.name, r1(go.x), r1(go.y), r4(go.depth), flags, r2(go.alpha), r3(go.scaleX), r3(go.scaleY), r1(go.angle), go.tintTopLeft, r2(go.originX), r2(go.originY), go.blendMode, c];
}

const same = (x: any, y: any) => x === y || (Array.isArray(x) && Array.isArray(y) && x.join() === y.join());

function identical(a: any[], b: any[]) {
  if (a.length !== b.length) return false;
  for (let i = 1; i < a.length; i++) if (!same(a[i], b[i])) return false;
  return true;
}

/** ¿solo cambian posición, profundidad, fotograma, visibilidad o volteo? (forma corta) */
function onlyMotion(a: any[], b: any[]) {
  if (a.length !== b.length) return false;
  for (let i = 1; i < a.length; i++) {
    if (i >= 3 && i <= 6) continue;
    if (i === 7) { if ((a[7] & 8) !== (b[7] & 8)) return false; continue; }
    if (!same(a[i], b[i])) return false;
  }
  return true;
}

// ═════════════════════════════════ ANFITRIÓN ═════════════════════════════════

export class HostSync {
  private ids = new WeakMap<object, string>();
  private nextId = 1;
  private last = new Map<string, any[]>();
  private events: any[] = [];
  private fxCount = new Map<string, number>();
  private dirtAdds: NetDirt[] = [];
  private dirtRemoves: number[] = [];
  private dirtLast = new Map<number, number[]>();
  private acc = 0;
  private n = 0;
  private quietDepth = 0;
  private restores: (() => void)[] = [];
  private offs: (() => void)[] = [];

  constructor(private w: GameScene, private s: NetSession) {
    // eventos de partículas: se ejecutan como locales y se reenvían
    const fx = w.fx as any;
    for (const name of FX_NAMES) {
      const orig = fx[name];
      if (typeof orig !== 'function') continue;
      fx[name] = (...args: any[]) => {
        this.pushFx(name, args);
        return w.netLocal(() => orig.apply(fx, args));
      };
    }
    this.hook(audio, 'sfx', (orig) => (name: string) => {
      if (!SKIP_SFX.has(name)) this.push({ e: 'sfx', n: name, o: w.fxOwner || undefined });
      return orig(name);
    });
    this.hook(ui, 'message', (orig) => (text: string, sev = 1) => { this.push({ e: 'msg', t: text, s: sev }); return orig(text, sev); });
    this.hook(ui, 'toast', (orig) => (text: string, ic = 'task') => { this.push({ e: 'toast', t: text, i: ic }); return orig(text, ic); });
    this.hook(ui, 'flash', (orig) => (c: number) => { this.push({ e: 'flash', c }); return orig(c); });
    this.hook(ui.labels, 'place', (orig) => (id: string, html: string, x: number, y: number, cls: string) => {
      if (id === 'art') this.push({ e: 'place', id, h: html, x: r1(x), y: r1(y), c: cls });
      return orig(id, html, x, y, cls);
    });
    this.hook(ui.labels, 'hide', (orig) => (id: string) => { if (id === 'art') this.push({ e: 'hide', id }); return orig(id); });
    this.offs.push(bus.on('dirt:add', (d: Dirt) => {
      this.dirtAdds.push(this.netDirt(d));
      this.dirtLast.set(d.id, [d.x, d.y, d.amount, d.vx, d.vy, w.t]);
    }));
    this.offs.push(bus.on('dirt:removed', (d: Dirt) => { this.dirtRemoves.push(d.id); this.dirtLast.delete(d.id); }));
    s.onUp = (from, d) => this.onUp(from, d);
    for (const d of w.dirt.list) this.dirtLast.set(d.id, [d.x, d.y, d.amount, d.vx, d.vy, w.t]);
    // todos los invitados conectados (re)empiezan el turno con esta configuración
    this.sendStart('all');
  }

  private hook(obj: any, key: string, wrap: (orig: (...a: any[]) => any) => (...a: any[]) => any) {
    const own = Object.prototype.hasOwnProperty.call(obj, key);
    const prev = obj[key];
    obj[key] = wrap(prev.bind(obj));
    this.restores.push(() => { if (own) obj[key] = prev; else delete obj[key]; });
  }

  destroy() {
    for (const r of this.restores) r();
    this.restores = [];
    this.offs.forEach((f) => f());
    this.offs = [];
    if (this.s.onUp) this.s.onUp = null;
  }

  /** ejecuta algo sin reenviar sus efectos (cada pantalla ya los genera por su cuenta) */
  quiet<T>(fn: () => T): T {
    this.quietDepth++;
    try { return fn(); } finally { this.quietDepth--; }
  }

  private push(ev: any) {
    if (this.quietDepth > 0) return;
    if (this.events.length < 220) this.events.push(ev);
  }

  private pushFx(name: string, args: any[]) {
    if (this.quietDepth > 0) return;
    const n = (this.fxCount.get(name) ?? 0) + 1;
    this.fxCount.set(name, n);
    if (n > (FX_CAP[name] ?? 6)) return;
    const a = args.map((v) => (typeof v === 'number' ? r1(v) : v && typeof v === 'object' && 'id' in v ? v.id : v));
    this.push({ e: 'fx', n: name, a, o: this.w.fxOwner || undefined });
  }

  idOf(go: object): string {
    let id = this.w.stableIds.get(go as any) ?? this.ids.get(go);
    if (!id) { id = '#' + (this.nextId++).toString(36); this.ids.set(go, id); }
    return id;
  }

  /** bocadillo de un actor (conserje: 'p'+pid; resto: 'o'+id de su sprite) */
  say(actor: { sprite: object; label: string }, text: string, playerPid: number | null) {
    const r = playerPid !== null ? `p${playerPid}` : `o${this.idOf(actor.sprite)}`;
    this.push({ e: 'say', r, w: actor.label, t: text, pl: playerPid !== null ? 1 : 0 });
  }

  floatText(x: number, y: number, text: string, cls: string) { this.push({ e: 'float', x: r1(x), y: r1(y), t: text, c: cls }); }
  shake(i: number, d: number) { this.push({ e: 'shake', i, d }); }

  private netDirt(d: Dirt): NetDirt {
    return { id: d.id, type: d.type, x: r1(d.x), y: r1(d.y), a: r2(d.amount), fr: Number(d.sprite.frame.name) || 0, an: d.sprite.angle, fl: d.sprite.flipX ? 1 : 0, art: d.art ? 1 : 0, vx: r1(d.vx), vy: r1(d.vy) };
  }

  // ───────── mensajes de los invitados ─────────

  private onUp(from: number, d: any) {
    const w = this.w;
    const p = w.players.find((x) => x.netPid === from && x.kind === 'remote');
    switch (d?.k) {
      case 'ready': {
        if (!p) {
          const peer = this.s.peers.get(from);
          w.addRemote(from, { name: d.name ?? peer?.name ?? 'Conserje', look: d.look ?? peer?.look, upg: d.upg ?? {}, spec: d.spec ?? null, available: Array.isArray(d.av) ? d.av : undefined });
        }
        this.sendFull(from);
        break;
      }
      case 'in': if (p) { p.net = d as NetPlayerState; p.netAt = performance.now(); } break;
      case 'act': if (p) this.onAct(p, d); break;
    }
  }

  private onAct(p: Player, d: any) {
    const w = this.w;
    switch (d.a) {
      case 'slip': p.slipConsequences(); break;
      case 'place': {
        const tool = d.tool === 'robot' ? 'robot' : 'trampa';
        const ts = p.tools[tool];
        if (!p.available.includes(tool) || ts.charge < 1 || w.map.isSolidPx(d.x, d.y)) break;
        ts.charge -= 1;
        if (tool === 'trampa') w.placeTrap(d.x, d.y); else w.deployBot(d.x, d.y);
        break;
      }
      case 'panel': {
        const room = d.room as RoomId;
        if (d.op === 'lock' && room) w.lockRoom(room);
        else if (d.op === 'foam' && room) w.suppressFire(room);
        else if (d.op === 'purge' && room) w.purgeVents(room);
        else if (d.op === 'power') w.restorePower();
        break;
      }
    }
  }

  onPeer(peer: Peer, on: boolean) {
    if (on) this.sendStart(peer.pid);
    else this.w.removeRemote(peer.pid);
  }

  private sendStart(to: number | 'all') {
    const w = this.w;
    const cfg: ShiftConfig = {
      ...w.cfg, netRole: 'client',
      netBrief: { title: w.briefTitle(), memo: w.briefMemo(), tasks: w.missions.tasks.map((t) => t.title) },
    };
    this.s.sendTo(to, { k: 'start', cfg });
  }

  sendTo(pid: number, d: unknown) { this.s.sendTo(pid, d); }

  endShift(report: Report) { this.s.sendTo('all', { k: 'end', report }); }

  // ───────── instantáneas ─────────

  private objects(full: boolean): { o: any[]; x: string[] } {
    const w = this.w;
    const o: any[] = [];
    const seen = new Set<string>();
    for (const go of w.children.list as GO[]) {
      if (w.nonet.has(go)) continue;
      const ty = go.type;
      if (ty !== 'Sprite' && ty !== 'Image' && ty !== 'Ellipse') continue;
      const id = this.idOf(go);
      seen.add(id);
      const tup = tuple(go, id);
      if (full) { o.push(tup); continue; }
      const last = this.last.get(id);
      if (!last) o.push(tup);
      else if (identical(last, tup)) continue;
      else if (onlyMotion(last, tup)) o.push([id, tup[4], tup[5], tup[6], tup[3], tup[7]]);
      else o.push(tup);
      this.last.set(id, tup);
    }
    const x: string[] = [];
    if (!full) for (const id of this.last.keys()) if (!seen.has(id)) { x.push(id); this.last.delete(id); }
    return { o, x };
  }

  private dirtDeltas(): number[][] {
    const w = this.w;
    const out: number[][] = [];
    const zero = w.ship.zeroG;
    for (const d of w.dirt.list) {
      const l = this.dirtLast.get(d.id);
      if (!l) continue;
      const age = w.t - l[5];
      const px = zero ? l[0] + l[3] * age : l[0], py = zero ? l[1] + l[4] * age : l[1];
      if (Math.abs(d.amount - l[2]) > 0.03 || Math.hypot(d.x - px, d.y - py) > (zero ? 4 : 0.6) || Math.abs(d.vx - l[3]) > 3 || Math.abs(d.vy - l[4]) > 3) {
        out.push([d.id, r1(d.x), r1(d.y), r2(d.amount), r1(d.vx), r1(d.vy)]);
        this.dirtLast.set(d.id, [d.x, d.y, d.amount, d.vx, d.vy, w.t]);
      }
    }
    return out;
  }

  private world() {
    const w = this.w;
    const rooms = w.map.rooms;
    const ri = (r: RoomId | null) => (r ? rooms.findIndex((x) => x.id === r) : -1);
    const fi: number[] = [];
    for (const f of w.emerg.fires.values()) fi.push(f.tx, f.ty, Math.round(f.i * 100), ri(f.room));
    const br = w.emerg.breaches.map((b) => [b.id, r1(b.x), r1(b.y), ri(b.room), r2(b.seal), b.sealed ? 1 : 0]);
    const li: number[] = [];
    const L = (x: number, y: number, r: number, s: number) => li.push(Math.round(x), Math.round(y), Math.round(r), Math.round(s * 100));
    for (const c of w.creatures) if (c.alive && !c.hidden) L(c.x, c.y - 6, c.species === 'invasor' ? 14 : 18, 0.5);
    for (const b of w.combat.bolts) L(b.x, b.y, 18, 0.8);
    if (w.bosses.active) L(w.bosses.x, w.bosses.y - 12, 44, 0.65);
    for (const b of w.bots) L(b.x, b.y - 3, 10, b.broken ? 0.2 : 0.45);
    for (const s of w.secrets.socks) L(s.x, s.y, 8, 0.3);
    const sh = w.ship;
    return {
      sh: [r1(sh.power), r1(sh.oxygen), r1(sh.integrity), r1(sh.morale), sh.gravity ? 1 : 0, r1(sh.hygiene)],
      fi, br,
      fx: w.map.fixtures.map((f) => (f.broken ? 1 : 0) | (f.leaking ? 2 : 0)).join(''),
      dl: w.map.doors.map((d) => (d.locked ? 1 : 0)).join(''),
      th: rooms.map((r, i) => (w.emerg.roomThreat(r.id) > 0 ? i : -1)).filter((i) => i >= 0),
      li,
      bo: r1(Math.max(0, w.emerg.blackoutT)),
    };
  }

  private hud() {
    const w = this.w;
    const rooms = w.map.rooms;
    const ct: Record<string, number> = {};
    for (const [room, v] of w.disease.contam) if (v >= 1) ct[room] = Math.round(v);
    const dots: number[] = [];
    for (const c of w.crew) if (c.alive && !c.hidden) dots.push(Math.round(c.x), Math.round(c.y), c.state === 'knocked' ? 1 : c.prof === 'inspector' ? 2 : 0);
    for (const c of w.creatures) if (c.alive && !c.hidden) dots.push(Math.round(c.x), Math.round(c.y), 3);
    const tasks = w.missions.tasks.map((t) => ({ id: t.id, kind: t.kind, title: t.title, target: t.target, progress: t.progress, done: t.done, failed: t.failed, reward: t.reward, pct: t.pct }));
    return {
      ...w.sharedHud(),
      tk: tasks,
      al: w.allAlerts(),
      cd: [r1(w.cooldownLeft('foam')), r1(w.cooldownLeft('purge'))],
      ct, gc: r1(w.disease.globalContam()), dots,
      rooms: rooms.length,
    };
  }

  private me(p: Player) {
    const w = this.w;
    const it = w.interactions.get(p);
    const tl: Record<string, number[]> = {};
    for (const id of TOOL_ORDER) { const t = p.tools[id]; tl[id] = [r1(t.charge), r1(t.cap), r1(t.dur), t.broken ? 1 : 0]; }
    const rs = w.respawnLeft(p);
    return {
      k: 'me', hp: r1(p.hp), mh: p.maxHp, o2: r1(p.o2), tl, av: p.available, car: p.carrying, cn: p.body?.name ?? null,
      pr: it?.prompt ?? null, inv: r2(Math.max(0, p.invertT)), dead: p.dead ? 1 : 0, rs: rs > 0 ? Math.ceil(rs) : 0,
      tp: p.netTp, sup: p.hasSuper ? 1 : 0,
    };
  }

  private sprays(): number[] {
    const out: number[] = [];
    let i = 0;
    for (const [c, s] of this.w.cleaning.npcSprays) if (this.w.t - s.t < 0.2) out.push(c.uid, Math.round(s.x), Math.round(s.y), Math.round(s.tx), Math.round(s.ty), i++);
    return out;
  }

  /** estado completo para un invitado que acaba de entrar (o reentrar) */
  private sendFull(pid: number) {
    const w = this.w;
    const { o } = this.objects(true);
    this.s.sendTo(pid, {
      k: 'full', t: r1(w.t), st: w.started ? 1 : 0, o,
      dirt: w.dirt.list.map((d) => this.netDirt(d)),
      w: this.world(), pl: w.players.map((p) => ({ p: p.netPid, n: p.name, ...p.netState() })), h: this.hud(),
    });
  }

  tick(dt: number) {
    this.acc += dt;
    if (this.acc < SNAP_DT) return;
    this.acc = 0;
    if (this.s.backlog() > 700_000) return; // conexión saturada: se espera a que se vacíe
    const w = this.w;
    this.n++;
    const { o, x } = this.objects(false);
    const snap: any = {
      k: 's', t: r1(w.t), st: w.started ? 1 : 0, o, x,
      da: this.dirtAdds, dr: this.dirtRemoves, du: this.dirtDeltas(),
      w: this.world(), pl: w.players.map((p) => ({ p: p.netPid, n: p.name, ...p.netState() })),
      ev: this.events, sp: this.sprays(),
    };
    if (this.n % 3 === 0) snap.h = this.hud();
    this.dirtAdds = [];
    this.dirtRemoves = [];
    this.events = [];
    this.fxCount.clear();
    this.s.sendTo('all', snap);
    for (const p of w.players) if (p.kind === 'remote') this.s.sendTo(p.netPid, this.me(p));
  }
}

// ═════════════════════════════════ INVITADO ═════════════════════════════════

interface Mirror { go: GO; tx: number; ty: number; vx: number; vy: number; at: number; stable: boolean; kind: 's' | 'e'; tint: number }

export class ClientSync {
  objs = new Map<string, Mirror>();
  replicas = new Map<number, Player>();
  alerts: AlertInfo[] = [];
  tasks: Task[] = [];
  hud: any = null;
  prompt: { label: string; x: number; y: number; progress: number } | null = null;
  respawnIn = 0;
  hostStarted = false;
  private names = new Map<number, string>();
  private sprays: { key: string; x: number; y: number; tx: number; ty: number; until: number }[] = [];
  private inT = 0;
  private tpSeq = -1;
  private threat = new Set<RoomId>();

  constructor(private w: GameScene, private s: NetSession) {
    const me = s.peers.get(s.pid);
    s.sendUp({ k: 'ready', upg: saves.data.upgrades, spec: saves.data.spec, av: w.availableTools(), name: me?.name, look: saves.data.look });
  }

  get myPid() { return this.s.pid; }

  isThreat(room: RoomId) { return this.threat.has(room); }

  destroy() {
    for (const r of this.replicas.values()) r.destroy();
    this.replicas.clear();
  }

  onRx(d: any) {
    switch (d?.k) {
      case 's': this.applySnap(d, false); break;
      case 'full': this.applySnap(d, true); break;
      case 'me': this.applyMe(d); break;
      case 'end': this.onEnd(d.report); break;
      case 'ui': if (d.a === 'ship' && !ui.modal) ui.showShipPanel(); break;
    }
  }

  // ───────── aplicar instantáneas ─────────

  private applySnap(d: any, full: boolean) {
    const w = this.w;
    w.t = d.t;
    this.hostStarted = !!d.st;
    if (full) {
      for (const m of this.objs.values()) if (!m.stable) m.go.destroy();
      this.objs.clear();
      for (const dd of [...w.dirt.list]) w.dirt.netRemove(dd.id);
      for (const n of d.dirt as NetDirt[]) w.dirt.netAdd(n);
    }
    for (const t of d.o as any[]) this.applyObj(t);
    for (const id of (d.x ?? []) as string[]) {
      const m = this.objs.get(id);
      if (!m) continue;
      if (m.stable) m.go.setVisible(false); else m.go.destroy();
      this.objs.delete(id);
    }
    if (!full) {
      for (const n of (d.da ?? []) as NetDirt[]) w.dirt.netAdd(n);
      for (const id of (d.dr ?? []) as number[]) w.dirt.netRemove(id);
      for (const u of (d.du ?? []) as number[][]) w.dirt.netUpdate(u[0], u[1], u[2], u[3], u[4], u[5]);
    }
    this.applyWorld(d.w);
    this.applyPlayers(d.pl ?? []);
    for (const ev of (d.ev ?? []) as any[]) this.applyEvent(ev);
    const sp = (d.sp ?? []) as number[];
    const until = performance.now() / 1000 + 0.25;
    for (let i = 0; i + 5 < sp.length; i += 6) {
      const key = `n${sp[i]}`;
      const ex = this.sprays.find((s) => s.key === key);
      const v = { key, x: sp[i + 1], y: sp[i + 2], tx: sp[i + 3], ty: sp[i + 4], until };
      if (ex) Object.assign(ex, v); else this.sprays.push(v);
    }
    if (d.h) this.applyHud(d.h);
  }

  private applyObj(t: any[]) {
    const w = this.w;
    const id = t[0] as string;
    let m = this.objs.get(id);
    if (t.length === 6) {
      if (!m) return;
      this.setPos(m, t[1], t[2]);
      m.go.setDepth(t[3]);
      if (m.kind === 's') this.setFrame(m.go, t[4]);
      this.setFlags(m, t[5]);
      return;
    }
    const kind = t[1] as 's' | 'e';
    if (!m) {
      const stable = w.stableObjs.get(id);
      let go: GO;
      if (stable) go = stable;
      else if (kind === 'e') go = w.add.ellipse(t[4], t[5], t[18] ?? 10, t[19] ?? 4, t[12], t[17] ?? 1);
      else {
        if (!w.textures.exists(t[2])) return;
        go = w.add.sprite(t[4], t[5], t[2], t[2] && w.textures.get(t[2]).has(t[3]) ? t[3] : undefined);
      }
      m = { go, tx: t[4], ty: t[5], vx: 0, vy: 0, at: 0, stable: !!stable, kind, tint: 0xffffff };
      this.objs.set(id, m);
    }
    const go = m.go;
    if (kind === 's') {
      if (go.texture.key !== t[2] && w.textures.exists(t[2])) go.setTexture(t[2]);
      this.setFrame(go, t[3]);
      m.tint = t[12];
      if (t[12] !== 0xffffff || (t[7] & 8)) { if (t[7] & 8) go.setTintFill(t[12]); else go.setTint(t[12]); } else go.clearTint();
      if (t[16]) go.setCrop(t[16][0], t[16][1], t[16][2], t[16][3]); else if (go.isCropped) go.setCrop();
    } else {
      go.setFillStyle(t[12], t[17] ?? 1);
      if (go.width !== t[18] || go.height !== t[19]) go.setSize(t[18], t[19]);
    }
    this.setPos(m, t[4], t[5]);
    go.setDepth(t[6]);
    this.setFlags(m, t[7]);
    go.setAlpha(t[8]);
    go.setScale(t[9], t[10]);
    go.setAngle(t[11]);
    go.setOrigin(t[13], t[14]);
    go.setBlendMode(t[15]);
  }

  private setFrame(go: GO, f: any) {
    if (go.frame?.name === f) return;
    if (go.texture?.has(f)) go.setFrame(f);
  }

  private setFlags(m: Mirror, fl: number) {
    const go = m.go;
    go.setVisible(!!(fl & 1));
    if (m.kind === 's') { go.setFlipX(!!(fl & 2)); go.setFlipY(!!(fl & 4)); }
  }

  private setPos(m: Mirror, x: number, y: number) {
    const now = performance.now() / 1000;
    if (!m.at) { m.go.setPosition(x, y); m.tx = x; m.ty = y; m.at = now; return; }
    const dt = Math.max(0.04, now - m.at);
    let vx = (x - m.tx) / dt, vy = (y - m.ty) / dt;
    if (Math.hypot(vx, vy) > 420 || Math.hypot(x - m.go.x, y - m.go.y) > 40) { vx = 0; vy = 0; m.go.setPosition(x, y); }
    m.vx = vx; m.vy = vy; m.tx = x; m.ty = y; m.at = now;
  }

  private applyWorld(wd: any) {
    if (!wd) return;
    const w = this.w;
    const rooms = w.map.rooms;
    const sh = wd.sh as number[];
    w.ship.power = sh[0]; w.ship.oxygen = sh[1]; w.ship.integrity = sh[2]; w.ship.morale = sh[3]; w.ship.gravity = !!sh[4]; w.ship.hygiene = sh[5];
    const fires = w.emerg.fires;
    fires.clear();
    const fi = wd.fi as number[];
    for (let i = 0; i + 3 < fi.length; i += 4) {
      const tx = fi[i], ty = fi[i + 1];
      fires.set(ty * MAP_W + tx, { tx, ty, i: fi[i + 2] / 100, age: 0, room: rooms[fi[i + 3]]?.id ?? null, sprite: null as any, glow: null as any, ph: 0 } as FireCell);
    }
    w.emerg.breaches = (wd.br as number[][]).map((b) => ({ id: b[0], x: b[1], y: b[2], tx: Math.floor(b[1] / TILE), ty: Math.floor(b[2] / TILE), room: rooms[b[3]]?.id ?? 'pasillo', seal: b[4], sealed: !!b[5], sprite: null as any, t: 0 } as Breach));
    const fx = String(wd.fx ?? '');
    w.map.fixtures.forEach((f, i) => { const v = Number(fx[i] ?? 0); f.broken = !!(v & 1); f.leaking = !!(v & 2); });
    const dl = String(wd.dl ?? '');
    w.map.doors.forEach((d, i) => { d.locked = dl[i] === '1'; });
    this.threat = new Set((wd.th as number[]).map((i) => rooms[i]?.id).filter(Boolean) as RoomId[]);
    const li = wd.li as number[];
    const out: { x: number; y: number; r: number; s: number }[] = [];
    for (let i = 0; i + 3 < li.length; i += 4) out.push({ x: li[i], y: li[i + 1], r: li[i + 2], s: li[i + 3] / 100 });
    w.extraLights = out;
    w.emerg.blackoutT = wd.bo ?? 0;
  }

  private applyPlayers(list: any[]) {
    const w = this.w;
    const present = new Set<number>();
    for (const st of list) {
      const pid = st.p as number;
      present.add(pid);
      this.names.set(pid, st.n);
      if (pid === this.myPid) continue;
      let r = this.replicas.get(pid);
      if (!r) {
        r = w.addReplica(pid, st.n, this.s.peers.get(pid)?.look);
        r.x = st.x; r.y = st.y;
        this.replicas.set(pid, r);
      }
      r.net = st as NetPlayerState;
    }
    for (const [pid, r] of this.replicas) if (!present.has(pid)) { w.removeReplica(r); this.replicas.delete(pid); }
  }

  private applyHud(h: any) {
    const w = this.w;
    this.hud = h;
    this.alerts = h.al ?? [];
    this.tasks = h.tk ?? [];
    w.setCooldowns(h.cd?.[0] ?? 0, h.cd?.[1] ?? 0);
    w.disease.contam.clear();
    for (const [room, v] of Object.entries(h.ct ?? {})) w.disease.contam.set(room as RoomId, v as number);
    w.favors = h.favors ?? w.favors;
  }

  private applyMe(m: any) {
    const p = this.w.player;
    if (m.hp < p.hp - 0.5) { p.hurtFlash = 0.15; if (p.hp - m.hp >= 4) audio.sfx('hurt'); }
    p.hp = m.hp; p.maxHp = m.mh; p.o2 = m.o2;
    for (const [id, v] of Object.entries(m.tl ?? {}) as [ToolId, number[]][]) {
      const t = p.tools[id];
      if (t) { t.charge = v[0]; t.cap = v[1]; t.dur = v[2]; t.broken = !!v[3]; }
    }
    if (Array.isArray(m.av) && m.av.join() !== p.available.join()) {
      p.available = m.av;
      if (!p.available.includes(p.tool)) p.setTool(p.available[0], true);
    }
    p.carrying = m.car ?? null;
    p.body = m.cn ? ({ name: m.cn } as any) : null;
    if (m.inv > p.invertT) p.invertT = m.inv;
    p.hasSuper = !!m.sup;
    this.prompt = m.pr ?? null;
    this.respawnIn = m.rs ?? 0;
    if (m.dead && !p.dead) { p.dead = true; p.fallT = 99; p.sprite.setAngle(90); p.using = false; }
    if (m.tp && m.tp.seq !== this.tpSeq) {
      this.tpSeq = m.tp.seq;
      if (p.dead || !m.dead) p.respawn(m.tp.x, m.tp.y);
    }
  }

  private follow(ref: string): (() => { x: number; y: number } | null) {
    const w = this.w;
    if (ref.startsWith('p')) {
      const pid = Number(ref.slice(1));
      return () => {
        const p = pid === this.myPid ? w.player : this.replicas.get(pid);
        return p && !p.hidden ? { x: p.x, y: p.y - 19 - p.floatOff } : null;
      };
    }
    const id = ref.slice(1);
    return () => {
      const m = this.objs.get(id);
      return m && m.go.visible && m.go.active ? { x: m.go.x, y: m.go.y - 20 } : null;
    };
  }

  private applyEvent(ev: any) {
    const w = this.w;
    switch (ev.e) {
      case 'fx': {
        if (ev.o) break; // efecto continuo de la herramienta de un conserje: esta pantalla ya lo dibuja
        const f = (w.fx as any)[ev.n];
        if (typeof f !== 'function') break;
        const args = [...ev.a];
        if (ev.n === 'gasStream') { const room = w.map.rooms.find((r) => r.id === args[2]); if (!room) break; args[2] = room; }
        f.apply(w.fx, args);
        break;
      }
      case 'sfx': if (!ev.o) audio.sfx(ev.n); break;
      case 'msg': ui.message(ev.t, ev.s); break;
      case 'toast': ui.toast(ev.t, ev.i); break;
      case 'flash': ui.flash(ev.c); break;
      case 'shake': if (!saves.data.settings.reduceFx) w.cameras.main.shake(ev.d, ev.i); break;
      case 'say': ui.labels.bubble(`b:${ev.r}`, ev.w, ev.t, this.follow(ev.r), ev.r === `p${this.myPid}`); break;
      case 'float': ui.labels.float(ev.t, ev.x, ev.y, ev.c); break;
      case 'place': ui.labels.place(ev.id, ev.h, ev.x, ev.y, ev.c); break;
      case 'hide': ui.labels.hide(ev.id); break;
    }
  }

  // ───────── cada fotograma ─────────

  update(dt: number, interact: boolean) {
    const w = this.w;
    const now = performance.now() / 1000;
    for (const m of this.objs.values()) {
      if (!m.at || m.stable) continue;
      const age = now - m.at;
      const px = age < 0.12 ? m.tx + m.vx * age : m.tx;
      const py = age < 0.12 ? m.ty + m.vy * age : m.ty;
      const go = m.go;
      if (Math.abs(px - go.x) < 0.05 && Math.abs(py - go.y) < 0.05) continue;
      const k = Math.min(1, dt * 18);
      go.setPosition(go.x + (px - go.x) * k, go.y + (py - go.y) * k);
    }
    for (const r of this.replicas.values()) r.replicaTick(dt);
    this.sprays = this.sprays.filter((s) => s.until > now);
    for (const s of this.sprays) w.cleaning.visualNpcSpray(s.key, s.x, s.y, s.tx, s.ty, dt);
    if (this.prompt && w.started && !w.player.dead) ui.labels.prompt(this.prompt.x, this.prompt.y, this.prompt.label, this.prompt.progress);
    else ui.labels.hide('prompt');
    this.inT -= dt;
    if (this.inT <= 0 && w.started) {
      this.inT = 0.05;
      this.s.sendUp({ k: 'in', ...w.player.netState(), e: interact ? 1 : 0 });
    }
  }

  send(d: object) { this.s.sendUp({ k: 'act', ...d }); }

  /** entrada neutra (ventana sin foco): el anfitrión deja de ver a este conserje fregando o andando */
  sendIdle() {
    if (!this.w.started) return;
    this.s.sendUp({ k: 'in', ...this.w.player.netState(), u: 0, e: 0, m: 0 });
  }

  /** HUD del invitado: su conserje + el estado compartido que manda el anfitrión */
  hudState(): HudState {
    const w = this.w;
    const p = w.player;
    const h = this.hud ?? {};
    const room = w.map.roomAtPx(p.x, p.y) ?? 'pasillo';
    let status = '';
    if (p.dead) status = this.respawnIn > 0 ? `Fuera de servicio · repuesto en ${this.respawnIn} s` : 'Fuera de servicio';
    else if (w.ship.zeroG) status = 'Sin gravedad: inercia total';
    else if (p.invertT > 0) status = '¡Controles invertidos!';
    else if (p.isDown) status = '¡Resbalón!';
    else if (p.stunT > 0) status = 'Aturdido';
    else if (p.carrying === 'body') status = `Cargando a ${p.body?.name ?? 'alguien'} → enfermería`;
    else if (p.carrying) status = 'Cargando basura → vertedero';
    else if (p.stamina < 15) status = 'Agotado';
    const view = w.cameras.main.worldView;
    ui.updateArrows(this.alerts, { x: view.x, y: view.y, w: view.width, h: view.height }, w.cameras.main.zoom);
    return {
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina, o2: p.o2, status,
      night: w.cfg.night, mode: w.cfg.mode, modeLabel: h.modeLabel ?? '', timeStr: h.timeStr ?? '22:00', subStr: h.subStr ?? '', progress: h.progress ?? 0,
      clean: w.ship.hygiene, integrity: w.ship.integrity, power: w.ship.power, oxygen: w.ship.oxygen, morale: w.ship.morale, zeroG: w.ship.zeroG,
      contam: h.gc ?? 0, credits: h.credits ?? 0,
      tool: p.tool, tools: p.tools, available: p.available, carrying: p.carrying, carryName: p.body?.name ?? null,
      tasks: this.tasks, alerts: this.alerts, roomName: ROOM_NAMES[room], roomClean: w.dirt.roomClean(room), favors: h.favors ?? 0,
      boss: h.boss ?? null,
      roster: this.roster(),
    };
  }

  roster(): string[] { return [...this.names.entries()].map(([pid, n]) => (pid === this.myPid ? `${n} (tú)` : n)); }

  /** puntos del minimapa (tripulación y criaturas) */
  dots(): number[] { return this.hud?.dots ?? []; }

  private onEnd(report: Report) {
    const w = this.w;
    if (w.over) return;
    w.over = true;
    w.cleaning.stopLoops();
    audio.stopLoops();
    const d = saves.data;
    d.credits = Math.max(0, d.credits + report.total);
    d.shifts++;
    const ups = saves.addXp(report.xp);
    d.history.push({ date: new Date().toISOString(), mode: `${w.cfg.mode} (cooperativo)`, grade: report.grade, credits: report.total, night: w.cfg.night });
    if (d.history.length > 20) d.history.shift();
    saves.save();
    ui.labels.clear();
    audio.sfx(report.grade === 'DESPEDIDO' ? 'error' : 'coin');
    ui.showEvaluation(report, ups,
      () => ui.toast('El anfitrión decide cuándo empieza el siguiente turno.', 'task'),
      () => ui.toast('El anfitrión decide cuándo empieza el siguiente turno.', 'task'),
      () => ui.handlers.leaveRoom(),
      { guest: true });
  }
}

/** Reparto de los mensajes del anfitrión en un invitado (también fuera de un turno: inicio, sala…). */
export function routeGuestMessages(s: NetSession, hooks: { scene: () => GameScene; start: (cfg: ShiftConfig) => void; lobby: () => void }) {
  s.onRx = (d: any) => {
    if (d?.k === 'start') { hooks.start(d.cfg); return; }
    if (d?.k === 'lobby') { hooks.lobby(); return; }
    hooks.scene().clientSync?.onRx(d);
  };
}

