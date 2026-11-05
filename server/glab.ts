import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitLabTarget } from '../shared/types.js';

export interface GraphQLClient {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export class ServiceError extends Error {
  constructor(public statusCode: number, message: string, public current?: unknown) { super(message); }
}

export function glabPath(): string {
  if (process.env.GLAB_PATH) return process.env.GLAB_PATH;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const installed = join(process.env.LOCALAPPDATA, 'Programs', 'glab', 'glab.exe');
    if (existsSync(installed)) return installed;
  }
  return 'glab';
}

export class GlabClient implements GraphQLClient {
  constructor(private readonly target: GitLabTarget) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env.GLAB_DEBUG_HTTP;
    delete env.GLAB_DEBUG;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(glabPath(), ['api', 'graphql', '--hostname', new URL(this.target.gitlabUrl).host,
        '--method', 'POST', '--input', '-'], { shell: false, windowsHide: true, env });
      let stdout = '';
      let stderr = '';
      let size = 0;
      const timer = setTimeout(() => {
        child.kill();
        reject(new ServiceError(504, 'GitLab antwortet nicht. Bitte erneut versuchen.'));
      }, 45_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > 25_000_000) {
          child.kill();
          reject(new ServiceError(502, 'Die GitLab-Antwort ist zu groß.'));
        } else stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
      child.stdin.on('error', () => { /* The process exit handler reports a failed request. */ });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new ServiceError(503, 'GitLab CLI nicht gefunden. GLAB_PATH prüfen und glab auth login ausführen.'));
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) {
          const forbidden = /403|forbidden|not authorized|permission/i.test(stderr);
          reject(new ServiceError(forbidden ? 403 : 502, forbidden
            ? 'GitLab erlaubt diese Aktion nicht.'
            : 'GitLab-Anfrage fehlgeschlagen. Verbindung und glab auth status prüfen.'));
        } else resolve(stdout);
      });
      child.stdin.end(JSON.stringify({ query, variables }));
    });
    let response: { data?: T; errors?: { message: string }[] };
    try { response = JSON.parse(output); }
    catch { throw new ServiceError(502, 'GitLab hat keine gültige JSON-Antwort geliefert.'); }
    if (response.errors?.length || !response.data)
      throw new ServiceError(502, 'GitLab konnte die Anfrage nicht vollständig ausführen. Bitte erneut laden.');
    return response.data;
  }
}
