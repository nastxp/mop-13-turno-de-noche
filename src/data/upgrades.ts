export type UpgradeId =
  | 'fregona_absorbente' | 'botas_adherencia' | 'espuma_xl' | 'pulmones' | 'patines' | 'aspiradora_blindada'
  | 'desinfectante_plus' | 'trampas_extra' | 'dron' | 'reparador' | 'traje_ignifugo' | 'sensores';

export interface UpgradeDef {
  id: UpgradeId;
  branch: 'Limpieza' | 'Movilidad' | 'Supervivencia' | 'Tecnología' | 'Mantenimiento';
  name: string;
  desc: string;
  costs: number[];
  minLevel?: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'fregona_absorbente', branch: 'Limpieza', name: 'Fregona absorbente', desc: '+40 % de capacidad y +25 % de velocidad de fregado por nivel.', costs: [60, 140] },
  { id: 'desinfectante_plus', branch: 'Limpieza', name: 'Desinfectante concentrado', desc: 'Nube más amplia y +50 % de carga.', costs: [90], minLevel: 2 },
  { id: 'aspiradora_blindada', branch: 'Tecnología', name: 'Aspiradora blindada', desc: 'Aspira líquidos sin averiarse y su depósito es un 50 % mayor.', costs: [110] },
  { id: 'trampas_extra', branch: 'Tecnología', name: 'Trampas extra', desc: '+2 trampas para plagas por turno.', costs: [60] },
  { id: 'dron', branch: 'Tecnología', name: 'Dron de limpieza', desc: 'Desbloquea un dron que aspira sólidos por su cuenta.', costs: [150], minLevel: 3 },
  { id: 'sensores', branch: 'Tecnología', name: 'Sensores de contaminación', desc: 'El minimapa muestra la contaminación de cada sala y las criaturas escondidas.', costs: [80] },
  { id: 'espuma_xl', branch: 'Supervivencia', name: 'Bombona de espuma XL', desc: '+50 % de espuma y sellado más rápido por nivel.', costs: [70, 150] },
  { id: 'pulmones', branch: 'Supervivencia', name: 'Filtro respiratorio', desc: '−40 % de consumo de oxígeno y +20 de salud máxima.', costs: [90] },
  { id: 'traje_ignifugo', branch: 'Supervivencia', name: 'Traje ignífugo', desc: 'El fuego y el ácido te dañan un 60 % menos.', costs: [100], minLevel: 2 },
  { id: 'botas_adherencia', branch: 'Movilidad', name: 'Botas de adherencia', desc: 'Reduce un 60 % los resbalones y mejora el control sin gravedad.', costs: [80] },
  { id: 'patines', branch: 'Movilidad', name: 'Patines industriales', desc: '+12 % de velocidad y menos gasto de resistencia por nivel.', costs: [70, 160] },
  { id: 'reparador', branch: 'Mantenimiento', name: 'Kit de reparación rápida', desc: 'Reparas, desatascas y sellas un 40 % más rápido.', costs: [90] },
];

export type SpecId = 'sanitario' | 'emergencias' | 'plagas' | 'antigravedad';

export const SPECIALIZATIONS: Record<SpecId, { name: string; desc: string }> = {
  sanitario: { name: 'Conserje sanitario', desc: 'Desinfectante doble, curas al instante y la tripulación enferma menos a tu alrededor.' },
  emergencias: { name: 'Técnico de emergencias', desc: 'Reparas un 50 % más rápido, +50 % de espuma y el fuego te daña la mitad.' },
  plagas: { name: 'Cazador de plagas', desc: '+3 trampas, capturas mejor pagadas y tus golpes de fregona aturden más.' },
  antigravedad: { name: 'Especialista antigravedad', desc: 'Control total sin gravedad, inmune a resbalones en hielo y espuma, +10 % de velocidad.' },
};

/** Herramientas que se desbloquean al subir de nivel (además de las de la tienda). */
export const TOOL_UNLOCK_LEVEL: Record<string, number> = { desinfectante: 2, crio: 3, trampa: 2 };
