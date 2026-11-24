import { TILE } from '../config';
import { audio } from './AudioManager';
import { bus } from '../core/EventBus';
import { TOOLS } from '../data/tools';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from '../entities/Player';

export interface Interactable {
  id: string;
  x: number;
  y: number;
  label: string;
  dur: number;
  act: () => void;
  range?: number;
  prio?: number;
}

/** Interacciones con [E]: reparar, desatascar, reanimar, retirar cuerpos, vaciar, gadgets, secretos… */
export class Interaction {
  current: Interactable | null = null;
  progress = 0;
  /** indicación para un conserje remoto (el anfitrión se la envía a su pantalla) */
  prompt: { label: string; x: number; y: number; progress: number } | null = null;
  private coffeeCd = 0;
  private lock = false;

  /** una instancia por conserje: cada uno tiene su propia indicación y su barra de progreso */
  constructor(private w: GameScene, readonly p: Player) {}

  /** multiplicador de duración para trabajos de mantenimiento */
  private repairMul() {
    const w = this.w;
    return (w.upg.reparador ? 0.6 : 1) * (w.spec === 'emergencias' ? 0.67 : 1);
  }

  private gather(): Interactable[] {
    const w = this.w;
    const p = this.p;
    const out: Interactable[] = [];
    const m = w.map;
    const rk = this.repairMul();

    // ── llevando un cuerpo: solo se puede entregar, (intentar) tirar o soltar ──
    if (p.carrying === 'body' && p.body) {
      const body = p.body;
      for (const pr of m.props) {
        if (pr.kind !== 'medPod' && pr.kind !== 'chute') continue;
        const c = m.tileCenter(pr.spots[0]?.tx ?? pr.tx, pr.spots[0]?.ty ?? pr.ty + pr.h);
        if (pr.kind === 'medPod') out.push({ id: `pod:${pr.id}`, x: c.x, y: c.y, label: `Depositar a ${body.name} en la cápsula médica`, dur: 1, prio: 4, range: 26,
          act: () => {
            w.combat.deliver(body);
            p.carrying = null;
            p.body = null;
            bus.emit('body:delivered', body);
            w.fx.sparkle(c.x, c.y - 10, 10);
          } });
        else out.push({ id: 'chute-body', x: c.x, y: c.y, label: 'Tirar el cuerpo por el vertedero', dur: 0.6, prio: 3, range: 24,
          act: () => { w.announce('bodyChute'); w.floatText(c.x, c.y - 20, 'Protocolo: NO', 'bad'); audio.sfx('error'); } });
      }
      out.push({ id: 'drop-body', x: p.x, y: p.y, label: 'Soltar el cuerpo', dur: 0.4, prio: -3, range: 999,
        act: () => { w.combat.dropAt(body, p.x + p.aim.x * 8, p.y + 4); p.carrying = null; p.body = null; audio.sfx('pickup'); } });
      return out;
    }

    for (const f of m.fixtures) {
      const c = m.tileCenter(f.spot.tx, f.spot.ty);
      if (f.kind === 'panel' && f.broken) {
        out.push({ id: `fix:${f.id}`, x: c.x, y: c.y - 4, label: f.isGravity ? 'Reparar el generador de gravedad' : 'Reparar panel eléctrico', dur: (f.isGravity ? 2.4 : 1.6) * rk, prio: 2,
          act: () => {
            if (w.dirt.surfaceAt(p.x, p.y).conductive) {
              p.hurt(8, 'descarga eléctrica');
              p.stunT = 0.6;
              w.fx.zap(p.x, p.y - 8);
              audio.sfx('zap');
              p.sayKey('shock', true);
            }
            w.emerg.repairFixture(f);
          } });
      }
      if (f.kind === 'pipe' && f.leaking) {
        out.push({ id: `fix:${f.id}`, x: c.x, y: c.y - 4, label: 'Reparar tubería', dur: 1.4 * rk, prio: 2, act: () => w.emerg.repairFixture(f) });
      }
    }
    for (const b of w.emerg.breaches) {
      if (b.sealed) continue;
      out.push({ id: `breach:${b.id}`, x: b.x, y: b.y + 6, label: 'Parchear la brecha', dur: 2.4 * rk, prio: 3, range: 24, act: () => w.emerg.seal(b, 1, true) });
    }
    for (const pr of m.props) {
      const sp = pr.spots[0];
      if (!sp) continue;
      const near = pr.spots.reduce((best, s) => {
        const c = m.tileCenter(s.tx, s.ty);
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        return d < best.d ? { d, c } : best;
      }, { d: 1e9, c: m.tileCenter(sp.tx, sp.ty) }).c;
      switch (pr.kind) {
        case 'toilet':
          if (pr.state.clog) out.push({ id: `toilet:${pr.id}`, x: near.x, y: near.y, label: 'Desatascar inodoro', dur: 1.2 * rk, prio: 2, act: () => w.emerg.unclog(pr) });
          else if (w.secrets.prophetToilet === pr && !w.secrets.usedProphecy)
            out.push({ id: `prophet:${pr.id}`, x: near.x, y: near.y, label: 'Mirar dentro del inodoro (brilla)', dur: 1, prio: 1, act: () => w.secrets.consultProphecy() });
          break;
        case 'reactorConsole':
          if (w.emerg.overheating) out.push({ id: 'reactor', x: near.x, y: near.y, label: 'Purgar el reactor', dur: 1.4 * rk, prio: 3, act: () => w.emerg.vent(true) });
          break;
        case 'station': {
          const t = p.tools;
          const refillable = p.available.filter((id) => TOOLS[id].refill && id !== 'fregona' && id !== 'superfregona');
          const need = t.fregona.charge > 5 || t.fregona.broken || t.fregona.dur < 90 || t.aspiradora.broken || t.aspiradora.dur < 90 || t.aspiradora.charge > 5
            || refillable.some((id) => t[id].charge < t[id].cap - 5) || t.superfregona.charge > 5;
          if (need) out.push({ id: 'station', x: near.x, y: near.y, label: 'Aclarar, recargar y reparar herramientas', dur: 0.6, prio: 1, range: 24,
            act: () => {
              t.fregona.charge = 0; t.fregona.dur = 100; t.fregona.broken = false;
              t.superfregona.charge = 0;
              for (const id of refillable) { t[id].charge = t[id].cap; t[id].broken = false; t[id].dur = 100; }
              t.aspiradora.dur = 100; t.aspiradora.broken = false;
              audio.sfx('rinse');
              p.sayKey('ok');
            } });
          break;
        }
        case 'bin':
          if ((pr.state.fill ?? 0) >= 60 && !p.carrying) out.push({ id: `bin:${pr.id}`, x: near.x, y: near.y, label: 'Vaciar papelera', dur: 0.5, prio: 1,
            act: () => {
              pr.state.fill = 0;
              pr.sprite?.setFrame(0);
              p.carrying = 'bag';
              audio.sfx('pickup');
              p.sayKey('carry');
              bus.emit('bin:emptied', pr);
            } });
          break;
        case 'chute':
          if (p.carrying === 'bag') out.push({ id: 'chute', x: near.x, y: near.y, label: 'Tirar la bolsa al vertedero', dur: 0.3, prio: 2, range: 24,
            act: () => { p.carrying = null; w.stats.binsEmptied++; audio.sfx('coin'); w.floatText(near.x, near.y - 20, '¡Fuera!', 'good'); } });
          else if (p.tools.aspiradora.charge > 1) out.push({ id: 'chute', x: near.x, y: near.y, label: 'Vaciar el depósito de la aspiradora', dur: 0.8, prio: 1, range: 24,
            act: () => { p.tools.aspiradora.charge = 0; audio.sfx('flush'); } });
          break;
        case 'medkit': {
          const ch = pr.state.charges ?? 3;
          if (p.hp < p.maxHp - 5 && ch > 0) out.push({ id: 'medkit', x: near.x, y: near.y, label: `Usar botiquín (${ch})`, dur: 1.5, prio: 1,
            act: () => { p.hp = Math.min(p.maxHp, p.hp + 45); pr.state.charges = ch - 1; if (ch - 1 <= 0) pr.sprite?.setFrame(1); audio.sfx('ok'); } });
          break;
        }
        case 'medBed': case 'medPod':
          if (p.hp < p.maxHp - 20 && !w.combat.corpses.length) out.push({ id: `bed:${pr.id}`, x: near.x, y: near.y, label: 'Tumbarse un momento (recupera salud)', dur: 3, prio: 0,
            act: () => { p.hp = Math.min(p.maxHp, p.hp + 30); p.stamina = 100; p.say('Cinco minutitos…', true); audio.sfx('ok'); } });
          break;
        case 'secretLocker':
          if (!pr.state.opened) out.push({ id: 'locker', x: near.x, y: near.y, label: 'Forzar la taquilla de «MOP-1»', dur: 2.6, prio: 1,
            act: () => { pr.state.opened = true; pr.sprite?.setFrame(1); w.secrets.openLocker(p); } });
          break;
        case 'holoTable':
          out.push({ id: 'console', x: near.x, y: near.y, label: 'Panel de control de la nave', dur: 0.2, prio: 0, range: 22, act: () => w.openShipPanel(p) });
          break;
        case 'coffee':
          if (!pr.state.broken && this.coffeeCd <= 0) out.push({ id: 'coffee', x: near.x, y: near.y, label: 'Tomar un café', dur: 1.6, prio: 0,
            act: () => {
              this.coffeeCd = 45;
              p.stamina = 100;
              p.hp = Math.min(p.maxHp, p.hp + 10);
              audio.sfx('pour');
              if (Math.random() < 0.25) { w.dirt.add('cafe', p.x + 4, p.y + 4, 0.8); p.say('Ups. Ya lo friego yo. Como siempre.', true); }
              else p.say('Ahhh. Combustible de conserje.', true);
            } });
          break;
      }
    }
    // cadáveres que retirar
    if (!p.carrying) {
      for (const c of w.combat.corpses) {
        if (c.carried) continue;
        out.push({ id: `corpse:${c.id}`, x: c.x, y: c.y, label: `Recoger el cuerpo de ${c.name}`, dur: 1.2, prio: 2, range: 18,
          act: () => { w.combat.pickUp(c); p.carrying = 'body'; p.body = c; audio.sfx('pickup'); p.say('Lo siento, compañero. A la enfermería.', true); } });
      }
    }
    // secretos y gadgets
    const sock = w.secrets.sockNear(p.x, p.y);
    if (sock) out.push({ id: 'sock', x: sock.x, y: sock.y, label: 'Recoger el calcetín misterioso', dur: 0.4, prio: 1, act: () => w.secrets.takeSock(sock) });
    if (w.bosses.canUnplug()) out.push({ id: 'unplug', x: w.bosses.x, y: w.bosses.y, label: 'Desenchufar al Rey Aspirador', dur: 1.8 * rk, prio: 5, range: 26, act: () => w.bosses.unplug() });
    for (const t of w.traps) {
      out.push({ id: `trap:${t.id}`, x: t.x, y: t.y, label: t.caught ? `Vaciar la trampa (${t.caught.sp.name})` : 'Recoger la trampa', dur: 0.5, prio: t.caught ? 2 : -1, range: 14,
        act: () => {
          if (t.caught) { w.floatText(t.x, t.y - 12, 'Plaga retirada', 'good'); audio.sfx('coin'); }
          w.removeTrap(t);
          p.tools.trampa.charge = Math.min(p.tools.trampa.cap, p.tools.trampa.charge + 1);
        } });
    }
    for (const b of w.bots) {
      out.push({ id: `bot:${b.id}`, x: b.x, y: b.y, label: b.broken ? 'Recoger el dron averiado' : 'Recoger el dron', dur: 0.5, prio: 0, range: 16,
        act: () => { w.removeBot(b); p.tools.robot.charge = 1; audio.sfx('pickup'); } });
    }
    for (const c of w.crew) {
      if (!c.alive || c.hidden) continue;
      if (c.state === 'knocked') out.push({ id: `crew:${c.uid}`, x: c.x, y: c.y, label: `Reanimar a ${c.name}`, dur: 1, prio: 3, act: () => c.rescue() });
      else if (c.available && c.prof !== 'inspector' && !c.isGuest && w.favors > 0 && !c.busy && c.state !== 'flee' && c.arch.helpLabel)
        out.push({ id: `crew:${c.uid}`, x: c.x, y: c.y, label: `${c.arch.helpLabel} (${w.favors})`, dur: 0.4, prio: -1, act: () => w.requestHelp(c, p) });
    }
    for (const d of m.doors) {
      const cx = d.tiles.reduce((a, t) => a + t.tx, 0) / d.tiles.length * TILE + 8;
      const cy = d.tiles.reduce((a, t) => a + t.ty, 0) / d.tiles.length * TILE + 10;
      out.push({ id: `door:${d.id}`, x: cx, y: cy, label: d.locked ? 'Desbloquear puerta' : 'Bloquear puerta', dur: 0.35, prio: -2, range: 22,
        act: () => w.toggleDoor(d) });
    }
    return out;
  }

