import type { NetSession } from './Net';

/**
 * CHAT DE VOZ del multijugador.
 * Audio de igual a igual (WebRTC) entre los conserjes de la sala; el servidor del juego solo
 * reenvía la señalización (ofertas, respuestas y candidatos ICE). El micrófono no se abre hasta
 * que el jugador pulsa «Activar micrófono», y se puede usar en modo abierto o «pulsar para hablar».
 */

export type VoiceMode = 'open' | 'ptt';
export interface VoiceSettings { mode: VoiceMode; volume: number; proximity: boolean }
export type LinkState = 'conectando' | 'conectado' | 'sin conexión';

interface Link {
  pid: number;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  buf: Uint8Array<ArrayBuffer> | null;
  level: number;
  state: LinkState;
  initiator: boolean;
  tries: number;
  pendingIce: RTCIceCandidateInit[];
  gain: number;
}

const STORE = 'mop13-voice';
const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SPEAK = 0.035;

export class VoiceChat {
  /** dentro del canal de voz */
  enabled = false;
  micOk = false;
  micError = '';
  /** modo abierto: silenciado con V */
  muted = false;
  /** modo «pulsar para hablar»: V mantenida */
  ptt = false;
  settings: VoiceSettings = { mode: 'open', volume: 0.9, proximity: false };
  links = new Map<number, Link>();
  /** conserjes que han entrado en el canal de voz */
  members = new Set<number>();
  localLevel = 0;
  /** la interfaz se redibuja (estado del canal, conexiones) */
  onChange: (() => void) | null = null;
  /** niveles de voz actualizados (indicadores de quién habla) */
  onLevels: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localBuf: Uint8Array<ArrayBuffer> | null = null;
  private ice: RTCIceServer[] | null = null;
  private timer = 0;
  private spatialAt = 0;
  private wasSpeaking = new Set<number>();
  private keyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private keyUp = (e: KeyboardEvent) => this.onKey(e, false);
  private blur = () => { if (this.ptt) { this.ptt = false; this.applyTrack(); this.changed(); } };

