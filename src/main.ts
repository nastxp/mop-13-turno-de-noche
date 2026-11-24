import Phaser from 'phaser';
import './ui/style.css';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { ui } from './ui/UI';
import { saves } from './systems/SaveManager';
import { audio } from './systems/AudioManager';
import { randomSeedString } from './core/Rng';
import { SHIFT_SECONDS } from './config';
import { CHALLENGES, STORY } from './data/missions';
import { mp, NetSession, MP_AVAILABLE } from './net/Net';
import { VoiceChat } from './net/Voice';
import { routeGuestMessages } from './net/Sync';
import type { ShiftConfig } from './types';

async function boot() {
  saves.load();
  ui.applySettings();
  const s = saves.data.settings;
  audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('20px "VT323"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* sin fuentes web: se usa monospace */ }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#05040c',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.max(640, window.innerWidth),
      height: Math.max(400, window.innerHeight),
      min: { width: 320, height: 240 },
    },
    scene: [BootScene, GameScene],
    disableContextMenu: true,
    banner: false,
  });

  const gameScene = () => game.scene.getScene('Game') as GameScene;

  // mantener el lienzo al tamaño real de la ventana (incluido el zoom/emulación del navegador)
  const syncSize = () => {
    const el = document.getElementById('game')!;
    const w = el.clientWidth, h = el.clientHeight;
    if (w > 0 && h > 0 && (w !== game.scale.width || h !== game.scale.height)) game.scale.resize(w, h);
  };
  window.addEventListener('resize', syncSize);
  setInterval(syncSize, 400);

  ui.handlers = {
    start: (mode, seed, opts = {}) => {
      audio.init();
      audio.startMusic();
      const d = saves.data;
      seed = seed || randomSeedString();
      let cfg: ShiftConfig;
      if (mode === 'historia') {
        const night = d.night;
        // tras la última noche, la campaña repite misiones cada vez más difíciles
        const mission = night <= STORY.length ? STORY[night - 1].mission : STORY[1 + ((night - 2) % (STORY.length - 1))].mission;
        cfg = { mode, night, seed, difficulty: Math.min(1.9, 0.8 + 0.11 * (night - 1)), duration: SHIFT_SECONDS, mission: mission ?? undefined };
      } else if (mode === 'desafio') {
        const ch = CHALLENGES.find((c) => c.id === opts.challenge) ?? CHALLENGES[0];
        cfg = { mode, night: 1, seed, difficulty: 1.15, duration: ch.duration ?? SHIFT_SECONDS, mission: ch.mission, rules: ch.rules, challenge: ch.id, challengeName: ch.name, challengeDesc: ch.desc };
      } else if (mode === 'zen') cfg = { mode, night: 1, seed, difficulty: 0.5, duration: null };
      else if (mode === 'caos') cfg = { mode, night: 1, seed, difficulty: 1.55, duration: SHIFT_SECONDS };
      else cfg = { mode: 'infinito', night: 1, seed, difficulty: 1, duration: null };
      // en una sala: el anfitrión simula para todos; un invitado que empieza solo abandona la sala
      const ses = mp.session;
      if (ses?.code && ses.isHost) cfg.netRole = 'host';
      else if (ses?.code) leaveSession();
      ui.close();
      gameScene().scene.restart(cfg);
    },
    toMenu: () => {
      ui.close();
      const ses = mp.session;
      if (ses?.code && !ses.isHost) { ui.handlers.leaveRoom(); return; }
      if (ses?.code && ses.isHost) ses.sendTo('all', { k: 'lobby' });
      toAttract();
      if (ses?.code) ui.showLobby(); else ui.showMenu();
    },
    mpCreate: async (name) => {
      const ses = newSession();
      await ses.create(name, saves.data.look);
      ui.showLobby();
    },
    mpJoin: async (code, name) => {
      const ses = newSession();
      try { await ses.join(code, name, saves.data.look); }
      catch (e) { leaveSession(); throw e; }
      ui.showLobby();
    },
    leaveRoom: () => {
      leaveSession();
      ui.close();
      toAttract();
      ui.showMenu();
    },
  };

  const toAttract = () => gameScene().scene.restart({ mode: 'attract', night: 1, seed: randomSeedString(), difficulty: 0.6, duration: null });

  function leaveSession() {
    const ses = mp.session;
    stopBackgroundTicker();
    mp.voice?.destroy();
    mp.voice = null;
    mp.session = null;
    if (ses) { ses.onClosed = null; ses.leave(); }
  }

  /*
   * Pestaña del anfitrión en segundo plano: el navegador congela su bucle de juego y, con él, la nave de todos.
   * Un temporizador en un worker (que el navegador apenas frena) sigue avanzando la simulación mientras la pestaña está oculta.
   */
  let ticker: Worker | null = null;
  function startBackgroundTicker() {
    if (ticker || typeof Worker === 'undefined') return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33);'], { type: 'text/javascript' }));
      ticker = new Worker(url);
      URL.revokeObjectURL(url);
    } catch { ticker = null; return; }
    let last = performance.now();
    ticker.onmessage = () => {
      const now = performance.now();
      const sc = gameScene();
      if (!document.hidden || sc?.netRole !== 'host' || !sc.sys.isActive()) { last = now; return; }
      let dt = Math.min(now - last, 250);
      last = now;
      while (dt > 0) { const d = Math.min(dt, 40); game.step(now, d); dt -= d; }
    };
  }
  function stopBackgroundTicker() { ticker?.terminate(); ticker = null; }

  /** nueva sesión multijugador con sus avisos de sala */
  function newSession() {
    leaveSession();
    const ses = new NetSession();
    mp.session = ses;
    startBackgroundTicker();
    // chat de voz de la sala (el micrófono solo se abre cuando el jugador lo activa)
    const voice = new VoiceChat(ses);
    mp.voice = voice;
    voice.onChange = () => ui.onVoiceChange();
    voice.onLevels = () => ui.onVoiceLevels();
    ses.onPeer = (p, on) => {
      if (!on) voice.peerLeft(p.pid);
      ui.onRoomChange();
      gameScene().hostSync?.onPeer(p, on);
      if (ses.isHost && !gameScene().hostSync) ui.toast(on ? `${p.name} ha entrado en la sala` : `${p.name} ha salido de la sala`, 'task');
    };
    ses.onClosed = (reason) => {
      if (mp.session !== ses) return;
      leaveSession();
      ui.close();
      toAttract();
      ui.showMenu();
      ui.message(reason, 3);
      ui.toast(reason, 'task');
    };
    // mensajes del anfitrión hacia este invitado (inicio de turno, vuelta a la sala, instantáneas…)
    routeGuestMessages(ses, {
      scene: gameScene,
      start: (cfg) => {
        if (ses.isHost) return;
        audio.init();
        audio.startMusic();
        ui.close();
        gameScene().scene.restart({ ...cfg, netRole: 'client' });
      },
      lobby: () => {
        if (ses.isHost) return;
        ui.close();
        toAttract();
        ui.showLobby();
      },
    });
    return ses;
  }

  // enlace compartido: ?sala=CODIGO abre directamente la pantalla para unirse
  const sala = new URLSearchParams(location.search).get('sala');
  if (sala && MP_AVAILABLE) {
    const code = sala.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const open = () => { if (ui.modal === 'menu') ui.showMultiplayer(code); else setTimeout(open, 150); };
    open();
  }

  (window as any).__mop = { game, ui, saves, scene: gameScene, mp };
}

boot();
