import type { RoomId } from '../types';

export type PropKind =
  | 'console' | 'captainChair' | 'holoTable' | 'gravityGen' | 'plant' | 'coffee' | 'counter' | 'table'
  | 'toilet' | 'sink' | 'vent' | 'bin' | 'tank' | 'bench' | 'reactor' | 'reactorConsole' | 'pipes'
  | 'barrel' | 'toolrack' | 'bed' | 'locker' | 'medkit' | 'station' | 'chute' | 'vending'
  | 'medBed' | 'medPod' | 'medScanner' | 'medCabinet' | 'plantBed' | 'hydroTank' | 'secretLocker';

export interface PropDef {
  w: number;
  h: number;
  blocks: boolean;
  /** píxeles que sobresalen por encima de la huella (perspectiva 3/4) */
  up: number;
  name: string;
  floorLevel?: boolean;
}

export const PROP_DEFS: Record<PropKind, PropDef> = {
  console: { w: 2, h: 1, blocks: true, up: 8, name: 'Consola' },
  captainChair: { w: 1, h: 1, blocks: true, up: 9, name: 'Sillón del capitán' },
  holoTable: { w: 4, h: 1, blocks: true, up: 8, name: 'Mesa holográfica de control' },
  gravityGen: { w: 2, h: 2, blocks: true, up: 10, name: 'Generador de gravedad' },
  plant: { w: 1, h: 1, blocks: true, up: 9, name: 'Planta' },
  coffee: { w: 1, h: 1, blocks: true, up: 12, name: 'Cafetera' },
  counter: { w: 4, h: 1, blocks: true, up: 6, name: 'Fogones' },
  table: { w: 2, h: 1, blocks: true, up: 4, name: 'Mesa' },
  toilet: { w: 1, h: 1, blocks: true, up: 8, name: 'Inodoro' },
  sink: { w: 1, h: 1, blocks: true, up: 8, name: 'Lavabo' },
  vent: { w: 1, h: 1, blocks: false, up: 0, name: 'Rejilla de ventilación', floorLevel: true },
  bin: { w: 1, h: 1, blocks: true, up: 4, name: 'Papelera' },
  tank: { w: 1, h: 1, blocks: true, up: 14, name: 'Tanque de especímenes' },
  bench: { w: 3, h: 1, blocks: true, up: 6, name: 'Mesa de laboratorio' },
  reactor: { w: 2, h: 2, blocks: true, up: 14, name: 'Reactor' },
  reactorConsole: { w: 1, h: 1, blocks: true, up: 8, name: 'Consola del reactor' },
  pipes: { w: 2, h: 1, blocks: true, up: 14, name: 'Tuberías del motor' },
  barrel: { w: 1, h: 1, blocks: true, up: 6, name: 'Bidón de aceite' },
  toolrack: { w: 2, h: 1, blocks: true, up: 12, name: 'Panel de herramientas' },
  bed: { w: 1, h: 2, blocks: true, up: 3, name: 'Litera' },
  locker: { w: 1, h: 1, blocks: true, up: 14, name: 'Taquilla' },
  medkit: { w: 1, h: 1, blocks: true, up: 10, name: 'Botiquín' },
  station: { w: 2, h: 1, blocks: true, up: 14, name: 'Estación del conserje' },
  chute: { w: 1, h: 1, blocks: true, up: 10, name: 'Vertedero de residuos' },
  vending: { w: 1, h: 1, blocks: true, up: 14, name: 'Máquina expendedora' },
  medBed: { w: 1, h: 2, blocks: true, up: 4, name: 'Camilla' },
  medPod: { w: 1, h: 2, blocks: true, up: 12, name: 'Cápsula de recuperación' },
  medScanner: { w: 2, h: 1, blocks: true, up: 12, name: 'Escáner médico' },
  medCabinet: { w: 1, h: 1, blocks: true, up: 14, name: 'Armario de medicinas' },
  plantBed: { w: 3, h: 1, blocks: true, up: 10, name: 'Bancal hidropónico' },
  hydroTank: { w: 1, h: 1, blocks: true, up: 16, name: 'Depósito de nutrientes' },
  secretLocker: { w: 1, h: 1, blocks: true, up: 14, name: 'Taquilla de MOP-1' },
};

