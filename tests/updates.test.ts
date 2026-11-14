import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationUpdates, loadDistribution } from '../server/updates.js';

const distribution = { version: '0.2.0', repository: 'example/ticket-map' };
const unavailable = { currentVersion: '0.2.0', available: false };
const release = (extra: Record<string, unknown> = {}) => ({ draft: false, prerelease: false,
  tag_name: 'v0.3.0', html_url: 'https://github.com/example/ticket-map/releases/tag/v0.3.0', ...extra });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('manual application update notification', () => {
  it('uses only the public release endpoint and explicit credential-free headers', async () => {
    vi.stubEnv('GITLAB_TOKEN', 'synthetic-private-token');
    vi.stubEnv('GITHUB_TOKEN', 'synthetic-other-token');
    const fetchRelease = vi.fn(async () => Response.json(release()));
    const updates = new ApplicationUpdates(distribution, fetchRelease);
    const result = await updates.check();
    expect(result).toEqual({ currentVersion: '0.2.0', available: true, latestVersion: '0.3.0',
      downloadUrl: release().html_url });
    const [url, init] = fetchRelease.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/example/ticket-map/releases/latest');
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'TicketMap-update-check' });
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init)).not.toContain('synthetic-private-token');
    expect(JSON.stringify(init)).not.toContain('synthetic-other-token');
  });
  it('does not contact GitHub for a source checkout without distribution settings', async () => {
    const fetchRelease = vi.fn();
    const updates = new ApplicationUpdates({ version: '0.2.0' }, fetchRelease);
    expect(await updates.check()).toEqual(unavailable);
    expect(fetchRelease).not.toHaveBeenCalled();
  });
  it.each(['v0.2.0', 'v0.1.9', 'v0.3.0-beta.1', 'v01.3.0', 'v9007199254740992.0.0', 'invalid'])
    ('does not announce an older, equal, prerelease, or invalid version: %s', async tag => {
      const fetchRelease = vi.fn(async () => Response.json(release({ tag_name: tag })));
      expect(await new ApplicationUpdates(distribution, fetchRelease).check()).toEqual(unavailable);
    });
  it.each([{ draft: true }, { prerelease: true }, { draft: undefined },
    { html_url: 'https://attacker.example/download.exe' },
    { html_url: 'https://github.com/another/project/releases/tag/v0.3.0' },
    { html_url: 'https://user:password@github.com/example/ticket-map/releases/tag/v0.3.0' },
    { html_url: 'https://github.com/example/ticket-map/releases/tag/v0.3.0?redirect=other' }])
    ('rejects unsupported release metadata or download targets', async extra => {
      const fetchRelease = vi.fn(async () => Response.json(release(extra)));
      expect(await new ApplicationUpdates(distribution, fetchRelease).check()).toEqual(unavailable);
    });
  it('shares pending checks and caches successful results for six hours', async () => {
    let finish!: (response: Response) => void;
    let now = 1000;
    const fetchRelease = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const updates = new ApplicationUpdates(distribution, fetchRelease, () => now);
    const first = updates.check(); const second = updates.check();
    finish(Response.json(release()));
    const values = await Promise.all([first, second]);
    expect(values[0]).toEqual(values[1]);
    expect(await updates.check()).toEqual(values[0]);
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    now += 6 * 60 * 60 * 1000;
    const next = updates.check(); finish(Response.json(release())); await next;
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });
  it('treats offline, rate-limited and malformed responses as unavailable without throwing', async () => {
    for (const fetchRelease of [vi.fn().mockRejectedValue(new Error('offline')),
      vi.fn(async () => new Response('limited', { status: 403 })),
      vi.fn(async () => new Response('not json')), vi.fn(async () => Response.json(null))])
      expect(await new ApplicationUpdates(distribution, fetchRelease).check()).toEqual(unavailable);
  });
  it('passes the timeout signal to the request and tolerates an aborted request', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetchRelease = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));
    const pending = new ApplicationUpdates(distribution, fetchRelease).check();
    controller.abort(new DOMException('Update request timed out', 'TimeoutError'));
    expect(await pending).toEqual(unavailable);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5000);
  });
  it('rejects declared and streamed responses larger than one megabyte', async () => {
    for (const fetchRelease of [vi.fn(async () => new Response('small', { headers: { 'content-length': '2000000' } })),
      vi.fn(async () => new Response('x'.repeat(1_048_577)))])
      expect(await new ApplicationUpdates(distribution, fetchRelease).check()).toEqual(unavailable);
  });
});

describe('distribution metadata', () => {
  it('loads only a validated application version and release repository', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ticket-map-distribution-'));
    const path = join(directory, 'distribution.json');
    try {
      writeFileSync(path, JSON.stringify(distribution));
      expect(loadDistribution(path)).toEqual(distribution);
      for (const value of [{ ...distribution, repository: '../project' },
        { ...distribution, repository: 'https://github.com/example/project' },
        { ...distribution, version: 'not a version' }, { version: '0.2.0' }]) {
        writeFileSync(path, JSON.stringify(value));
        expect(() => loadDistribution(path)).toThrow('metadata');
      }
      writeFileSync(path, 'x'.repeat(16_385));
      expect(() => loadDistribution(path)).toThrow('metadata');
    } finally { unlinkSync(path); rmdirSync(directory); }
  });
});
