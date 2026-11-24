export type ResidueId =
  | 'polvo' | 'cafe' | 'vomito' | 'baba' | 'aceite' | 'huellas' | 'hollin'
  | 'espuma' | 'agua' | 'comida' | 'basura' | 'aguas' | 'confeti' | 'quimico'
  | 'tierra' | 'moho' | 'esporas' | 'mucosidad' | 'hielo' | 'huevos' | 'acido'
  | 'sangre' | 'restos' | 'escombros' | 'cables' | 'combustible' | 'eterna';

export type ResidueStyle = 'splat' | 'speckle' | 'chunks' | 'prints' | 'foam' | 'smudge' | 'confetti' | 'trash' | 'fuzz' | 'eggs' | 'ice' | 'debris' | 'wires' | 'swirl';

export interface ResidueDef {
  id: ResidueId;
  name: string;
  /** base, sombra, brillo */
  colors: [string, string, string];
  style: ResidueStyle;
  weight: number;
  effort: number;
  mopSat: number;
  liquid: boolean;
  solid: boolean;
  slippery: number;
  slow: number;
  flammable: boolean;
  conductive: boolean;
  disgust: number;
  food: number;
  glow?: number;
  tracks?: boolean;
  /** aporte a la contaminación biológica de la sala */
  bio?: number;
  /** corroe el casco mientras no se limpie */
  corrosive?: boolean;
  /** se extiende o crece por sí solo */
  grows?: boolean;
  /** eclosiona si no se retira */
  hatch?: boolean;
  /** se derrite y vuelve a ser agua */
  melts?: boolean;
  /** no se puede eliminar del todo */
  eternal?: boolean;
}

const R = (d: ResidueDef) => d;
const base = { slippery: 0, slow: 0, flammable: false, conductive: false, disgust: 0, food: 0 };

