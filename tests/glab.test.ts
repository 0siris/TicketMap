import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { GlabClient } from '../server/glab.js';
import { TEST_TARGET } from './fixtures.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function processMock(response: string, code = 0) {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), kill: vi.fn() });
  let input = '';
  process.stdin.on('data', chunk => { input += chunk.toString(); });
  process.stdin.on('finish', () => {
    process.stdout.end(response);
    queueMicrotask(() => process.emit('close', code));
  });
  vi.mocked(spawn).mockReturnValue(process as any);
  return { process, input: () => input };
}
describe('shell-free GitLab transport', () => {
  it('passes the configured self-hosted hostname and port to the CLI', async () => {
    processMock('{"data":{"ok":true}}');
    await new GlabClient({ gitlabUrl: 'https://selfhosted.example.com:8443', project: 'group/subgroup/project' })
      .query('query { test }');
    const args = vi.mocked(spawn).mock.calls[0][1];
    expect(args).toContain('selfhosted.example.com:8443');
  });
  it('passes GraphQL JSON on stdin and never interpolates user text into arguments', async () => {
    const child = processMock(JSON.stringify({ data: { accepted: true } }));
    const title = 'äöü $(not-a-command) `test` "quoted"';
    expect(await new GlabClient(TEST_TARGET).query('mutation Test($title: String!) { test(title: $title) }', { title })).toEqual({ accepted: true });
    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual(['api', 'graphql', '--hostname', 'gitlab.example.com', '--method', 'POST', '--input', '-']);
    expect(call[2]).toMatchObject({ shell: false, windowsHide: true });
    expect(JSON.parse(child.input()).variables.title).toBe(title);
  });
  it('rejects partial GraphQL errors and malformed JSON', async () => {
    processMock(JSON.stringify({ data: { partial: true }, errors: [{ message: 'private details' }] }));
    await expect(new GlabClient(TEST_TARGET).query('query { test }')).rejects.toMatchObject({ statusCode: 502 });
    processMock('not json');
    await expect(new GlabClient(TEST_TARGET).query('query { test }')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('removes HTTP debug environment settings', async () => {
    vi.stubEnv('GLAB_DEBUG_HTTP', '1'); vi.stubEnv('GLAB_DEBUG', '1');
    processMock('{"data":{"ok":true}}');
    await new GlabClient(TEST_TARGET).query('query { test }');
    const options = vi.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.GLAB_DEBUG_HTTP).toBeUndefined();
    expect(options.env.GLAB_DEBUG).toBeUndefined();
  });
});
