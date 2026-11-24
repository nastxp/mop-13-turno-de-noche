export const TILE = 16;
export const MAP_W = 63;
export const MAP_H = 27;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

/** Duración de un turno de historia en segundos reales (22:00 → 06:00). */
export const SHIFT_SECONDS = 480;
export const SHIFT_START_HOUR = 22;
export const SHIFT_HOURS = 8;

export const DEPTH = {
  floor: 0,
  floorProp: 0.5,
  dirt: 1,
  wet: 1.8,
  wallFix: 2,
  fx: 30,
  light: 40,
  glow: 41,
  overlay: 45,
  reticle: 46,
};

/** Orden de pintado por coordenada Y (perspectiva 3/4). */
export const sortDepth = (y: number) => 10 + y / 100;

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
