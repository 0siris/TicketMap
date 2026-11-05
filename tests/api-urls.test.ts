import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitLabTargetKey } from '../shared/types.js';
import { gitLabImage } from '../shared/images.js';
import { request, safeGitLabUrl } from '../src/api.js';
import { TEST_TARGET } from './fixtures.js';

afterEach(() => vi.unstubAllGlobals());

describe('configured GitLab links', () => {
  const target = { gitlabUrl: 'https://code.example.net:8443', project: 'group/subgroup/project' };
  const issueUrl = `${target.gitlabUrl}/${target.project}/-/work_items/42`;

  it('accepts the configured host and port without allowing credentials or a different origin', () => {
    expect(safeGitLabUrl(issueUrl, target.gitlabUrl)).toBe(issueUrl);
    for (const value of ['https://code.example.net/group/project',
      'https://other.example.net:8443/group/project', 'http://code.example.net:8443/group/project',
      'https://user:password@code.example.net:8443/group/project', 'javascript:alert(1)', 'not a URL'])
      expect(safeGitLabUrl(value, target.gitlabUrl)).toBeUndefined();
    expect(safeGitLabUrl('http://code.example.net/project', 'http://code.example.net')).toBeUndefined();
  });

  it('resolves subgroup uploads only for the configured host and project', () => {
    const secret = 'a'.repeat(32);
    const path = `uploads/${secret}/screen.png`;
    const attachment = gitLabImage(`/${path}`, target);
    expect(attachment).toEqual({ src: `/api/images/${secret}/screen.png`,
      href: `${target.gitlabUrl}/${target.project}/${path}` });
    expect(gitLabImage(`${target.gitlabUrl}/${target.project}/${path}`, target)).toEqual(attachment);
    expect(gitLabImage(`${target.gitlabUrl}/another/project/${path}`, target)).toBeUndefined();
    expect(gitLabImage(`https://another.example.net/${target.project}/${path}`, target)).toBeUndefined();
    expect(gitLabImage(`https://user:password@code.example.net:8443/${target.project}/${path}`, target)).toBeUndefined();
  });
});

describe('target-bound browser writes', () => {
  it('uses each request target instead of mutable global configuration', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}', { status: 200,
      headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const otherTarget = { gitlabUrl: 'https://other.example.net', project: 'group/project' };
    await request('/api/issues/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }, TEST_TARGET);
    await request('/api/issues', { method: 'POST', body: '{}' }, otherTarget);
    const first = fetch.mock.calls[0][1] as RequestInit;
    const second = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(first.headers).get('x-ticketmap-target')).toBe(gitLabTargetKey(TEST_TARGET));
    expect(new Headers(first.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(second.headers).get('x-ticketmap-target')).toBe(gitLabTargetKey(otherTarget));
  });

  it('rejects writes without a target before contacting the server', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(request('/api/issues', { method: 'POST', body: '{}' })).rejects.toThrow('GitLab-Ziel fehlt');
    expect(fetch).not.toHaveBeenCalled();
  });
});
