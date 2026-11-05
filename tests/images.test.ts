import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitLabImage, validUpload } from '../shared/images.js';
import { downloadImage } from '../server/images.js';
import { TEST_TARGET } from './fixtures.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const secret = 'a'.repeat(32);
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
function childProcess(body: Buffer, { code = 0, pending = false, headers = 'HTTP/2.0 200 OK\nContent-Type: application/octet-stream\n\r\n' } = {}) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), kill: vi.fn() });
  child.stdin.on('finish', () => {
    if (pending) return;
    child.stdout.end(Buffer.concat([Buffer.from(headers), body]));
    queueMicrotask(() => child.emit('close', code));
  });
  vi.mocked(spawn).mockReturnValue(child as any);
  return child;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('fixed-project image addresses', () => {
  it('resolves GitLab Markdown uploads and fixed-project absolute paths', () => {
    for (const prefix of ['/uploads/', 'uploads/', '/example/team-project/uploads/',
      'https://gitlab.example.com/example/team-project/uploads/']) {
      expect(gitLabImage(`${prefix}${secret}/screen%20one.png`, TEST_TARGET)).toEqual({
        src: `/api/images/${secret}/screen%20one.png`,
        href: `https://gitlab.example.com/example/team-project/uploads/${secret}/screen%20one.png`,
      });
    }
  });
  it('rejects foreign hosts/projects, credentials, traversal and encoded separators', () => {
    for (const src of [`https://evil.example/uploads/${secret}/a.png`,
      `https://gitlab.example.com/other/project/uploads/${secret}/a.png`,
      `https://user:password@gitlab.example.com/example/team-project/uploads/${secret}/a.png`,
      `/uploads/${secret}/a%2Fb.png`, `/uploads/${secret}/a%5Cb.png`, `/uploads/${secret}/a%252fb.png`,
      `/uploads/${secret}/..`, `/uploads/${secret}/a.png?url=https://evil.example`,
      '/uploads/invalid/a.png', 'javascript:alert(1)', 'data:image/png;base64,abcd'])
      expect(gitLabImage(src, TEST_TARGET)).toBeUndefined();
    expect(validUpload(secret, '..')).toBe(false);
  });
});

describe('authenticated image download', () => {
  it('uses an injected self-hosted origin and subgroup project for downloads and preview addresses', async () => {
    const target = { gitlabUrl: 'https://selfhosted.example.com:8443', project: 'group/subgroup/project' };
    childProcess(png);
    await downloadImage(secret, 'custom.png', target);
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toEqual(['api', `projects/group%2Fsubgroup%2Fproject/uploads/${secret}/custom.png`,
      '--hostname', 'selfhosted.example.com:8443', '--method', 'GET', '--include']);
    expect(gitLabImage(`/uploads/${secret}/custom.png`, target)?.href)
      .toBe(`${target.gitlabUrl}/${target.project}/uploads/${secret}/custom.png`);
  });
  it('keeps binary bytes intact and uses only the fixed project with shell-free CLI credentials', async () => {
    vi.stubEnv('GLAB_DEBUG_HTTP', '1'); vi.stubEnv('GLAB_DEBUG', '1');
    childProcess(png);
    const image = await downloadImage(secret, 'screen one.png', TEST_TARGET);
    expect(image).toEqual({ body: png, contentType: 'image/png' });
    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual(['api', `projects/example%2Fteam-project/uploads/${secret}/screen%20one.png`,
      '--hostname', 'gitlab.example.com', '--method', 'GET', '--include']);
    expect(call[2]).toMatchObject({ shell: false, windowsHide: true });
    const env = call[2]!.env!;
    expect(env.GLAB_DEBUG_HTTP).toBeUndefined(); expect(env.GLAB_DEBUG).toBeUndefined();
  });
  it('rejects unsafe names before invoking the CLI', async () => {
    await expect(downloadImage(secret, '../secret', TEST_TARGET)).rejects.toMatchObject({ statusCode: 400 });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('does not trust an image extension or upstream image content type', async () => {
    childProcess(Buffer.from('<html>private login</html>'), { headers: 'HTTP/2.0 200 OK\r\nContent-Type: image/png\r\n\r\n' });
    await expect(downloadImage(secret, 'image.png', TEST_TARGET)).rejects.toMatchObject({ statusCode: 415 });
    childProcess(png, { headers: 'HTTP/2.0 302 Found\n\r\n' });
    await expect(downloadImage(secret, 'image.png', TEST_TARGET)).rejects.toMatchObject({ statusCode: 415 });
    childProcess(png, { code: 1 });
    await expect(downloadImage(secret, 'image.png', TEST_TARGET)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('terminates oversized and stalled CLI responses', async () => {
    const large = childProcess(Buffer.alloc(15_000_001));
    await expect(downloadImage(secret, 'large.png', TEST_TARGET)).rejects.toMatchObject({ statusCode: 413 });
    expect(large.kill).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    const stalled = childProcess(Buffer.alloc(0), { pending: true });
    const assertion = expect(downloadImage(secret, 'stalled.png', TEST_TARGET)).rejects.toMatchObject({ statusCode: 504 });
    await vi.advanceTimersByTimeAsync(45_000); await assertion;
    expect(stalled.kill).toHaveBeenCalledOnce();
  });
});
