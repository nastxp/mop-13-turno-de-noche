type Handler = (...args: any[]) => void;

/** Bus de eventos sencillo para desacoplar sistemas. */
export class EventBus {
  private m = new Map<string, Set<Handler>>();
  on(e: string, h: Handler): () => void {
    let s = this.m.get(e);
    if (!s) this.m.set(e, (s = new Set()));
    s.add(h);
    return () => s!.delete(h);
  }
  emit(e: string, ...args: any[]): void {
    const s = this.m.get(e);
    if (!s) return;
    for (const h of [...s]) {
      try {
        h(...args);
      } catch (err) {
        console.error('[bus]', e, err);
      }
    }
  }
  clear(): void {
    this.m.clear();
  }
}

/** Bus de la partida en curso (se limpia al reiniciar el turno). */
export const bus = new EventBus();
