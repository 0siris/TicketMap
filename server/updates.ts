import { readFileSync, statSync } from 'node:fs';
import type { ApplicationInfo, ApplicationUpdate } from '../shared/types.js';
import { ConfigurationError } from './config.js';

export interface Distribution { version: string; repository?: string }

function versionParts(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) return;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function loadDistribution(path = process.env.TICKETMAP_DISTRIBUTION_FILE): Distribution {
  try {
    const source = path ?? new URL('../package.json', import.meta.url);
    if (statSync(source).size > 16_384) throw new Error('Oversized distribution metadata');
    const value: unknown = JSON.parse(readFileSync(source, 'utf8'));
    if (!value || typeof value !== 'object') throw new Error('Invalid metadata');
    const data = value as { version?: unknown; repository?: unknown };
    if (!versionParts(data.version)) throw new Error('Invalid application version');
    if (path && (typeof data.repository !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(data.repository)))
      throw new Error('Invalid release repository');
    return { version: data.version as string, ...(path ? { repository: data.repository as string } : {}) };
  } catch {
    throw new ConfigurationError('Application distribution metadata is missing or invalid');
  }
}

export class ApplicationUpdates {
  readonly info: ApplicationInfo;
  private cached?: { expires: number; value: ApplicationUpdate };
  private pending?: Promise<ApplicationUpdate>;

  constructor(private readonly distribution: Distribution, private readonly fetchRelease: typeof fetch = fetch,
    private readonly now: () => number = Date.now) {
    this.info = { application: 'TicketMap', version: distribution.version };
  }

  async check(): Promise<ApplicationUpdate> {
    const unavailable: ApplicationUpdate = { currentVersion: this.info.version, available: false };
    if (!this.distribution.repository) return unavailable;
    if (this.cached && this.cached.expires > this.now()) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.loadRelease(unavailable).then(value => {
      this.cached = { expires: this.now() + 6 * 60 * 60 * 1000, value };
      return value;
    });
    try { return await this.pending; }
    finally { this.pending = undefined; }
  }

  private async loadRelease(unavailable: ApplicationUpdate): Promise<ApplicationUpdate> {
    try {
      const response = await this.fetchRelease(
        `https://api.github.com/repos/${this.distribution.repository}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TicketMap-update-check' },
          signal: AbortSignal.timeout(5000), credentials: 'omit', redirect: 'error',
        });
      if (!response.ok || !response.body) { await response.body?.cancel(); return unavailable; }
      const maximum = 1_048_576;
      if (Number(response.headers.get('content-length')) > maximum) {
        await response.body.cancel(); return unavailable;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maximum) { await reader.cancel(); return unavailable; }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object') return unavailable;
      const release = data as { draft?: unknown; prerelease?: unknown; tag_name?: unknown; html_url?: unknown };
      const latest = versionParts(release.tag_name);
      const current = versionParts(this.info.version);
      if (release.draft !== false || release.prerelease !== false || !latest || !current ||
        typeof release.html_url !== 'string') return unavailable;
      const difference = latest.map((part, index) => part - current[index]).find(value => value !== 0) ?? 0;
      if (difference <= 0) return unavailable;
      const download = new URL(release.html_url);
      if (download.origin !== 'https://github.com' || download.username || download.password || download.search ||
        download.hash || download.pathname !== `/${this.distribution.repository}/releases/tag/${release.tag_name}`)
        return unavailable;
      return { ...unavailable, available: true, latestVersion: latest.join('.'), downloadUrl: download.href };
    } catch { return unavailable; }
  }
}
