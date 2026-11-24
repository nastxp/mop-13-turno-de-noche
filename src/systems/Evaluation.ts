import { ABSURD_BONUSES, ABSURD_PENALTIES, GRADE_LINES } from '../data/lines';
import { RESIDUES } from '../data/residues';
import { ROOM_NAMES } from '../data/rooms';
import { ACHIEVEMENTS } from './HumorSystem';
import type { GameScene } from '../scenes/GameScene';
import { fmtTime } from '../core/util';

export type EndReason = 'time' | 'death' | 'destroyed' | 'quit';
export type Grade = 'EXCELENTE' | 'ACEPTABLE' | 'MEJORABLE' | 'DEFICIENTE' | 'DESPEDIDO';

export interface Report {
  reason: EndReason;
  mode: string;
  night: number;
  seed: string;
  grade: Grade;
  gradeLine: string;
  corporate: string;
  cleanPct: number;
  stats: { label: string; value: string; cls?: string }[];
  ledger: { label: string; amount: number }[];
  total: number;
  xp: number;
  badges: { name: string; desc: string }[];
  playerCaused: string[];
  survived: string;
  story: string[];
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Panel corporativo de fin de turno: datos reales del turno + ironía institucional. */
export function buildReport(w: GameScene, reason: EndReason): Report {
  const s = w.stats;
  const clean = Math.round(w.dirt.globalClean());
  const emergRatio = s.emergencies ? s.emergenciesResolved / s.emergencies : 1;
  const injured = s.crewInjured;
  const corpsesLeft = w.combat.corpses.length;
  let score = clean * 0.5 + Math.min(1, emergRatio) * 25 + w.ship.integrity * 0.15 + Math.min(10, s.crewRescued * 4) + s.tasksDone * 3 - s.playerCaused.length * 3 - injured * 5
    + s.bossesDefeated * 8 + Math.min(8, s.bodiesRecovered * 2) - corpsesLeft * 3 + Math.min(6, s.curedByPlayer * 2);
  if (reason === 'quit') score -= 10;
  let grade: Grade = score >= 80 ? 'EXCELENTE' : score >= 65 ? 'ACEPTABLE' : score >= 50 ? 'MEJORABLE' : score >= 35 ? 'DEFICIENTE' : 'DESPEDIDO';
  if (reason === 'death' || reason === 'destroyed') grade = 'DESPEDIDO';

  // ── libro de cuentas ──
  const ledger: { label: string; amount: number }[] = [];
  const minutes = w.t / 60;
  if (w.cfg.duration) ledger.push({ label: reason === 'time' ? 'Salario del turno' : 'Salario proporcional', amount: Math.round(reason === 'time' ? 100 : 100 * Math.min(1, w.t / w.cfg.duration)) });
  else ledger.push({ label: `Salario (${fmtTime(w.t)} de turno infinito)`, amount: Math.round(minutes * 14) });
  ledger.push({ label: `Bonificación por limpieza (${clean} %)`, amount: Math.round(clean * 0.6) });
  if (s.emergenciesResolved) ledger.push({ label: `Emergencias resueltas ×${s.emergenciesResolved}`, amount: s.emergenciesResolved * 6 });
  if (s.crewRescued) ledger.push({ label: `Tripulantes reanimados ×${s.crewRescued}`, amount: s.crewRescued * 10 });
  if (s.creaturesCaptured) ledger.push({ label: `Especímenes capturados ×${s.creaturesCaptured}`, amount: s.creaturesCaptured * 25 });
  if (s.creaturesRepelled) ledger.push({ label: `Criaturas ahuyentadas ×${s.creaturesRepelled}`, amount: s.creaturesRepelled * 10 });
  if (s.bodiesRecovered) ledger.push({ label: `Cuerpos entregados a la enfermería ×${s.bodiesRecovered}`, amount: s.bodiesRecovered * 12 });
  if (corpsesLeft) ledger.push({ label: `Cadáveres olvidados en la nave ×${corpsesLeft}`, amount: -6 * corpsesLeft });
  if (s.bossesDefeated) ledger.push({ label: `Amenazas de clase JEFE neutralizadas ×${s.bossesDefeated}`, amount: s.bossesDefeated * 40 });
  if (s.curedByPlayer) ledger.push({ label: `Tripulantes curados con desinfectante ×${s.curedByPlayer}`, amount: s.curedByPlayer * 6 });
  if (s.trapsCaught) ledger.push({ label: `Plagas atrapadas ×${s.trapsCaught}`, amount: s.trapsCaught * 4 });
  if (s.secretsFound) ledger.push({ label: `Hallazgos no catalogados ×${s.secretsFound}`, amount: s.secretsFound * 5 });
  if (s.droneCleaned) ledger.push({ label: `Trabajo del dron (comisión del conserje) ×${s.droneCleaned}`, amount: Math.round(s.droneCleaned * 0.5) });
  if (s.propsDestroyed) ledger.push({ label: `Mobiliario destruido por seguridad (se le descuenta a usted)`, amount: -2 * s.propsDestroyed });
  if (s.taskRewards) ledger.push({ label: `Tareas completadas ×${s.tasksDone}`, amount: s.taskRewards });
  if (s.inspectorAvg !== null) ledger.push({ label: `Informe del inspector (${Math.round(s.inspectorAvg)} %)`, amount: Math.round((s.inspectorAvg - 60) * 0.8) });
  if (s.artMarked && !s.artDestroyed) ledger.push({ label: 'Subvención cultural (obra de arte intacta)', amount: 10 });
  if (s.artDestroyed) ledger.push({ label: 'Destrucción de patrimonio artístico', amount: -15 });
  if (s.mopsBroken) ledger.push({ label: `Fregonas rotas ×${s.mopsBroken}`, amount: -15 * s.mopsBroken });
  if (s.vacuumsBroken) ledger.push({ label: `Aspiradoras averiadas ×${s.vacuumsBroken}`, amount: -20 * s.vacuumsBroken });
  if (s.foamOnCrew) ledger.push({ label: `Uso no autorizado de espuma sobre tripulantes ×${s.foamOnCrew}`, amount: -3 * s.foamOnCrew });
  if (s.playerCaused.length) ledger.push({ label: `Incidentes provocados por el personal ×${s.playerCaused.length}`, amount: -5 * s.playerCaused.length });
  const dmg = Math.round(100 - w.ship.integrity);
  if (dmg > 0) ledger.push({ label: `Daños estructurales (${dmg} %)`, amount: -Math.round(dmg * 0.5) });
  if (injured) ledger.push({ label: `Traslados a la enfermería ×${injured}`, amount: -8 * injured });
  const ab = pick(ABSURD_PENALTIES);
  ledger.push({ label: ab.text, amount: -ab.amount });
  if (Math.random() < 0.35) { const b = pick(ABSURD_BONUSES); ledger.push({ label: b.text, amount: b.amount }); }
  if (reason === 'death') ledger.push({ label: 'Gastos de sepelio (descontados del finado)', amount: -25 });
  const total = ledger.reduce((a, l) => a + l.amount, 0);

  // ── frase corporativa ──
  const parts: string[] = [];
  parts.push(`Ha salvado a ${s.crewRescued + w.crew.filter((c) => c.alive && c.prof !== 'inspector').length} tripulantes`);
  if (s.emergenciesResolved) parts.push(`resuelto ${s.emergenciesResolved} emergencias`);
  if (s.creaturesCaptured + s.creaturesRepelled) parts.push(`detenido ${s.creaturesCaptured + s.creaturesRepelled} invasiones`);
  if (w.stats.events.includes('Sobrecalentamiento del reactor') && !s.reactorBooms) parts.push('evitado la explosión del reactor');
  if (s.bossesDefeated) parts.push('neutralizado una amenaza de clase jefe');
  if (s.bodiesRecovered) parts.push(`retirado ${s.bodiesRecovered} ${s.bodiesRecovered === 1 ? 'cuerpo' : 'cuerpos'} con dignidad`);
  let sentence = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
  const worst = w.dirt.worst();
  let however: string;
  if (worst) {
    const coffee = w.map.props.find((p) => p.kind === 'coffee');
    const nearCoffee = coffee && Math.hypot(coffee.tx * 16 + 8 - worst.x, coffee.ty * 16 + 16 - worst.y) < 40;
    const where = nearCoffee ? 'detrás de la máquina de café' : `en ${ROOM_NAMES[worst.room ?? 'pasillo'].toLowerCase()}`;
    however = `Sin embargo, ha dejado una mancha de ${RESIDUES[worst.type].name} ${where}.`;
  } else however = 'Sin embargo, ha respirado demasiado oxígeno corporativo.';
  if (s.deaths && reason === 'time' && !worst) however = `Sin embargo, lamentamos la pérdida de ${s.deathNames.slice(0, 2).join(' y ')}${s.deaths > 2 ? ' y otros' : ''}. Se le descontará el papeleo.`;
  if (reason === 'death') however = 'Sin embargo, ha fallecido en horario laboral, lo cual está expresamente prohibido.';
  if (reason === 'destroyed') however = 'Sin embargo, la nave ha quedado destruida. Esto afecta negativamente a su evaluación.';
  if (reason === 'quit') however = 'Sin embargo, ha abandonado su puesto antes de tiempo.';
  const corporate = `${sentence}. ${however} Evaluación: ${grade}.`;

  // ── insignias ──
  if (!s.playerCaused.length && reason === 'time') s.achievements.push('manos_limpias');
  if (s.artMarked && !s.artDestroyed && reason === 'time') s.achievements.push('mecenas');
  const badges = [...new Set(s.achievements)].map((id) => ACHIEVEMENTS[id]).filter(Boolean);

  const stats = [
    { label: 'Limpieza final de la nave', value: `${clean} %`, cls: clean >= 80 ? 'good' : clean < 50 ? 'bad' : '' },
    { label: 'Residuos eliminados', value: `${s.residuesRemoved}` },
    { label: 'Emergencias resueltas', value: `${s.emergenciesResolved} / ${s.emergencies}` },
    { label: 'Tripulantes reanimados', value: `${s.crewRescued}` },
    { label: 'Tripulantes evacuados', value: `${s.crewInjured}`, cls: s.crewInjured ? 'bad' : '' },
    { label: 'Integridad del casco', value: `${Math.round(w.ship.integrity)} %`, cls: w.ship.integrity < 50 ? 'bad' : '' },
    { label: 'Criaturas capturadas / ahuyentadas', value: `${s.creaturesCaptured} / ${s.creaturesRepelled}` },
    { label: 'Focos de incendio apagados', value: `${s.fireCellsOut}` },
    { label: 'Resbalones (usted / tripulación)', value: `${s.playerSlips} / ${s.crewSlips}` },
    { label: 'Vómitos registrados', value: `${s.vomits}` },
    { label: 'Espuma utilizada', value: `${Math.round(s.foamUsed)} L` },
    { label: 'Residuos expulsados al espacio', value: `${s.expelled}` },
  ];
  if (s.deaths || s.bodiesRecovered) stats.push({ label: 'Bajas / cuerpos retirados', value: `${s.deaths} / ${s.bodiesRecovered}`, cls: s.deaths ? 'bad' : '' });
  if (s.shots) stats.push({ label: 'Disparos de seguridad / bichos abatidos', value: `${s.shots} / ${s.creaturesKilled}` });
  if (s.infections) stats.push({ label: 'Infecciones / curados (por usted)', value: `${s.infections} / ${s.cured} (${s.curedByPlayer})` });
  if (s.bossesDefeated) stats.push({ label: 'Jefes derrotados', value: `${s.bossesDefeated}`, cls: 'good' });
  if (s.secretsFound) stats.push({ label: 'Secretos encontrados', value: `${s.secretsFound}`, cls: 'good' });
  if (s.falseAlarms) stats.push({ label: 'Falsas alarmas comprobadas', value: `${s.falseAlarms}` });
  const xp = Math.max(10, Math.round(score * 2));
  const survived = w.cfg.duration ? (reason === 'time' ? 'Turno completado (06:00)' : `Turno interrumpido a los ${fmtTime(w.t)}`) : `Ha aguantado ${fmtTime(w.t)} en el turno infinito`;
  return {
    reason, mode: w.cfg.mode, night: w.cfg.night, seed: w.cfg.seed, grade, gradeLine: pick(GRADE_LINES[grade]), corporate, cleanPct: clean,
    stats, ledger, total, xp, badges, playerCaused: s.playerCaused.slice(0, 6), survived, story: s.story.slice(-6),
  };
}
