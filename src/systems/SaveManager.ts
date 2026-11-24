import type { SpecId, UpgradeId } from '../data/upgrades';
import type { HatStyle } from '../data/crew';

export interface SaveData {
  version: 2;
  credits: number;
  xp: number;
  level: number;
  night: number;
  shifts: number;
  bestInfinite: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  achievements: string[];
  settings: { master: number; music: number; sfx: number; reduceFx: boolean; uiScale: number; autoPause: boolean; touch: 'auto' | 'on' | 'off'; view: 'classic' | 'iso'; viewSet: boolean };
  lastSeed: string;
  history: { date: string; mode: string; grade: string; credits: number; night: number }[];
  spec: SpecId | null;
  look: { uniform: string; hat: HatStyle };
  secrets: { notes: number[]; socks: number; prophecies: number; conspiracy: number[]; eternalCleans: number; lockers: number };
  /** la nave recuerda tu forma de jugar */
  memory: { roomClean: Record<string, number[]>; foam: number[]; disinfect: number[]; helped: Record<string, number> };
  bosses: string[];
  missionsDone: string[];
}

const KEY = 'mop13-save-v1';

const fresh = (): SaveData => ({
  version: 2, credits: 0, xp: 0, level: 1, night: 1, shifts: 0, bestInfinite: 0, upgrades: {}, achievements: [],
  settings: { master: 0.8, music: 0.45, sfx: 0.8, reduceFx: false, uiScale: 1, autoPause: true, touch: 'auto', view: 'iso', viewSet: false },
  lastSeed: '', history: [], spec: null, look: { uniform: 'amarillo', hat: 'cap' },
  secrets: { notes: [], socks: 0, prophecies: 0, conspiracy: [], eternalCleans: 0, lockers: 0 },
  memory: { roomClean: {}, foam: [], disinfect: [], helped: {} },
  bosses: [], missionsDone: [],
});

/** Guardado en localStorage (tolerante a navegadores que lo bloquean). */
class SaveManager {
  data: SaveData = fresh();

  load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const old = JSON.parse(raw);
        const f = fresh();
        this.data = { ...f, ...old, version: 2, settings: { ...f.settings, ...(old.settings ?? {}) }, look: { ...f.look, ...(old.look ?? {}) },
          secrets: { ...f.secrets, ...(old.secrets ?? {}) }, memory: { ...f.memory, ...(old.memory ?? {}) } };
        // la vista de bloques es la inicial: solo se respeta la clásica si se eligió a mano en Opciones
        if (!this.data.settings.viewSet) this.data.settings.view = 'iso';
      }
    } catch { /* almacenamiento no disponible */ }
    return this.data;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignorar */ }
  }

  reset() {
    this.data = fresh();
    this.save();
  }

  xpForLevel(level: number) { return 100 + (level - 1) * 80; }

  addXp(xp: number): number {
    let ups = 0;
    this.data.xp += xp;
    while (this.data.xp >= this.xpForLevel(this.data.level)) {
      this.data.xp -= this.xpForLevel(this.data.level);
      this.data.level++;
      ups++;
    }
    return ups;
  }
}

export const saves = new SaveManager();
