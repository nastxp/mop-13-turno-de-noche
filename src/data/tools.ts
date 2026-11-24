import type { ToolId } from '../types';

export interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  desc: string;
  capacityLabel: string;
  capacity: number;
  durability: number;
  pros: string;
  cons: string;
  /** se recarga en la Estación del conserje */
  refill: boolean;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  fregona: {
    id: 'fregona', name: 'Fregona básica', key: '1',
    desc: 'Limpia casi todo. Se satura poco a poco y se escurre sola; acláralo del todo en la Estación.',
    capacityLabel: 'Saturación', capacity: 100, durability: 100, refill: true,
    pros: 'Universal y rápida. Ahuyenta criaturas a golpes.', cons: 'Deja el suelo mojado y resbaladizo. El agua junto a un panel provoca cortocircuitos.',
  },
  espuma: {
    id: 'espuma', name: 'Pistola de espuma selladora', key: '2',
    desc: 'Apaga incendios, sella fugas e inmoviliza alienígenas.',
    capacityLabel: 'Espuma', capacity: 100, durability: 100, refill: true,
    pros: 'Resuelve emergencias a distancia.', cons: 'Deja espuma resbaladiza que habrá que fregar.',
  },
  aspiradora: {
    id: 'aspiradora', name: 'Aspiradora espacial', key: '3',
    desc: 'Aspira sólidos muy rápido y captura criaturas aturdidas, ratas e insectos.',
    capacityLabel: 'Depósito', capacity: 100, durability: 100, refill: false,
    pros: 'Rapidísima con polvo, basura, hollín y escombros.', cons: 'Los líquidos la averían. Los huevos pueden eclosionar dentro del depósito.',
  },
  desinfectante: {
    id: 'desinfectante', name: 'Desinfectante industrial', key: '4',
    desc: 'Nube que elimina moho, esporas, mucosidad y vómito, y cura infecciones recientes.',
    capacityLabel: 'Carga', capacity: 100, durability: 100, refill: true,
    pros: 'Detiene epidemias y plagas de moho.', cons: 'Si abusas de él, el moho desarrolla resistencia.',
  },
  crio: {
    id: 'crio', name: 'Pulverizador criogénico', key: '5',
    desc: 'Congela charcos, apaga fuegos, detiene fugas y congela criaturas para capturarlas.',
    capacityLabel: 'Frío', capacity: 100, durability: 100, refill: true,
    pros: 'Detiene casi cualquier cosa en seco.', cons: 'El hielo es extremadamente resbaladizo. Para todos.',
  },
  trampa: {
    id: 'trampa', name: 'Trampas para plagas', key: '6',
    desc: 'Haz clic para colocar una trampa: atrapa ratas, insectos y criaturas pequeñas.',
    capacityLabel: 'Trampas', capacity: 3, durability: 100, refill: false,
    pros: 'Trabajan solas.', cons: 'La tripulación también tropieza con ellas.',
  },
  robot: {
    id: 'robot', name: 'Dron de limpieza', key: '7',
    desc: 'Haz clic para desplegar un dron que aspira sólidos solo. [E] junto a él para recogerlo.',
    capacityLabel: 'Drones', capacity: 1, durability: 100, refill: false,
    pros: 'Limpia mientras tú haces otra cosa.', cons: 'Si aspira aceite o combustible echa chispas… y a veces algo más.',
  },
  superfregona: {
    id: 'superfregona', name: 'Superfregona experimental', key: '8',
    desc: 'El legado de MOP-1. Limpia en un radio enorme y nunca se satura.',
    capacityLabel: 'Energía', capacity: 100, durability: 100, refill: false,
    pros: 'Absurdamente eficaz.', cons: 'Se agota durante el turno. Nadie sabe de dónde salió.',
  },
};

export const TOOL_ORDER: ToolId[] = ['fregona', 'espuma', 'aspiradora', 'desinfectante', 'crio', 'trampa', 'robot', 'superfregona'];