  constructor(private s: NetSession) {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* sin almacenamiento */ }
    s.onSig = (from, d) => { void this.onSig(from, d); };
    document.addEventListener('keydown', this.keyDown);
    document.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
  }

  static get supported() { return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia; }
  static get secure() { return window.isSecureContext; }

  /** ¿está saliendo audio de este micrófono ahora mismo? */
  get transmitting() { return this.enabled && this.micOk && (this.settings.mode === 'open' ? !this.muted : this.ptt); }

  saveSettings() {
    try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* sin almacenamiento */ }
    this.applyTrack();
    this.applyVolumes();
    this.changed();
  }

  private changed() { this.onChange?.(); }

  // ───────── entrar y salir del canal ─────────

  async enable() {
    if (this.enabled) return;
    if (!this.ctx) this.ctx = new AudioContext();
    try { await this.ctx.resume(); } catch { /* */ }
    if (!this.ice) {
      try {
        const r = await fetch(new URL('./mp/ice', location.href), { cache: 'no-store' });
        this.ice = r.ok ? (await r.json()).iceServers ?? DEFAULT_ICE : DEFAULT_ICE;
      } catch { this.ice = DEFAULT_ICE; }
    }
    await this.openMic();
    this.enabled = true;
    this.muted = false;
    this.applyTrack();
    this.s.sendSig('all', { k: 'hello', on: true });
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.measure(), 100);
    this.changed();
  }

  /** pide permiso al navegador (también sirve para reintentarlo) */
  async openMic() {
    if (this.stream) return true;
    if (!VoiceChat.secure) { this.micError = 'El micrófono solo funciona con HTTPS.'; this.micOk = false; return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.micOk = true;
      this.micError = '';
      if (this.ctx) {
        this.localAnalyser = this.ctx.createAnalyser();
        this.localAnalyser.fftSize = 512;
        this.localBuf = new Uint8Array(this.localAnalyser.fftSize);
        this.ctx.createMediaStreamSource(this.stream).connect(this.localAnalyser);
      }
      const track = this.stream.getAudioTracks()[0];
      for (const l of this.links.values()) {
        const tr = l.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (tr) await tr.sender.replaceTrack(track);
      }
      this.applyTrack();
      this.changed();
      return true;
    } catch (e) {
      this.micOk = false;
      const name = (e as DOMException)?.name;
      this.micError = name === 'NotAllowedError' ? 'Permiso de micrófono denegado: solo escucharás.'
        : name === 'NotFoundError' ? 'No se ha encontrado ningún micrófono: solo escucharás.'
        : 'No se pudo abrir el micrófono: solo escucharás.';
      this.changed();
      return false;
    }
  }

  disable() {
    if (!this.enabled) return;
    this.s.sendSig('all', { k: 'bye' });
    for (const pid of [...this.links.keys()]) this.drop(pid);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.micOk = false;
    this.localAnalyser = null;
    this.enabled = false;
    this.ptt = false;
    clearInterval(this.timer);
    this.localLevel = 0;
    this.changed();
  }

  /** al salir de la sala */
  destroy() {
    this.disable();
    document.removeEventListener('keydown', this.keyDown);
    document.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    if (this.s.onSig) this.s.onSig = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  peerLeft(pid: number) {
    this.members.delete(pid);
    this.drop(pid);
    this.changed();
  }

  toggleMute() {
    if (!this.enabled) return;
    this.muted = !this.muted;
    this.applyTrack();
    this.changed();
  }

  setPtt(down: boolean) {
    if (this.ptt === down) return;
    this.ptt = down;
    this.applyTrack();
    this.changed();
  }

  private applyTrack() {
    const t = this.stream?.getAudioTracks()[0];
    if (t) t.enabled = this.transmitting;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled || (e.key !== 'v' && e.key !== 'V')) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (this.settings.mode === 'ptt') this.setPtt(down);
    else if (down && !e.repeat) this.toggleMute();
  }

  // ───────── WebRTC ─────────

  private makeLink(pid: number, initiator: boolean): Link {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? DEFAULT_ICE });
    const audio = new Audio();
    audio.autoplay = true;
    const link: Link = { pid, pc, audio, analyser: null, buf: null, level: 0, state: 'conectando', initiator, tries: 0, pendingIce: [], gain: 1 };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      if (this.ctx) {
        link.analyser = this.ctx.createAnalyser();
        link.analyser.fftSize = 512;
        link.buf = new Uint8Array(link.analyser.fftSize);
        try { this.ctx.createMediaStreamSource(stream).connect(link.analyser); } catch { /* sin análisis de nivel */ }
      }
      this.applyVolumes();
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.s.sendSig(pid, { k: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      link.state = st === 'connected' ? 'conectado' : st === 'failed' || st === 'disconnected' || st === 'closed' ? 'sin conexión' : 'conectando';
      if (st === 'failed' && link.initiator && link.tries < 3 && this.enabled) {
        link.tries++;
        setTimeout(() => { if (this.links.get(pid) === link) void this.offer(link, true); }, 2000);
      }
      this.changed();
    };
    return link;
  }

  private async connect(pid: number) {
    this.drop(pid);
    const link = this.makeLink(pid, true);
    this.links.set(pid, link);
    const tr = link.pc.addTransceiver('audio', { direction: 'sendrecv' });
    const track = this.stream?.getAudioTracks()[0];
    if (track) await tr.sender.replaceTrack(track);
    await this.offer(link, false);
    this.changed();
  }

  private async offer(link: Link, restart: boolean) {
    try {
      const offer = await link.pc.createOffer(restart ? { iceRestart: true } : undefined);
      await link.pc.setLocalDescription(offer);
      this.s.sendSig(link.pid, { k: 'offer', sdp: link.pc.localDescription });
    } catch { link.state = 'sin conexión'; this.changed(); }
  }

  private async onSig(from: number, d: any) {
    switch (d?.k) {
      case 'hello':
        if (d.on) {
          this.members.add(from);
          if (this.enabled) {
            if (!d.reply) this.s.sendSig(from, { k: 'hello', on: true, reply: true });
            // la pareja la inicia siempre el pid más bajo (evita ofertas cruzadas)
            if (this.s.pid < from && !this.links.has(from)) await this.connect(from);
          }
        } else this.peerLeft(from);
        this.changed();
        break;
      case 'offer': {
        if (!this.enabled) return;
        this.members.add(from);
        let link = this.links.get(from);
        if (!link || link.initiator) {
          this.drop(from);
          link = this.makeLink(from, false);
          this.links.set(from, link);
        }
        try {
          await link.pc.setRemoteDescription(d.sdp);
          const tr = link.pc.getTransceivers()[0];
          const track = this.stream?.getAudioTracks()[0];
          if (tr) { tr.direction = 'sendrecv'; if (track && tr.sender.track !== track) await tr.sender.replaceTrack(track); }
          await this.flushIce(link);
          const ans = await link.pc.createAnswer();
          await link.pc.setLocalDescription(ans);
          this.s.sendSig(from, { k: 'answer', sdp: link.pc.localDescription });
        } catch { link.state = 'sin conexión'; }
        this.changed();
        break;
      }
      case 'answer': {
        const link = this.links.get(from);
        if (!link) return;
        try { await link.pc.setRemoteDescription(d.sdp); await this.flushIce(link); } catch { link.state = 'sin conexión'; }
        this.changed();
        break;
      }
      case 'ice': {
        const link = this.links.get(from);
        if (!link || !d.c) return;
        if (link.pc.remoteDescription) { try { await link.pc.addIceCandidate(d.c); } catch { /* candidato obsoleto */ } }
        else link.pendingIce.push(d.c);
        break;
      }
      case 'bye': this.peerLeft(from); break;
    }
  }

  private async flushIce(link: Link) {
    const list = link.pendingIce;
    link.pendingIce = [];
    for (const c of list) { try { await link.pc.addIceCandidate(c); } catch { /* */ } }
  }

  private drop(pid: number) {
    const l = this.links.get(pid);
    if (!l) return;
    this.links.delete(pid);
    try { l.pc.close(); } catch { /* */ }
    l.audio.srcObject = null;
  }

  // ───────── volumen, proximidad y quién habla ─────────

  /**
   * Voz por proximidad: el juego pasa las posiciones de los conserjes (pid → x,y) y la del jugador local.
   * Se oye entero a menos de 9 casillas y se apaga hacia las 32.
   */
  updateSpatial(me: { x: number; y: number } | null, positions: Map<number, { x: number; y: number }>) {
    this.spatialAt = performance.now();
    for (const l of this.links.values()) {
      let g = 1;
      const p = positions.get(l.pid);
      if (this.settings.proximity && me && p) {
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        g = d < 140 ? 1 : d > 520 ? 0 : 1 - (d - 140) / 380;
      }
      l.gain = g;
    }
    this.applyVolumes();
  }

  private applyVolumes() {
    for (const l of this.links.values()) l.audio.volume = Math.max(0, Math.min(1, this.settings.volume * l.gain));
  }

  private rms(an: AnalyserNode, buf: Uint8Array<ArrayBuffer>) {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  private measure() {
    // fuera de un turno (sala de espera) todos se oyen igual
    if (performance.now() - this.spatialAt > 1500) { for (const l of this.links.values()) l.gain = 1; this.applyVolumes(); }
    this.localLevel = this.localAnalyser && this.localBuf && this.transmitting ? this.localLevel * 0.5 + this.rms(this.localAnalyser, this.localBuf) * 0.5 : 0;
    for (const l of this.links.values()) l.level = l.analyser && l.buf ? l.level * 0.5 + this.rms(l.analyser, l.buf) * 0.5 : 0;
    const now = new Set<number>();
    if (this.localLevel > SPEAK) now.add(this.s.pid);
    for (const l of this.links.values()) if (l.level > SPEAK && l.gain > 0.05) now.add(l.pid);
    const diff = now.size !== this.wasSpeaking.size || [...now].some((p) => !this.wasSpeaking.has(p));
    this.wasSpeaking = now;
    if (diff) this.onLevels?.();
  }

  speaking(pid: number) { return this.wasSpeaking.has(pid); }

  linkState(pid: number): LinkState | null { return this.links.get(pid)?.state ?? null; }
}
