export type RoomId = 'puente' | 'comedor' | 'banos' | 'laboratorio' | 'ingenieria' | 'dormitorios' | 'enfermeria' | 'hidroponico' | 'pasillo';
export type Facing = 'down' | 'up' | 'left' | 'right';
export type GameMode = 'historia' | 'infinito' | 'zen' | 'caos' | 'desafio' | 'attract';
export type ToolId = 'fregona' | 'espuma' | 'aspiradora' | 'desinfectante' | 'crio' | 'trampa' | 'robot' | 'superfregona';
export type EmoteId =
  | 'alert' | 'question' | 'anger' | 'sweat' | 'disgust' | 'heart'
  | 'zzz' | 'note' | 'fear' | 'dizzy' | 'sparkle' | 'dots';

export interface Vec { x: number; y: number }

export interface ShiftConfig {
  mode: GameMode;
  night: number;
  seed: string;
  difficulty: number;
  /** null = sin límite (turno infinito) */
  duration: number | null;
  /** variante de juego: historia, zen, caos, desafío… */
  variant?: 'normal' | 'zen' | 'caos' | 'desafio';
  /** misión especial activa */
  mission?: string;
  /** reglas extra de los desafíos */
  rules?: string[];
  /** desafío elegido (id, nombre y descripción para el briefing) */
  challenge?: string;
  challengeName?: string;
  challengeDesc?: string;
  /** multijugador: anfitrión (simula) o invitado (refleja la nave del anfitrión) */
  netRole?: 'host' | 'client';
  /** invitado: memorándum del anfitrión */
  netBrief?: { title: string; memo: string; tasks: string[] };
}
