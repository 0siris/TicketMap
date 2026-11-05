import type { GitLabTarget } from './types.js';

export function validUpload(secret: string, filename: string): boolean {
  return /^[a-f0-9]{32}$/i.test(secret) && filename.length > 0 && filename.length <= 255
    && !/[\\/%\x00-\x1f\x7f]/.test(filename) && filename !== '.' && filename !== '..';
}

export function gitLabImage(value: string | undefined, target: GitLabTarget): { src: string; href: string } | undefined {
  if (!value) return undefined;
  try {
    const origin = new URL(target.gitlabUrl);
    if (origin.protocol !== 'https:' || origin.username || origin.password) return undefined;
    const relative = value.match(/^\/?uploads\/([^?#]+)$/);
    const base = `${origin.origin}/${target.project}/`;
    const url = new URL(relative ? `${base}uploads/${relative[1]}` : value, base);
    if (url.origin !== origin.origin || url.username || url.password || url.search) return undefined;
    const prefix = `/${target.project}/uploads/`;
    if (!url.pathname.startsWith(prefix)) return undefined;
    const parts = url.pathname.slice(prefix.length).split('/');
    if (parts.length !== 2) return undefined;
    const [secret, filename] = parts.map(decodeURIComponent);
    if (!validUpload(secret, filename)) return undefined;
    return { src: `/api/images/${secret}/${encodeURIComponent(filename)}`, href: url.href };
  } catch { return undefined; }
}
