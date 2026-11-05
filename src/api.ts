import { gitLabTargetKey, type ApiError, type GitLabTarget } from '../shared/types.js';

export class RequestError extends Error {
  constructor(public status: number, public body: ApiError) { super(body.message); }
}

export async function request<T>(path: string, init?: RequestInit, target?: GitLabTarget): Promise<T> {
  if (init && !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) {
    if (!target) throw new RequestError(0, { message: 'Das GitLab-Ziel fehlt. Bitte die Seite neu laden.' });
    const headers = new Headers(init.headers);
    headers.set('x-ticketmap-target', gitLabTargetKey(target));
    init = { ...init, headers };
  }
  let response: Response;
  try { response = await fetch(path, init); }
  catch { throw new RequestError(0, { message: 'Keine Verbindung zur lokalen App. Server prüfen und erneut versuchen.' }); }
  const body = await response.json().catch(() => ({ message: 'Der Server hat keine gültige Antwort geliefert.' }));
  if (!response.ok) throw new RequestError(response.status, body);
  return body as T;
}

export function safeGitLabUrl(value: string, gitlabUrl: string): string | undefined {
  try {
    const url = new URL(value);
    const target = new URL(gitlabUrl);
    return target.protocol === 'https:' && !target.username && !target.password &&
      url.origin === target.origin && !url.username && !url.password ? url.href : undefined;
  }
  catch { return undefined; }
}

export function safeMarkdownUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function newOperationId(): string {
  // getRandomValues also works on the HTTP LAN origin, where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
