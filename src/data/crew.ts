import type { RoomId } from '../types';
import type { PropKind } from './rooms';
import type { ResidueId } from './residues';

export type ProfessionId =
  | 'capitan' | 'cientifica' | 'ingeniero' | 'cocinero' | 'turista' | 'inspector'
  | 'medica' | 'robot' | 'seguridad' | 'diplomatico' | 'paranoico' | 'contrabandista';

export type HatStyle =
  | 'cap' | 'captain' | 'chef' | 'hardhat' | 'hair' | 'bun' | 'sunhat' | 'slick' | 'bald'
  | 'helmet' | 'medic' | 'alien' | 'beanie' | 'long';

export interface CharLook {
  skin: string;
  hair: string;
  hat: HatStyle;
  hatC?: string;
  top: string;
  pants: string;
  boots: string;
  eye?: string;
  glasses?: string;
  /** dónde van las gafas: sobre los ojos o en la frente */
  glassesOn?: 'eyes' | 'forehead';
  belt?: string;
  collar?: string;
  badge?: string;
  coat?: boolean;
  /** franja reflectante del uniforme */
  stripe?: string;
  gloves?: string;
  zip?: boolean;
  emblem?: string;
  robot?: boolean;
  alien?: boolean;
  armor?: string;
}

/** Rol en las emergencias: quién acude a resolver cada cosa (el conserje solo limpia… si quiere). */
export type ResponderRole = 'combate' | 'tecnico' | 'medico' | 'mantenimiento' | null;

export interface CrewArchetype {
  id: ProfessionId;
  title: string;
  names: string[];
  look: CharLook;
  clumsiness: number;
  resistance: number;
  cooperation: number;
  speed: number;
  bravery: number;
  workRoom: RoomId | null;
  helpLabel: string;
  role: ResponderRole;
  health: number;
}

export const UNIFORM_COLORS: Record<string, { top: string; hat: string; label: string }> = {
  amarillo: { top: '#ffcf33', hat: '#ffd23f', label: 'Amarillo reglamentario' },
  naranja: { top: '#ff8a3d', hat: '#ff9a4a', label: 'Naranja de alta visibilidad' },
  menta: { top: '#5ce0b0', hat: '#7af0c4', label: 'Menta hospitalario' },
  rosa: { top: '#ff6eb0', hat: '#ff8ac4', label: 'Rosa motivacional' },
  violeta: { top: '#9a6aff', hat: '#b48aff', label: 'Violeta nebulosa' },
};

export function playerLook(uniform = 'amarillo', hat: HatStyle = 'cap'): CharLook {
  const u = UNIFORM_COLORS[uniform] ?? UNIFORM_COLORS.amarillo;
  return {
    skin: '#f0b98d', hair: '#5a3a28', hat, hatC: u.hat, top: u.top, pants: '#3d4566', boots: '#6f7fa8',
    belt: '#5b3a1e', eye: '#1b1428', stripe: '#d8f6ff', badge: '#4ff0ff', gloves: '#3a7ad8', zip: true, emblem: '#4ff0ff',
  };
}

export const PLAYER_LOOK: CharLook = playerLook();

const A = (a: CrewArchetype) => a;