export const RESIDUES: Record<ResidueId, ResidueDef> = {
  polvo: R({ ...base, id: 'polvo', name: 'polvo espacial', colors: ['#8a8fa3', '#5d6175', '#b9bdcc'], style: 'speckle', weight: 0.4, effort: 0.5, mopSat: 0.25, liquid: false, solid: true }),
  cafe: R({ ...base, id: 'cafe', name: 'café derramado', colors: ['#6b3f1f', '#4a2a12', '#c8904f'], style: 'splat', weight: 1, effort: 0.8, mopSat: 0.8, liquid: true, solid: false, slippery: 0.7, conductive: true, food: 0.2, tracks: true }),
  vomito: R({ ...base, id: 'vomito', name: 'vómito', colors: ['#b8c43a', '#7d8a1e', '#eaf28a'], style: 'chunks', weight: 2.2, effort: 1.3, mopSat: 1.4, liquid: true, solid: false, slippery: 0.4, slow: 0.1, disgust: 1, food: 0.8, tracks: true, bio: 1.2 }),
  baba: R({ ...base, id: 'baba', name: 'baba alienígena', colors: ['#3ee8a0', '#16a874', '#c8fff0'], style: 'splat', weight: 1.4, effort: 1.8, mopSat: 1.2, liquid: true, solid: false, slippery: 0.1, slow: 0.55, disgust: 0.4, glow: 0x3ee8a0, tracks: true, bio: 0.6 }),
  aceite: R({ ...base, id: 'aceite', name: 'aceite mecánico', colors: ['#1d1830', '#0e0b18', '#7a5fd0'], style: 'splat', weight: 1.2, effort: 2.2, mopSat: 2, liquid: true, solid: false, slippery: 0.9, flammable: true, tracks: true }),
  huellas: R({ ...base, id: 'huellas', name: 'huellas', colors: ['#4a3a30', '#2e241e', '#6d5848'], style: 'prints', weight: 0.3, effort: 0.4, mopSat: 0.2, liquid: true, solid: false }),
  hollin: R({ ...base, id: 'hollin', name: 'hollín', colors: ['#25222b', '#121016', '#4a4654'], style: 'smudge', weight: 1, effort: 1, mopSat: 1, liquid: false, solid: true, disgust: 0.1 }),
  espuma: R({ ...base, id: 'espuma', name: 'espuma ignífuga', colors: ['#eef6ff', '#a9c2dc', '#ffffff'], style: 'foam', weight: 0.6, effort: 0.5, mopSat: 0.5, liquid: true, solid: false, slippery: 0.5, slow: 0.15 }),
  agua: R({ ...base, id: 'agua', name: 'charco de agua', colors: ['#4aa3e8', '#2a6fb0', '#d8f2ff'], style: 'splat', weight: 0.3, effort: 0.3, mopSat: 0.2, liquid: true, solid: false, slippery: 0.6, conductive: true }),
  comida: R({ ...base, id: 'comida', name: 'restos de comida', colors: ['#d98b3a', '#a35a1f', '#f8de8a'], style: 'chunks', weight: 0.8, effort: 0.7, mopSat: 0.7, liquid: false, solid: true, slippery: 0.2, disgust: 0.2, food: 1, bio: 0.3 }),
  basura: R({ ...base, id: 'basura', name: 'basura', colors: ['#d8d6e0', '#8f8c9c', '#ff5d6c'], style: 'trash', weight: 0.9, effort: 1.6, mopSat: 0.6, liquid: false, solid: true, flammable: true, disgust: 0.2, food: 0.4 }),
  aguas: R({ ...base, id: 'aguas', name: 'aguas residuales', colors: ['#6d6a2a', '#45421a', '#a8a85a'], style: 'splat', weight: 2.5, effort: 1.5, mopSat: 1.6, liquid: true, solid: false, slippery: 0.5, slow: 0.15, conductive: true, disgust: 1.2, food: 0.5, tracks: true, bio: 1.5 }),
  confeti: R({ ...base, id: 'confeti', name: 'confeti', colors: ['#ff5d9e', '#4ff0ff', '#ffd23f'], style: 'confetti', weight: 0.5, effort: 0.6, mopSat: 0.3, liquid: false, solid: true, slippery: 0.1, flammable: true }),
  quimico: R({ ...base, id: 'quimico', name: 'compuesto químico', colors: ['#b067ff', '#7a35c8', '#ecd8ff'], style: 'splat', weight: 1.5, effort: 1.5, mopSat: 1.3, liquid: true, solid: false, slippery: 0.3, slow: 0.1, flammable: true, conductive: true, disgust: 0.5, glow: 0xb067ff, bio: 0.4 }),
  tierra: R({ ...base, id: 'tierra', name: 'tierra de cultivo', colors: ['#5a3a20', '#3a2412', '#86603a'], style: 'speckle', weight: 0.6, effort: 0.6, mopSat: 0.5, liquid: false, solid: true }),
  moho: R({ ...base, id: 'moho', name: 'moho espacial', colors: ['#6a8a4a', '#3e5a2a', '#b8d890'], style: 'fuzz', weight: 2, effort: 1.6, mopSat: 1.2, liquid: false, solid: true, slow: 0.1, disgust: 0.7, bio: 1.6, grows: true }),
  esporas: R({ ...base, id: 'esporas', name: 'esporas', colors: ['#e8d84a', '#a89a20', '#fffaa8'], style: 'speckle', weight: 1.2, effort: 0.8, mopSat: 0.6, liquid: false, solid: true, disgust: 0.4, glow: 0xe8d84a, bio: 2, grows: true }),
  mucosidad: R({ ...base, id: 'mucosidad', name: 'mucosidad infecciosa', colors: ['#a8e85a', '#6aa82a', '#eaffb8'], style: 'splat', weight: 1.8, effort: 1.2, mopSat: 1.2, liquid: true, solid: false, slippery: 0.45, disgust: 0.9, glow: 0xa8e85a, tracks: true, bio: 2.2 }),
  hielo: R({ ...base, id: 'hielo', name: 'placa de hielo', colors: ['#bfe8ff', '#7ab8e0', '#ffffff'], style: 'ice', weight: 0.4, effort: 0.6, mopSat: 0.2, liquid: false, solid: true, slippery: 1, melts: true }),
  huevos: R({ ...base, id: 'huevos', name: 'huevos alienígenas', colors: ['#c8a0e8', '#7a50a8', '#f4e4ff'], style: 'eggs', weight: 2, effort: 1.4, mopSat: 0.8, liquid: false, solid: true, disgust: 0.8, glow: 0xc080ff, hatch: true, bio: 0.8 }),
  acido: R({ ...base, id: 'acido', name: 'sangre ácida alienígena', colors: ['#c8f03a', '#7aa81a', '#f4ffb0'], style: 'splat', weight: 2.4, effort: 1.6, mopSat: 1.5, liquid: true, solid: false, slippery: 0.3, disgust: 0.9, glow: 0xc8f03a, tracks: true, bio: 1, corrosive: true }),
  sangre: R({ ...base, id: 'sangre', name: 'sangre', colors: ['#a01a2a', '#600a16', '#e04a56'], style: 'splat', weight: 2, effort: 1.3, mopSat: 1.3, liquid: true, solid: false, slippery: 0.35, disgust: 1, tracks: true, bio: 0.8 }),
  restos: R({ ...base, id: 'restos', name: 'restos alienígenas', colors: ['#6a3a8a', '#3a1a52', '#b07ad0'], style: 'chunks', weight: 2.2, effort: 1.2, mopSat: 1, liquid: false, solid: true, disgust: 1.1, food: 1, bio: 1 }),
  escombros: R({ ...base, id: 'escombros', name: 'escombros', colors: ['#7a86ad', '#3a4260', '#c4ccdf'], style: 'debris', weight: 1.1, effort: 1.4, mopSat: 0.5, liquid: false, solid: true }),
  cables: R({ ...base, id: 'cables', name: 'cables mordisqueados', colors: ['#e8a020', '#a85a10', '#ff5d5a'], style: 'wires', weight: 1, effort: 1, mopSat: 0.4, liquid: false, solid: true, conductive: true }),
  combustible: R({ ...base, id: 'combustible', name: 'combustible', colors: ['#e8c83a', '#a88a10', '#fff4a0'], style: 'splat', weight: 1.4, effort: 1.6, mopSat: 1.6, liquid: true, solid: false, slippery: 0.6, flammable: true, glow: 0xe8c83a, tracks: true }),
  eterna: R({ ...base, id: 'eterna', name: 'la Mancha Eterna', colors: ['#3a1a5a', '#1a0a2a', '#8a4ac8'], style: 'swirl', weight: 1.5, effort: 1.2, mopSat: 0.8, liquid: true, solid: false, disgust: 0.2, glow: 0x7a3ac8, eternal: true }),
};

export const RESIDUE_IDS = Object.keys(RESIDUES) as ResidueId[];
