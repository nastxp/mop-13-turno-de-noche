import type { HatStyle } from '../data/crew';

export interface PeerLook { uniform: string; hat: HatStyle }
export interface Peer { pid: number; name: string; look: PeerLook; host?: boolean }
export interface RoomInfo { code: string; pid: number; host: boolean; peers: Peer[] }

/** ¿Hay servidor multijugador? (el artifact no lo tiene: es una página estática) */
export const MP_AVAILABLE = import.meta.env.MODE !== 'artifact';

const url = (p: string) => new URL(p, location.href);

/**
 * Sesión multijugador: transporte (WebSocket o sondeo largo) + sala con código.
 * El servidor solo repite mensajes; el anfitrión es quien simula la nave.
 */
export class NetSession {
  role: 'host' | 'client' = 'client';
  pid = 0;
  code = '';
  peers = new Map<number, Peer>();
  transport: 'ws' | 'poll' | null = null;
  open = false;
  /** invitado: mensaje del anfitrión */
  onRx: ((d: any) => void) | null = null;
  /** anfitrión: mensaje de un invitado */
  onUp: ((from: number, d: any) => void) | null = null;
  onPeer: ((p: Peer, on: boolean) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;
  /** señalización del chat de voz (entre cualquier pareja de la sala) */
  onSig: ((from: number, d: any) => void) | null = null;
  private ws: WebSocket | null = null;
  private sid = '';
  private outbox: string[] = [];
  private flushTimer = 0;
  private pending: { resolve: (r: RoomInfo) => void; reject: (e: Error) => void } | null = null;
  private closedByUs = false;

  get isHost() { return this.role === 'host'; }
  get size() { return this.peers.size; }

  async connect(): Promise<void> {
    if (this.open) return;
    try { await this.connectWs(3500); this.transport = 'ws'; }
    catch { await this.connectPoll(); this.transport = 'poll'; }
    this.open = true;
  }

  private connectWs(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const u = url('./mp');
      u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let done = false;
      let ws: WebSocket;
      try { ws = new WebSocket(u.href); } catch (e) { reject(e); return; }
      const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { /* */ } reject(new Error('timeout')); } }, timeout);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(t); this.ws = ws; resolve(); };
      ws.onerror = () => { if (done) return; done = true; clearTimeout(t); reject(new Error('ws')); };
      ws.onmessage = (e) => { try { this.handle(JSON.parse(String(e.data))); } catch { /* mensaje inválido */ } };
      ws.onclose = () => { if (this.ws === ws) this.lost(); };
    });
  }

  private async connectPoll() {
    const r = await fetch(url('./mp/open'), { method: 'POST' });
    if (!r.ok) throw new Error('No hay servidor multijugador');
    this.sid = (await r.json()).sid;
    this.recvLoop();
  }

  private async recvLoop() {
    while (this.sid) {
      try {
        const r = await fetch(url(`./mp/recv?sid=${this.sid}`), { cache: 'no-store' });
        if (r.status === 410) { this.lost(); return; }
        if (!r.ok) { await new Promise((res) => setTimeout(res, 800)); continue; }
        const arr = await r.json();
        for (const m of arr) this.handle(m);
      } catch {
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
  }

  private lost() {
    const wasOpen = this.open;
    this.open = false;
    this.ws = null;
    this.sid = '';
    if (wasOpen && !this.closedByUs) this.onClosed?.('Se ha perdido la conexión con el servidor.');
  }

  private raw(obj: unknown) {
    const s = JSON.stringify(obj);
    if (this.ws) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s); return; }
    if (!this.sid) return;
    this.outbox.push(s);
    if (!this.flushTimer) this.flushTimer = window.setTimeout(() => this.flush(), 40);
  }

  private async flush() {
    this.flushTimer = 0;
    if (!this.outbox.length || !this.sid) return;
    const body = '[' + this.outbox.join(',') + ']';
    this.outbox = [];
    try { await fetch(url(`./mp/send?sid=${this.sid}`), { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }); }
    catch { /* se reintenta con el siguiente envío */ }
  }

  /** bytes pendientes de enviar (para no saturar conexiones lentas) */
  backlog(): number { return this.ws ? this.ws.bufferedAmount : this.outbox.reduce((a, s) => a + s.length, 0); }

  private handle(m: any) {
    switch (m.t) {
      case 'room': {
        this.code = m.code;
        this.pid = m.pid;
        this.role = m.host ? 'host' : 'client';
        this.peers.clear();
        for (const p of m.peers as Peer[]) this.peers.set(p.pid, p);
        this.pending?.resolve(m);
        this.pending = null;
        break;
      }
      case 'err':
        this.pending?.reject(new Error(m.msg));
        this.pending = null;
        break;
      case 'peer': {
        const p: Peer = { pid: m.pid, name: m.name, look: m.look, host: m.host };
        if (m.on) this.peers.set(p.pid, p); else this.peers.delete(p.pid);
        this.onPeer?.(p, !!m.on);
        break;
      }
      case 'rx': this.onRx?.(m.d); break;
      case 'sig': this.onSig?.(m.from, m.d); break;
      case 'up': this.onUp?.(m.from, m.d); break;
      case 'closed':
        this.peers.clear();
        this.onClosed?.('El anfitrión ha cerrado la partida.');
        break;
    }
  }

  private request(msg: object): Promise<RoomInfo> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.raw(msg);
      setTimeout(() => { if (this.pending) { this.pending = null; reject(new Error('El servidor no responde.')); } }, 8000);
    });
  }

  async create(name: string, look: PeerLook) { await this.connect(); return this.request({ t: 'create', name, look }); }
  async join(code: string, name: string, look: PeerLook) { await this.connect(); return this.request({ t: 'join', code: code.toUpperCase(), name, look }); }

  /** anfitrión → invitados ('all' o un pid concreto) */
  sendTo(to: number | 'all', d: unknown) { this.raw({ t: 'tx', to, d }); }
  /** invitado → anfitrión */
  sendUp(d: unknown) { this.raw({ t: 'up', d }); }
  /** chat de voz: a un conserje concreto o a toda la sala */
  sendSig(to: number | 'all', d: unknown) { this.raw({ t: 'sig', to, d }); }

  leave() {
    this.closedByUs = true;
    try { this.raw({ t: 'bye' }); } catch { /* */ }
    if (this.ws) { try { this.ws.close(); } catch { /* */ } }
    else if (this.sid) { const sid = this.sid; this.flush().then(() => fetch(url(`./mp/close?sid=${sid}`), { method: 'POST' }).catch(() => {})); }
    this.ws = null;
    this.sid = '';
    this.open = false;
    this.peers.clear();
  }
}

/** sesión activa (una por pestaña) y su chat de voz */
export const mp: { session: NetSession | null; voice: import('./Voice').VoiceChat | null } = { session: null, voice: null };

export function shareLink(code: string) {
  const u = new URL(location.href);
  u.search = `?sala=${code}`;
  u.hash = '';
  return u.href;
}