export const ARCHETYPES: Record<ProfessionId, CrewArchetype> = {
  capitan: A({
    id: 'capitan', title: 'Capitán', names: ['Capitán Orlando Vex', 'Capitana Brunilda Sol', 'Capitán Teo Marlow'],
    look: { skin: '#e8a982', hair: '#d8d4cc', hat: 'captain', top: '#24346e', pants: '#1b2240', boots: '#14101c', collar: '#ffd23f', badge: '#ffd23f', belt: '#14101c', gloves: '#f2f0ff' },
    clumsiness: 0.5, resistance: 0.6, cooperation: 0.4, speed: 0.9, bravery: 0.2, workRoom: 'puente', helpLabel: 'Pedir órdenes al capitán', role: null, health: 100,
  }),
  cientifica: A({
    id: 'cientifica', title: 'Científica', names: ['Dra. Nadia Quill', 'Dr. Elías Probeta', 'Dra. Ume Okafor'],
    look: { skin: '#c68a5e', hair: '#7a4ad8', hat: 'bun', top: '#eef1f8', pants: '#4a4f6a', boots: '#2a2438', glasses: '#5dff9b', glassesOn: 'forehead', coat: true, badge: '#5dff9b' },
    clumsiness: 0.7, resistance: 0.5, cooperation: 0.7, speed: 1, bravery: 0.5, workRoom: 'laboratorio', helpLabel: 'Pedir análisis científico', role: null, health: 100,
  }),
  ingeniero: A({
    id: 'ingeniero', title: 'Ingeniero', names: ['Ing. Tobías Rivet', 'Ing. Marga Tuerca', 'Ing. Duke Valvulina'],
    look: { skin: '#8d5a3b', hair: '#1e1612', hat: 'hardhat', hatC: '#ff8a3d', top: '#e0682a', pants: '#3b3240', boots: '#2b2420', belt: '#2a2a2a', glasses: '#4ff0ff', glassesOn: 'eyes', stripe: '#ffe27a', gloves: '#5a4a3a' },
    clumsiness: 0.4, resistance: 0.8, cooperation: 0.85, speed: 1, bravery: 0.7, workRoom: 'ingenieria', helpLabel: 'Pedir una reparación', role: 'tecnico', health: 110,
  }),
  cocinero: A({
    id: 'cocinero', title: 'Cocinero', names: ['Chef Bartolo Sartén', 'Chef Ximena Wok', 'Chef Gastón Fondue'],
    look: { skin: '#f2c49b', hair: '#2e2018', hat: 'chef', top: '#f4f4f8', pants: '#2c2c3a', boots: '#1a1a22', collar: '#ff4d5a' },
    clumsiness: 0.6, resistance: 0.7, cooperation: 0.6, speed: 0.95, bravery: 0.5, workRoom: 'comedor', helpLabel: 'Pedir un café', role: null, health: 100,
  }),
  turista: A({
    id: 'turista', title: 'Turista espacial', names: ['Kevin (turista VIP)', 'Sra. Pinkerton (turista)', 'Lolo (turista)'],
    look: { skin: '#f5c7a8', hair: '#e8c35a', hat: 'sunhat', hatC: '#f5e6a8', top: '#ff5d9e', pants: '#3ac6c6', boots: '#f4f4f8', glasses: '#14101c', glassesOn: 'eyes' },
    clumsiness: 0.95, resistance: 0.2, cooperation: 0.3, speed: 1.1, bravery: 0.1, workRoom: null, helpLabel: 'Pedir ayuda al turista', role: null, health: 90,
  }),
  inspector: A({
    id: 'inspector', title: 'Inspector corporativo', names: ['Inspector Grimaldi', 'Inspectora Vallejo'],
    look: { skin: '#e3b495', hair: '#2a2a35', hat: 'slick', top: '#6e7286', pants: '#3a3d4c', boots: '#14101c', collar: '#d8dcea', glasses: '#d8dcea', glassesOn: 'eyes' },
    clumsiness: 0.5, resistance: 0.9, cooperation: 0, speed: 0.8, bravery: 1, workRoom: null, helpLabel: '', role: null, health: 100,
  }),
  medica: A({
    id: 'medica', title: 'Médica', names: ['Dra. Lucía Tirita', 'Dr. Amadou Sutura', 'Dra. Ilse Vendaje'],
    look: { skin: '#a8714c', hair: '#1c1418', hat: 'medic', top: '#e8f4f8', pants: '#5ab8c8', boots: '#f2f0ff', collar: '#ff4d5a', badge: '#ff4d5a', coat: true, gloves: '#8ad8ff' },
    clumsiness: 0.3, resistance: 0.95, cooperation: 0.9, speed: 1.05, bravery: 0.6, workRoom: 'enfermeria', helpLabel: 'Pedir atención médica', role: 'medico', health: 100,
  }),
  robot: A({
    id: 'robot', title: 'Robot de mantenimiento', names: ['R-0B', 'R-0B (versión 2)', 'Unidad R-0B'],
    look: { skin: '#9aa4c0', hair: '#56618a', hat: 'bald', top: '#7a86ad', pants: '#3a4260', boots: '#262b40', robot: true, eye: '#4ff0ff' },
    clumsiness: 0.25, resistance: 1, cooperation: 0.75, speed: 0.85, bravery: 0.9, workRoom: null, helpLabel: 'Reprogramar a R-0B', role: 'mantenimiento', health: 140,
  }),
  seguridad: A({
    id: 'seguridad', title: 'Seguridad', names: ['Sargento Kowalczyk', 'Cabo Ramírez', 'Soldado Pumba', 'Teniente Odalys'],
    look: { skin: '#d49a70', hair: '#2a2016', hat: 'helmet', hatC: '#3e5a3a', top: '#4a6a44', pants: '#2e3a2a', boots: '#1a1a14', belt: '#2a2a1a', armor: '#5c7a52', gloves: '#2a2a1a' },
    clumsiness: 0.55, resistance: 0.85, cooperation: 0.6, speed: 1.1, bravery: 1, workRoom: null, helpLabel: 'Pedir escolta', role: 'combate', health: 160,
  }),
  diplomatico: A({
    id: 'diplomatico', title: 'Diplomático alienígena', names: ['Embajador Zx\'grob', 'Legada Ulumí', 'Cónsul Prrt'],
    look: { skin: '#7ad88a', hair: '#3a9a5a', hat: 'alien', top: '#8a4ad8', pants: '#3a1a6a', boots: '#2a1040', alien: true, collar: '#ffd23f', eye: '#14101c' },
    clumsiness: 0.6, resistance: 0.9, cooperation: 0.4, speed: 0.85, bravery: 0.4, workRoom: null, helpLabel: 'Consultar al embajador', role: null, health: 100,
  }),
  paranoico: A({
    id: 'paranoico', title: 'Pasajero paranoico', names: ['Gervasio (paranoico)', 'Sra. Alarma', 'Teodoro Pánico'],
    look: { skin: '#e8c0a0', hair: '#8a7a6a', hat: 'beanie', hatC: '#c8a020', top: '#8a8a7a', pants: '#4a4a3a', boots: '#2a2a20', glasses: '#c8e8ff', glassesOn: 'eyes' },
    clumsiness: 0.8, resistance: 0.3, cooperation: 0.2, speed: 1.15, bravery: 0.05, workRoom: null, helpLabel: 'Tranquilizar al pasajero', role: null, health: 90,
  }),
  contrabandista: A({
    id: 'contrabandista', title: 'Contrabandista', names: ['"Dedos" Malone', 'La Rata Pérez', 'Señor Paquete'],
    look: { skin: '#b8865c', hair: '#14101c', hat: 'beanie', hatC: '#2a2a35', top: '#3a3040', pants: '#22202a', boots: '#14101c', glasses: '#14101c', glassesOn: 'eyes', belt: '#5a3a1e' },
    clumsiness: 0.4, resistance: 0.7, cooperation: 0.3, speed: 1.05, bravery: 0.5, workRoom: null, helpLabel: 'Interrogar al pasajero', role: null, health: 100,
  }),
};

