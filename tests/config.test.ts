import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadGitLabConfig } from '../server/config.js';

describe('local GitLab configuration', () => {
  it('requires a host and namespace/project without a deployment fallback', () => {
    expect(() => loadGitLabConfig({})).toThrow('GITLAB_URL');
    expect(() => loadGitLabConfig({ GITLAB_URL: 'https://gitlab.example.com' })).toThrow('GITLAB_PROJECT');
  });
  it('accepts a custom HTTPS origin, port, and subgroup project and normalizes the origin', () => {
    const config = loadGitLabConfig({ GITLAB_URL: 'https://GitLab.example.com:8443/',
      GITLAB_PROJECT: 'group/subgroup/team-project' });
    expect(config).toEqual({ gitlabUrl: 'https://gitlab.example.com:8443', project: 'group/subgroup/team-project' });
  });
  it.each(['http://gitlab.example.com', 'https://user:password@gitlab.example.com',
    'https://gitlab.example.com/gitlab', 'https://gitlab.example.com/a/../',
    'https://gitlab.example.com?token=private', 'https://gitlab.example.com#fragment',
    'https://gitlab.example.com\\other', 'https://gitlab.example.com\n', 'not-a-url'])
    ('rejects an unsafe or unsupported GitLab origin without echoing its value', value => {
      expect(() => loadGitLabConfig({ GITLAB_URL: value, GITLAB_PROJECT: 'group/project' })).toThrow('GITLAB_URL');
      try { loadGitLabConfig({ GITLAB_URL: value, GITLAB_PROJECT: 'group/project' }); }
      catch (error) { expect((error as Error).message).not.toContain(value); }
    });
  it.each(['project', '/group/project', 'group/project/', 'group//project', 'group/../project',
    'group/project?token=private', 'group/project#1', 'group/%2e%2e', 'group\\project', 'group/a b'])
    ('rejects an invalid project path', value => {
      expect(() => loadGitLabConfig({ GITLAB_URL: 'https://gitlab.example.com', GITLAB_PROJECT: value }))
        .toThrow('GITLAB_PROJECT');
    });
  it('loads a local file while process environment values take precedence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ticket-map-config-'));
    const path = join(directory, '.env');
    writeFileSync(path, 'GITLAB_URL=https://file.example.com\nGITLAB_PROJECT=file/project\n');
    const script = `import { loadLocalGitLabConfig } from './server/config.ts';
      console.log(JSON.stringify(loadLocalGitLabConfig(process.argv[1])));`;
    const env = { ...process.env, GITLAB_URL: 'https://runtime.example.com', GITLAB_PROJECT: 'runtime/project' };
    try {
      const runtime = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path],
        { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
      expect(runtime.status).toBe(0);
      expect(JSON.parse(runtime.stdout)).toEqual({ gitlabUrl: 'https://runtime.example.com', project: 'runtime/project' });
      delete (env as NodeJS.ProcessEnv).GITLAB_URL; delete (env as NodeJS.ProcessEnv).GITLAB_PROJECT;
      const file = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path],
        { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
      expect(file.status).toBe(0);
      expect(JSON.parse(file.stdout)).toEqual({ gitlabUrl: 'https://file.example.com', project: 'file/project' });
    } finally { unlinkSync(path); rmdirSync(directory); }
  });
});
