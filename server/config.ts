import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { GitLabTarget } from '../shared/types.js';

export class ConfigurationError extends Error {}

export function loadGitLabConfig(env: NodeJS.ProcessEnv = process.env): GitLabTarget {
  const rawUrl = env.GITLAB_URL;
  if (!rawUrl)
    throw new ConfigurationError('Set GITLAB_URL in the local .env file or process environment');
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new ConfigurationError('GITLAB_URL must be an HTTPS origin, for example https://gitlab.example.com'); }
  if (!/^https:\/\/[^/?#\\\s]+\/?$/i.test(rawUrl) || url.protocol !== 'https:' || !url.hostname ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new ConfigurationError('GITLAB_URL must be an HTTPS origin without credentials, path, query, or fragment');

  const project = env.GITLAB_PROJECT;
  if (!project)
    throw new ConfigurationError('Set GITLAB_PROJECT to namespace/project in the local .env file or process environment');
  if (project.length > 1024 || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$/.test(project))
    throw new ConfigurationError('GITLAB_PROJECT must be a namespace/project path; nested groups are allowed');
  return Object.freeze({ gitlabUrl: url.origin, project });
}

export function loadLocalGitLabConfig(path = fileURLToPath(new URL('../.env', import.meta.url))): GitLabTarget {
  try { loadEnvFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new ConfigurationError('The local .env file could not be loaded');
  }
  return loadGitLabConfig();
}
