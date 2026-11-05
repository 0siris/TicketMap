import type { DropPosition, ViewState } from '../shared/types.js';

export const POSITION_PREFIX = 'ticket-map:positions:v2:';
export function positionKey(project: string, state: ViewState, gitlabUrl: string): string {
  const view = state.view === 'themes' ? ['themes', state.theme] : [state.view];
  return `${POSITION_PREFIX}${JSON.stringify([new URL(gitlabUrl).origin, project, ...view])}`;
}

function legacyPositionKey(key: string): string | undefined {
  if (!key.startsWith(POSITION_PREFIX)) return undefined;
  const [origin, ...view] = JSON.parse(key.slice(POSITION_PREFIX.length));
  // The original layout format belonged only to the public GitLab instance.
  return origin === 'https://gitlab.com' ? `ticket-map:positions:v1:${JSON.stringify(view)}` : undefined;
}

type PositionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export class GraphPositions {
  private readonly views = new Map<string, Map<string, DropPosition>>();
  constructor(private readonly report: (message: string) => void,
    private readonly storage: () => PositionStorage = () => window.localStorage) {}

  read(key: string): Map<string, DropPosition> {
    const cached = this.views.get(key);
    if (cached) return cached;
    const positions = new Map<string, DropPosition>();
    this.views.set(key, positions);
    let raw: string | null;
    try {
      raw = this.storage().getItem(key);
      if (raw === null) {
        const legacy = legacyPositionKey(key);
        if (legacy) raw = this.storage().getItem(legacy);
      }
    }
    catch { this.unavailable(); return positions; }
    if (raw === null) return positions;
    try {
      const data: unknown = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('Invalid positions');
      for (const entry of data) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' ||
          !entry[0] || !entry[1] || typeof entry[1] !== 'object' ||
          !Number.isFinite(entry[1].x) || !Number.isFinite(entry[1].y)) throw new Error('Invalid position');
        positions.set(entry[0], { x: entry[1].x, y: entry[1].y });
      }
    } catch {
      positions.clear();
      this.report('Gespeicherte Kartenpositionen konnten nicht gelesen werden. Die Ansicht wird neu angeordnet.');
    }
    return positions;
  }

  save(key: string): void {
    try { this.storage().setItem(key, JSON.stringify([...this.read(key)])); }
    catch { this.unavailable(); }
  }

  private unavailable() {
    this.report('Kartenpositionen können in diesem Browser nicht gespeichert werden. Sie bleiben nur bis zum Neuladen erhalten.');
  }
}
