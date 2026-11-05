import { spawn } from 'node:child_process';
import type { GitLabTarget } from '../shared/types.js';
import { validUpload } from '../shared/images.js';
import { glabPath, ServiceError } from './glab.js';

export interface ImageDownload { body: Buffer; contentType: string }

export async function downloadImage(secret: string, filename: string, target: GitLabTarget): Promise<ImageDownload> {
  if (!validUpload(secret, filename)) throw new ServiceError(400, 'Ungültiger Bildanhang.');
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  delete env.GLAB_DEBUG_HTTP;
  delete env.GLAB_DEBUG;
  const output = await new Promise<Buffer>((resolve, reject) => {
    const endpoint = `projects/${encodeURIComponent(target.project)}/uploads/${secret}/${encodeURIComponent(filename)}`;
    const child = spawn(glabPath(), ['api', endpoint, '--hostname', new URL(target.gitlabUrl).host, '--method', 'GET', '--include'],
      { shell: false, windowsHide: true, env });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new ServiceError(504, 'Das Bild konnte nicht rechtzeitig geladen werden.'));
    }, 45_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 15_000_000) {
        clearTimeout(timer); child.kill();
        reject(new ServiceError(413, 'Das Bild ist zu groß. Bitte in GitLab öffnen.'));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new ServiceError(503, 'GitLab CLI ist nicht verfügbar.'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new ServiceError(502, 'Das Bild konnte nicht aus GitLab geladen werden.'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end();
  });
  // glab --include emits HTTP headers before the unmodified response body.
  const separator = /\r?\n\r?\n/.exec(output.subarray(0, 16_384).toString('latin1'));
  const header = output.subarray(0, separator?.index ?? 0).toString('ascii');
  const body = output.subarray((separator?.index ?? 0) + (separator?.[0].length ?? 0));
  // GitLab can return application/octet-stream for images. Detect bytes instead of trusting the filename.
  const hex = body.subarray(0, 12).toString('hex');
  const ascii = body.subarray(0, 12).toString('ascii');
  const contentType = hex.startsWith('89504e470d0a1a0a') ? 'image/png'
    : hex.startsWith('ffd8ff') ? 'image/jpeg'
      : /^GIF8[79]a/.test(ascii) ? 'image/gif'
        : ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP' ? 'image/webp'
          : ascii.slice(4, 8) === 'ftyp' && /avif|avis/.test(ascii.slice(8)) ? 'image/avif'
            : hex.startsWith('424d') ? 'image/bmp'
              : hex.startsWith('00000100') ? 'image/x-icon'
                : /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(body.subarray(0, 1024).toString('utf8'))
                  ? 'image/svg+xml' : undefined;
  if (!separator || !/^HTTP\/\S+ 200\b/.test(header) || !contentType)
    throw new ServiceError(415, 'Dieser Anhang kann nicht als Bild angezeigt werden.');
  return { body, contentType };
}