export type Need = 'hunger' | 'bladder' | 'fatigue' | 'work' | 'social';

export interface ActivityDef {
  id: string;
  label: string;
  room: RoomId | '*';
  prop: PropKind | 'floor';
  dur: [number, number];
  satisfy: Partial<Record<Need, number>>;
  prof?: ProfessionId[];
  notProf?: ProfessionId[];
  dirt?: { type: ResidueId; p: number; amt: number }[];
  pose?: 'stand' | 'sleep' | 'work' | 'eat' | 'toilet';
  carry?: 'cafe';
  special?: 'toilet' | 'coffee' | 'cook' | 'sink' | 'experiment' | 'bin' | 'locker' | 'treat' | 'garden' | 'patrol' | 'smuggle' | 'maintain';
}

const ORGANIC: ProfessionId[] = ['robot'];

export const ACTIVITIES: ActivityDef[] = [
  { id: 'comer', label: 'comiendo', room: 'comedor', prop: 'table', dur: [7, 11], satisfy: { hunger: -75, social: -30 }, notProf: ORGANIC, dirt: [{ type: 'comida', p: 0.45, amt: 0.6 }, { type: 'cafe', p: 0.18, amt: 0.5 }], pose: 'eat' },
  { id: 'cafe', label: 'sirviéndose café', room: 'comedor', prop: 'coffee', dur: [2, 3], satisfy: { fatigue: -20 }, notProf: ORGANIC, carry: 'cafe', special: 'coffee' },
  { id: 'cocinar', label: 'cocinando', room: 'comedor', prop: 'counter', dur: [8, 12], satisfy: { work: -60 }, prof: ['cocinero'], dirt: [{ type: 'comida', p: 0.6, amt: 0.6 }, { type: 'aceite', p: 0.15, amt: 0.4 }], special: 'cook', pose: 'work' },
  { id: 'bano', label: 'en el baño', room: 'banos', prop: 'toilet', dur: [4, 7], satisfy: { bladder: -100 }, notProf: ORGANIC, special: 'toilet', pose: 'toilet' },
  { id: 'lavarse', label: 'lavándose', room: 'banos', prop: 'sink', dur: [2, 4], satisfy: { social: -5 }, notProf: ORGANIC, dirt: [{ type: 'agua', p: 0.45, amt: 0.5 }], special: 'sink' },
  { id: 'dormir', label: 'durmiendo', room: 'dormitorios', prop: 'bed', dur: [12, 18], satisfy: { fatigue: -100 }, notProf: ORGANIC, pose: 'sleep' },
  { id: 'taquilla', label: 'en su taquilla', room: 'dormitorios', prop: 'locker', dur: [2, 4], satisfy: { social: -10 }, notProf: ORGANIC, dirt: [{ type: 'basura', p: 0.2, amt: 0.5 }], special: 'locker' },
  { id: 'mando', label: 'pilotando', room: 'puente', prop: 'console', dur: [8, 14], satisfy: { work: -50 }, prof: ['capitan', 'ingeniero', 'cientifica', 'seguridad'], pose: 'work', dirt: [{ type: 'cafe', p: 0.12, amt: 0.4 }] },
  { id: 'holomesa', label: 'dando órdenes', room: 'puente', prop: 'holoTable', dur: [6, 10], satisfy: { work: -45, social: -20 }, prof: ['capitan', 'diplomatico'], pose: 'work', dirt: [{ type: 'cafe', p: 0.25, amt: 0.5 }] },
  { id: 'experimento', label: 'experimentando', room: 'laboratorio', prop: 'bench', dur: [8, 12], satisfy: { work: -60 }, prof: ['cientifica'], dirt: [{ type: 'quimico', p: 0.35, amt: 0.6 }], special: 'experiment', pose: 'work' },
  { id: 'observar', label: 'observando especímenes', room: 'laboratorio', prop: 'tank', dur: [4, 7], satisfy: { work: -20, social: -10 }, pose: 'stand' },
  { id: 'motor', label: 'reparando el motor', room: 'ingenieria', prop: 'pipes', dur: [8, 12], satisfy: { work: -60 }, prof: ['ingeniero'], dirt: [{ type: 'aceite', p: 0.5, amt: 0.6 }], pose: 'work' },
  { id: 'reactor', label: 'revisando el reactor', room: 'ingenieria', prop: 'reactorConsole', dur: [5, 8], satisfy: { work: -40 }, prof: ['ingeniero', 'capitan'], pose: 'work', dirt: [{ type: 'aceite', p: 0.2, amt: 0.4 }] },
  { id: 'herramientas', label: 'buscando herramientas', room: 'ingenieria', prop: 'toolrack', dur: [3, 5], satisfy: { work: -15 }, prof: ['ingeniero', 'robot'], dirt: [{ type: 'aceite', p: 0.3, amt: 0.4 }] },
  { id: 'diagnostico', label: 'revisando historiales', room: 'enfermeria', prop: 'medScanner', dur: [8, 12], satisfy: { work: -55 }, prof: ['medica'], pose: 'work' },
  { id: 'botiquin', label: 'ordenando medicinas', room: 'enfermeria', prop: 'medCabinet', dur: [3, 5], satisfy: { work: -20 }, prof: ['medica'], dirt: [{ type: 'basura', p: 0.15, amt: 0.4 }] },
  { id: 'jardin', label: 'cuidando las plantas', room: 'hidroponico', prop: 'plantBed', dur: [6, 10], satisfy: { social: -30, work: -25 }, dirt: [{ type: 'tierra', p: 0.4, amt: 0.6 }, { type: 'agua', p: 0.2, amt: 0.4 }], special: 'garden', pose: 'work' },
  { id: 'riego', label: 'revisando el riego', room: 'hidroponico', prop: 'hydroTank', dur: [3, 6], satisfy: { work: -20 }, prof: ['cientifica', 'ingeniero', 'robot', 'diplomatico'], dirt: [{ type: 'agua', p: 0.35, amt: 0.5 }] },
  { id: 'patrulla', label: 'patrullando', room: '*', prop: 'floor', dur: [3, 6], satisfy: { work: -30 }, prof: ['seguridad'], special: 'patrol' },
  { id: 'mantenimiento', label: 'haciendo mantenimiento', room: '*', prop: 'floor', dur: [4, 7], satisfy: { work: -40 }, prof: ['robot'], special: 'maintain' },
  { id: 'esconder', label: 'escondiendo algo', room: '*', prop: 'locker', dur: [3, 5], satisfy: { work: -40 }, prof: ['contrabandista'], special: 'smuggle' },
  { id: 'meditar', label: 'meditando con las plantas', room: 'hidroponico', prop: 'plantBed', dur: [6, 9], satisfy: { social: -40, work: -30 }, prof: ['diplomatico'], dirt: [{ type: 'mucosidad', p: 0.5, amt: 0.6 }] },
  { id: 'pasear', label: 'paseando', room: '*', prop: 'floor', dur: [2, 5], satisfy: { social: -12 }, dirt: [{ type: 'basura', p: 0.1, amt: 0.5 }] },
  { id: 'papelera', label: 'tirando basura', room: '*', prop: 'bin', dur: [1, 2], satisfy: { social: -2 }, notProf: ORGANIC, special: 'bin' },
];