export type FloorStyle = 'metal' | 'bridge' | 'checker' | 'tiles' | 'lab' | 'grate' | 'carpet' | 'medical' | 'garden';

export interface PropPlace { kind: PropKind; x: number; y: number }

export interface RoomDef {
  id: RoomId;
  name: string;
  short: string;
  floor: FloorStyle;
  accent: string;
  /** columna (local) del panel eléctrico en la pared norte */
  panelX: number;
  /** columna (local) de la tubería de pared, si la hay */
  pipeX?: number;
  props: PropPlace[];
  /** residuos iniciales típicos de la sala */
  typicalDirt: string[];
}

/**
 * Plantillas sobre un interior de 14x9 casillas.
 * Reglas para no bloquear puertas: columnas 5..8 libres en filas 0-1 y 7-8;
 * columnas 0 y 13 libres en filas 3..5 (posibles puertas laterales).
 */
export const ROOM_DEFS: Record<Exclude<RoomId, 'pasillo'>, RoomDef> = {
  puente: {
    id: 'puente', name: 'Cabina de mando', short: 'Puente', floor: 'bridge', accent: '#4ff0ff', panelX: 13,
    props: [
      { kind: 'console', x: 1, y: 0 }, { kind: 'console', x: 3, y: 0 },
      { kind: 'console', x: 9, y: 0 }, { kind: 'console', x: 11, y: 0 },
      { kind: 'holoTable', x: 5, y: 3 },
      { kind: 'captainChair', x: 7, y: 6 },
      { kind: 'gravityGen', x: 11, y: 6 },
      { kind: 'plant', x: 0, y: 8 },
    ],
    typicalDirt: ['cafe', 'polvo', 'huellas'],
  },
  comedor: {
    id: 'comedor', name: 'Comedor', short: 'Comedor', floor: 'checker', accent: '#ff8a3d', panelX: 4,
    props: [
      { kind: 'coffee', x: 1, y: 0 },
      { kind: 'counter', x: 9, y: 0 },
      { kind: 'table', x: 2, y: 3 }, { kind: 'table', x: 10, y: 3 },
      { kind: 'table', x: 2, y: 6 }, { kind: 'table', x: 10, y: 6 },
      { kind: 'bin', x: 0, y: 8 },
      { kind: 'plant', x: 13, y: 8 },
    ],
    typicalDirt: ['comida', 'cafe', 'polvo'],
  },
  banos: {
    id: 'banos', name: 'Baños públicos', short: 'Baños', floor: 'tiles', accent: '#7ab8ff', panelX: 9, pipeX: 11,
    props: [
      { kind: 'toilet', x: 0, y: 0 }, { kind: 'toilet', x: 2, y: 0 },
      { kind: 'toilet', x: 10, y: 0 }, { kind: 'toilet', x: 12, y: 0 },
      { kind: 'sink', x: 9, y: 8 }, { kind: 'sink', x: 11, y: 8 },
      { kind: 'vent', x: 6, y: 4 },
      { kind: 'bin', x: 13, y: 8 },
    ],
    typicalDirt: ['agua', 'huellas', 'polvo'],
  },
  laboratorio: {
    id: 'laboratorio', name: 'Laboratorio científico', short: 'Laboratorio', floor: 'lab', accent: '#5dff9b', panelX: 9, pipeX: 4,
    props: [
      { kind: 'tank', x: 0, y: 0 }, { kind: 'tank', x: 2, y: 0 },
      { kind: 'tank', x: 11, y: 0 }, { kind: 'tank', x: 13, y: 0 },
      { kind: 'bench', x: 1, y: 4 }, { kind: 'bench', x: 10, y: 4 },
      { kind: 'vent', x: 6, y: 6 },
      { kind: 'bin', x: 0, y: 8 },
      { kind: 'plant', x: 13, y: 8 },
    ],
    typicalDirt: ['quimico', 'polvo'],
  },
  ingenieria: {
    id: 'ingenieria', name: 'Ingeniería', short: 'Ingeniería', floor: 'grate', accent: '#ffd23f', panelX: 4, pipeX: 9,
    props: [
      { kind: 'reactor', x: 6, y: 3 },
      { kind: 'reactorConsole', x: 9, y: 4 },
      { kind: 'pipes', x: 0, y: 0 }, { kind: 'pipes', x: 11, y: 0 },
      { kind: 'barrel', x: 0, y: 8 }, { kind: 'barrel', x: 1, y: 8 }, { kind: 'barrel', x: 13, y: 7 },
      { kind: 'toolrack', x: 11, y: 8 },
      { kind: 'vent', x: 3, y: 6 },
    ],
    typicalDirt: ['aceite', 'hollin', 'polvo'],
  },
  dormitorios: {
    id: 'dormitorios', name: 'Dormitorios', short: 'Dormitorios', floor: 'carpet', accent: '#b067ff', panelX: 5,
    props: [
      { kind: 'bed', x: 0, y: 0 }, { kind: 'bed', x: 2, y: 0 },
      { kind: 'bed', x: 11, y: 0 }, { kind: 'bed', x: 13, y: 0 },
      { kind: 'locker', x: 0, y: 8 }, { kind: 'locker', x: 1, y: 8 }, { kind: 'locker', x: 2, y: 8 },
      { kind: 'medkit', x: 13, y: 8 },
      { kind: 'bin', x: 10, y: 8 },
      { kind: 'vent', x: 9, y: 5 },
    ],
    typicalDirt: ['polvo', 'basura', 'huellas'],
  },
  enfermeria: {
    id: 'enfermeria', name: 'Enfermería', short: 'Enfermería', floor: 'medical', accent: '#ff6e7a', panelX: 9,
    props: [
      { kind: 'medBed', x: 0, y: 0 }, { kind: 'medBed', x: 2, y: 0 }, { kind: 'medBed', x: 11, y: 0 }, { kind: 'medBed', x: 13, y: 0 },
      { kind: 'medScanner', x: 3, y: 4 },
      { kind: 'medPod', x: 10, y: 6 },
      { kind: 'medCabinet', x: 0, y: 8 }, { kind: 'medCabinet', x: 1, y: 8 },
      { kind: 'sink', x: 12, y: 8 },
      { kind: 'bin', x: 3, y: 8 },
      { kind: 'vent', x: 7, y: 4 },
    ],
    typicalDirt: ['agua', 'basura', 'huellas'],
  },
  hidroponico: {
    id: 'hidroponico', name: 'Jardín hidropónico', short: 'Hidropónico', floor: 'garden', accent: '#8adf5a', panelX: 4, pipeX: 9,
    props: [
      { kind: 'plantBed', x: 1, y: 3 }, { kind: 'plantBed', x: 10, y: 3 },
      { kind: 'plantBed', x: 1, y: 6 }, { kind: 'plantBed', x: 10, y: 6 },
      { kind: 'hydroTank', x: 0, y: 0 }, { kind: 'hydroTank', x: 13, y: 0 },
      { kind: 'bin', x: 11, y: 0 },
      { kind: 'plant', x: 0, y: 8 }, { kind: 'plant', x: 13, y: 8 },
      { kind: 'vent', x: 7, y: 5 },
    ],
    typicalDirt: ['tierra', 'agua', 'polvo'],
  },
};

export const ROOM_NAMES: Record<RoomId, string> = {
  puente: 'Cabina de mando',
  comedor: 'Comedor',
  banos: 'Baños públicos',
  laboratorio: 'Laboratorio',
  ingenieria: 'Ingeniería',
  dormitorios: 'Dormitorios',
  enfermeria: 'Enfermería',
  hidroponico: 'Jardín hidropónico',
  pasillo: 'Pasillo central',
};
