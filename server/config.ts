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

export function loadLocalGitLabConfig(path = process.env.TICKETMAP_CONFIG_FILE ??
  fileURLToPath(new URL('../.env', import.meta.url))): GitLabTarget {
  try { loadEnvFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new ConfigurationError('The local .env file could not be loaded');
  }
  return loadGitLabConfig();
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): { host: '127.0.0.1' | '0.0.0.0'; port: number } {
  const host = env.TICKETMAP_BIND_HOST ?? '0.0.0.0';
  if (host !== '127.0.0.1' && host !== '0.0.0.0')
    throw new ConfigurationError('TICKETMAP_BIND_HOST must be 127.0.0.1 or 0.0.0.0');
  const rawPort = env.TICKETMAP_PORT ?? '4310';
  const port = Number(rawPort);
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort) || port > 65535)
    throw new ConfigurationError('TICKETMAP_PORT must be an integer from 1 to 65535');
  return { host, port };
}
