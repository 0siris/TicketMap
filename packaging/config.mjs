import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { loadGitLabConfig } from './server/config.js';

try {
  const [mode, file] = process.argv.slice(2);
  let env;
  if (mode === '--read') env = parseEnv(readFileSync(file, 'utf8'));
  else if (mode === '--validate') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const target = JSON.parse(input);
    env = { GITLAB_URL: target.gitlabUrl, GITLAB_PROJECT: target.project };
  } else throw new Error('Invalid configuration command');
  process.stdout.write(JSON.stringify(loadGitLabConfig(env)));
} catch {
  process.stderr.write('GitLab configuration is missing or invalid\n');
  process.exitCode = 1;
}
