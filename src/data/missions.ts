/** Misiones especiales, campaña y desafíos (Fase 3 y 4). */
export type MissionRule =
  | 'plaga' | 'banquete' | 'gravedad_cero' | 'epidemia' | 'inspector' | 'moho' | 'rebelion' | 'inundacion'
  | 'fiesta_total' | 'diplomaticos' | 'invasion' | 'sin_agua' | 'oscuridad' | 'expres' | 'solo_fregona' | 'zen' | 'caos';

export interface MissionDef {
  id: string;
  name: string;
  desc: string;
  memo: string;
  rules: MissionRule[];
  boss?: 'reina' | 'rey' | 'glorp';
  forced: string[];
  duration?: number;
  difficulty?: number;
}

export const MISSIONS: Record<string, MissionDef> = {
  invasion: {
    id: 'invasion', name: 'La noche de los Rasgadores', rules: ['invasion'], forced: ['invasion', 'invasion'],
    desc: 'Una manada de Rasgadores aborda la nave. Seguridad se encarga de la lucha; tú, de lo que quede.',
    memo: 'Seguridad informa de un abordaje alienígena. No es su problema: su problema empieza cuando terminen los disparos. Retire los cuerpos, friegue el ácido y no pise los cartuchos.',
  },
  inspeccion: {
    id: 'inspeccion', name: 'Inspección sorpresa', rules: ['epidemia', 'inspector'], forced: ['inspector', 'epidemia'],
    desc: 'Un inspector corporativo llega en plena epidemia de Gripe de nebulosa.',
    memo: 'Un inspector visitará la nave esta noche. Coincide con un brote de Gripe de nebulosa. Por favor, que los vómitos no aparezcan en el informe.',
  },
  plaga_bano: {
    id: 'plaga_bano', name: 'La plaga del Baño 7', rules: ['plaga'], boss: 'glorp', forced: ['inodoro', 'tuberia'],
    desc: 'Un Glorp gigante se reproduce por las tuberías y salta de inodoro en inodoro.',
    memo: 'Algo enorme y verde vive en las tuberías. Sella los inodoros con espuma para acorralarlo, congélalo y aspíralo. Y friega lo que deje.',
  },
  banquete: {
    id: 'banquete', name: 'El banquete del capitán', rules: ['banquete'], forced: ['fiesta', 'bandeja', 'bandeja'],
    desc: 'Cuarenta invitados cenan en el comedor y el robot camarero no ayuda.',
    memo: 'Esta noche el capitán celebra un banquete. El comedor debe mantenerse por encima del 70 % durante las tres inspecciones del maître.',
  },
  gravedad_cero: {
    id: 'gravedad_cero', name: 'Gravedad cero', rules: ['gravedad_cero'], forced: [],
    desc: 'El generador de gravedad está fuera de servicio todo el turno. La basura flota.',
    memo: 'El generador de gravedad está en revisión. Toda la noche. Recoja la suciedad flotante; sus botas magnéticas son orientativas.',
  },
  reina_moho: {
    id: 'reina_moho', name: 'La Reina del Moho', rules: ['moho'], boss: 'reina', forced: [],
    desc: 'Un organismo gigante ocupa el hidropónico y siembra colonias por la ventilación.',
    memo: 'El jardín hidropónico ha desarrollado una «personalidad». Limpia las colonias, purga la ventilación desde el puente y rocía su núcleo con desinfectante.',
  },
  ultima_descarga: {
    id: 'ultima_descarga', name: 'La última descarga', rules: ['inundacion'], forced: ['inodoro', 'tuberia', 'tuberia'],
    desc: 'El reciclaje de residuos falla y las aguas residuales amenazan con inundar la nave.',
    memo: 'El sistema de reciclaje ha fallado. Las tuberías revientan y los inodoros desbordan. Repara, desatasca y friega antes de que el pasillo sea un lago.',
  },
  rebelion: {
    id: 'rebelion', name: 'La rebelión de las aspiradoras', rules: ['rebelion'], boss: 'rey', forced: [],
    desc: 'Los robots de limpieza han desarrollado conciencia y un líder: el Rey Aspirador.',
    memo: 'Los robots de limpieza se han declarado en huelga indefinida y armada. Atrae al Rey Aspirador hacia líquidos: un cortocircuito le baja los humos. Luego desenchúfalo.',
  },
  fiesta: {
    id: 'fiesta', name: 'Fiesta intergaláctica', rules: ['fiesta_total', 'diplomaticos'], forced: ['fiesta', 'fiesta'],
    desc: 'Una celebración diplomática multiespecie. Lo que pueda salir mal, saldrá mal.',
    memo: 'Hoy se celebra la Fiesta de la Amistad Intergaláctica. Asisten tres especies con costumbres higiénicas incompatibles. Mantenga la moral por encima del 60 %.',
  },
};

/** Campaña del modo Historia */
export const STORY: { mission: string | null; memo?: string }[] = [
  { mission: null, memo: 'Bienvenido a su primer turno en la USC Desastre. Su misión: mantener la nave limpia hasta las 06:00. Las emergencias las atiende la tripulación; usted friega lo que dejen. Si algo arde, puede ayudar. Si algo se mueve y es verde, no lo moje.' },
  { mission: 'invasion' },
  { mission: 'inspeccion' },
  { mission: 'plaga_bano' },
  { mission: 'banquete' },
  { mission: 'gravedad_cero' },
  { mission: 'reina_moho' },
  { mission: 'ultima_descarga' },
  { mission: 'rebelion' },
  { mission: 'fiesta' },
];

export interface ChallengeDef { id: string; name: string; desc: string; rules: MissionRule[]; mission?: string; duration?: number }

export const CHALLENGES: ChallengeDef[] = [
  { id: 'sin_agua', name: 'Sin agua', desc: 'Fregona prohibida: solo aspiradora, desinfectante y criogenia.', rules: ['sin_agua'] },
  { id: 'oscuridad', name: 'A oscuras', desc: 'Energía al 30 % toda la noche. Tu linterna es tu mejor amiga.', rules: ['oscuridad'] },
  { id: 'expres', name: 'Turno exprés', desc: '4 minutos de caos concentrado.', rules: ['expres', 'caos'], duration: 240 },
  { id: 'solo_fregona', name: 'Solo fregona', desc: 'Nada de gadgets: una fregona y tu fuerza de voluntad.', rules: ['solo_fregona'] },
  ...Object.values(MISSIONS).map((m) => ({ id: `m_${m.id}`, name: m.name, desc: m.desc, rules: m.rules, mission: m.id })),
];
