import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = join(root, 'release');
const cache = join(release, '.cache');
const stage = join(release, `.stage-${randomUUID()}`);
const portable = join(stage, 'TicketMap');
const app = join(portable, 'app');
const runtime = join(portable, 'runtime');
const licenses = join(portable, 'licenses');
const pins = JSON.parse(await readFile(join(root, 'packaging/runtimes.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const allowDirty = process.argv.includes('--allow-dirty');
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${executable}`);
  return result.stdout?.trim();
}

function powershell(script, env = {}) {
  return run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...env,
      PSModulePath: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') },
  });
}

function git(args) {
  return run('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function repositoryFromOrigin(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value);
  if (!match || match[1].split('/').some(part => part === '.' || part === '..'))
    throw new Error('Set origin to the GitHub repository that will publish this package');
  return match[1];
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function download(pin, filename) {
  const target = join(cache, filename);
  try { if (await sha256(target) === pin.sha256) return target; } catch { }
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 200_000_000 || createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
    throw new Error(`Runtime checksum mismatch: ${filename}`);
  await writeFile(target, bytes);
  return target;
}

async function findFile(directory, filename) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) {
      const found = await findFile(file, filename);
      if (found) return found;
    } else if (item.name.toLowerCase() === filename.toLowerCase()) return file;
  }
  return undefined;
}

async function expand(archive, directory) {
  await mkdir(directory, { recursive: true });
  powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:TICKETMAP_ARCHIVE, $env:TICKETMAP_EXTRACT)", {
    TICKETMAP_ARCHIVE: archive, TICKETMAP_EXTRACT: directory,
  });
}

async function verifyPackageTree(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('The portable package must not contain symbolic links');
    if (/^(?:\.env(?:\..*)?|credentials\.dat|server\.json|\.git|output|test-results|playwright-report)$/i.test(item.name)
        && item.name !== '.env.example') throw new Error(`Private or runtime path found in package: ${item.name}`);
    if (item.isDirectory()) await verifyPackageTree(file);
  }
}

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 package on Windows x64');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Portable releases need a stable semantic version');
const dirty = git(['status', '--porcelain']);
if (dirty && !allowDirty) throw new Error('Commit the release source first, or use --allow-dirty for local verification only');
const repository = repositoryFromOrigin(git(['remote', 'get-url', 'origin']));
const commit = dirty ? null : git(['rev-parse', 'HEAD']);
const artifactName = `TicketMap-${pkg.version}-windows-x64.zip`;
const artifact = join(release, artifactName);
run(process.execPath, [npmCli, 'run', 'build']);
await stat(join(root, 'dist/index.html'));

await mkdir(cache, { recursive: true });
await mkdir(app, { recursive: true });
await mkdir(runtime, { recursive: true });
await mkdir(licenses, { recursive: true });
try {
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project',
    join(root, 'tsconfig.server.json'), '--outDir', app]);
  await cp(join(root, 'dist'), join(app, 'dist'), { recursive: true });
  await cp(join(root, 'package.json'), join(app, 'package.json'));
  await cp(join(root, 'package-lock.json'), join(app, 'package-lock.json'));
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app });
  for (const name of ['TicketMap.cmd', 'StopTicketMap.cmd', 'ConfigureTicketMap.cmd', 'TicketMap.ps1', 'Readme.txt'])
    await cp(join(root, 'packaging', name), join(portable, name));
  await cp(join(root, 'packaging/config.mjs'), join(app, 'portable-config.mjs'));
  await cp(join(root, '.env.example'), join(portable, '.env.example'));
  await writeFile(join(app, 'distribution.json'), JSON.stringify({ version: pkg.version, repository }, null, 2) + '\n');

  for (const [name, pin] of Object.entries(pins)) {
    if (!/^[0-9a-f]{64}$/.test(pin.sha256) || !pin.url.startsWith('https://')) throw new Error('Invalid runtime pin');
    const archive = await download(pin, `${name}-${pin.version}-windows-x64.zip`);
    const extracted = join(stage, `${name}-archive`);
    await expand(archive, extracted);
    const executable = await findFile(extracted, `${name}.exe`);
    const license = await findFile(extracted, 'LICENSE');
    if (!executable || !license) throw new Error(`The ${name} archive lacks its executable or license`);
    await cp(executable, join(runtime, `${name}.exe`));
    await cp(license, join(licenses, `${name}-LICENSE.txt`));
  }
  await writeFile(join(licenses, 'THIRD-PARTY-NOTICES.txt'),
    'Node.js and its bundled third-party notices are in node-LICENSE.txt.\n' +
    'GitLab CLI is licensed under MIT; see glab-LICENSE.txt.\n' +
    'Application dependencies retain their package metadata and license files in app/node_modules.\n');
  await writeFile(join(portable, 'PROVENANCE.json'), JSON.stringify({ version: pkg.version, sourceCommit: commit,
    localVerificationBuild: Boolean(dirty), runtimes: pins }, null, 2) + '\n');
  await verifyPackageTree(portable);
  powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; if (Test-Path -LiteralPath $env:TICKETMAP_ZIP) { Remove-Item -LiteralPath $env:TICKETMAP_ZIP -Force }; $archive=[System.IO.Compression.ZipFile]::Open($env:TICKETMAP_ZIP, [System.IO.Compression.ZipArchiveMode]::Create); try { foreach ($file in [System.IO.Directory]::GetFiles($env:TICKETMAP_PACKAGE, '*', [System.IO.SearchOption]::AllDirectories)) { $name='TicketMap/' + $file.Substring($env:TICKETMAP_PACKAGE.Length + 1).Replace([char]92, [char]47); [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $name, [System.IO.Compression.CompressionLevel]::Optimal) } } finally { $archive.Dispose() }", {
    TICKETMAP_PACKAGE: portable, TICKETMAP_ZIP: artifact,
  });
  const digest = await sha256(artifact);
  await writeFile(join(release, 'SHA256SUMS'), `${digest}  ${artifactName}\n`);
  console.log(JSON.stringify({ artifact, sha256: digest, sourceCommit: commit, localVerificationBuild: Boolean(dirty) }));
} finally {
  if (!resolve(stage).startsWith(release + sep) || !dirname(stage).endsWith('release'))
    throw new Error('Refusing to remove an unexpected staging path');
  await rm(stage, { recursive: true, force: true });
}