  update(dt: number, holding: boolean) {
    const w = this.w;
    const p = this.p;
    this.coffeeCd -= dt;
    if (this.lock && !holding) this.lock = false;
    if (this.lock) holding = false;
    const hide = () => { if (p.isLocal) w.ui.labels.hide('prompt'); this.prompt = null; };
    if (!p.active || p.dead || p.isDown) { this.current = null; this.progress = 0; hide(); return; }
    let best: Interactable | null = null, bs = 1e9;
    for (const it of this.gather()) {
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d > (it.range ?? 20)) continue;
      const s = Math.min(d, 40) - (it.prio ?? 0) * 6;
      if (s < bs) { bs = s; best = it; }
    }
    if (!best || (this.current && best.id !== this.current.id) || (this.current && best.label !== this.current.label)) this.progress = 0;
    this.current = best;
    if (!best) { hide(); return; }
    if (holding) {
      this.progress += dt / best.dur;
      if (Math.random() < dt * 6 && best.dur > 1) audio.sfx('repair');
      if (this.progress >= 1) {
        this.progress = 0;
        best.act();
        this.lock = true;
        if (p.isLocal) w.consumeInteractKey();
      }
    } else this.progress = Math.max(0, this.progress - dt * 2);
    const px = best.id === 'drop-body' ? p.x : best.x, py = best.id === 'drop-body' ? p.y : best.y;
    if (p.isLocal) w.ui.labels.prompt(px, py - 18, best.label, this.progress);
    else this.prompt = { label: best.label, x: Math.round(px), y: Math.round(py - 18), progress: Math.round(this.progress * 100) / 100 };
  }
}
