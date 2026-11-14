import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archive = resolve(process.argv[2] || join(root, 'release', `TicketMap-${pkg.version}-windows-x64.zip`));
const temporary = join(tmpdir(), `TicketMap portable smoke ${randomUUID()}`);
let child;

function powershell(script, env = {}) {
  const result = spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, env: { ...process.env, ...env,
      PSModulePath: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'Portable PowerShell verification failed');
  return result.stdout.trim();
}

function executable(file, args) {
  const result = spawnSync(file, args, { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

try {
  await mkdir(temporary, { recursive: true });
  const expected = (await readFile(join(dirname(archive), 'SHA256SUMS'), 'utf8')).trim().split(/\s+/)[0];
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), expected, 'ZIP checksum mismatch');
  powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:TICKETMAP_ARCHIVE, $env:TICKETMAP_EXTRACT)", {
    TICKETMAP_ARCHIVE: archive, TICKETMAP_EXTRACT: temporary,
  });
  const portable = join(temporary, 'TicketMap');
  const app = join(portable, 'app');
  const node = join(portable, 'runtime/node.exe');
  const glab = join(portable, 'runtime/glab.exe');
  const entry = join(app, 'server/main.js');
  const data = join(portable, 'data');
  for (const file of [node, glab, entry, join(app, 'dist/index.html'), join(portable, 'TicketMap.cmd'),
    join(portable, 'ConfigureTicketMap.cmd'), join(portable, 'StopTicketMap.cmd')]) await stat(file);
  await assert.rejects(stat(join(data, '.env')));
  await assert.rejects(stat(join(data, 'credentials.dat')));
  const nodeVersion = executable(node, ['--version']);
  const glabVersion = executable(glab, ['version']);
  const distribution = JSON.parse(await readFile(join(app, 'distribution.json'), 'utf8'));
  assert.equal(distribution.version, pkg.version);
  await mkdir(data, { recursive: true });
  await writeFile(join(data, '.env'), 'GITLAB_URL=https://gitlab.example.com\nGITLAB_PROJECT=example/project\n');
  const target = JSON.parse(executable(node, [join(app, 'portable-config.mjs'), '--read', join(data, '.env')]));
  assert.deepEqual(target, { gitlabUrl: 'https://gitlab.example.com', project: 'example/project' });
  const port = await freePort();
  const env = { ...process.env, TICKETMAP_CONFIG_FILE: join(data, '.env'), TICKETMAP_BIND_HOST: '127.0.0.1',
    TICKETMAP_PORT: String(port), TICKETMAP_DISTRIBUTION_FILE: join(app, 'distribution.json'), GLAB_PATH: glab };
  for (const name of ['GITLAB_URL', 'GITLAB_PROJECT', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN',
    'CI_JOB_TOKEN', 'GLAB_DEBUG', 'GLAB_DEBUG_HTTP']) delete env[name];
  child = spawn(node, [entry], { cwd: portable, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume(); child.stderr.resume();
  const address = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let info;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Bundled server exited before readiness');
    try {
      const response = await fetch(`${address}/api/app-info`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { info = await response.json(); break; }
    } catch { }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(info, { application: 'TicketMap', version: pkg.version });
  const page = await fetch(address);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/assets\/index-/);
  const denied = await fetch(`${address}/api/issues`, {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(denied.status, 403);

  const nativeProof = powershell(`
$ErrorActionPreference='Stop'
$root=$env:TICKETMAP_PACKAGE
$node=Join-Path $root 'runtime\\node.exe'
$entry=Join-Path $root 'app\\server\\main.js'
$data=Join-Path $root 'data'
$credentialFile=Join-Path $data 'credentials.dat'
$serverFile=Join-Path $data 'server.json'
$NonInteractive=$true
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'TicketMap.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Launcher syntax error'}
$functions=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)
foreach($function in $functions){ . ([scriptblock]::Create($function.Extent.Text)) }
$target=[pscustomobject]@{gitlabUrl='https://gitlab.example.com';project='example/project'}
$secret='synthetic-portable-smoke-secret'
$secure=ConvertTo-SecureString $secret -AsPlainText -Force
$saved=@{gitlabUrl=$target.gitlabUrl;protectedToken=(ConvertFrom-SecureString $secure)}
[IO.File]::WriteAllText($credentialFile,($saved|ConvertTo-Json))
if((Read-Credential $target) -ne $secret){throw 'DPAPI roundtrip failed'}
if((Read-Credential ([pscustomobject]@{gitlabUrl='https://other.example.com'}))){throw 'Token crossed GitLab origins'}
$env:GITLAB_TOKEN='parent-synthetic-token'
$env:GITLAB_ACCESS_TOKEN='other-parent-synthetic-token'
$env:GLAB_DEBUG_HTTP='1'
$childInfo=New-ChildInfo $node @($entry) $secret
if($childInfo.EnvironmentVariables['GITLAB_TOKEN'] -ne $secret -or $childInfo.EnvironmentVariables['GITLAB_ACCESS_TOKEN'] -or $childInfo.EnvironmentVariables['GLAB_DEBUG_HTTP']){throw 'Child environment isolation failed'}
if($env:GITLAB_TOKEN -ne 'parent-synthetic-token' -or $childInfo.Arguments.Contains($secret)){throw 'Token leaked outside child environment'}
$server=Get-Process -Id ([int]$env:TICKETMAP_SERVER_PID)
$ticks=$server.StartTime.ToUniversalTime().Ticks.ToString()
[IO.File]::WriteAllText($serverFile,(@{pid=$server.Id;startTicks='0';port=1}|ConvertTo-Json))
if(Get-OwnedServer){throw 'PID reuse ownership check failed'}
[IO.File]::WriteAllText($serverFile,(@{pid=$PID;startTicks=$ticks;port=1}|ConvertTo-Json))
Stop-OwnedServer
if(-not (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)){throw 'Unowned process was stopped'}
[IO.File]::WriteAllText($serverFile,(@{pid=$server.Id;startTicks=$ticks;port=1}|ConvertTo-Json))
if(-not (Get-OwnedServer)){throw 'Owned server was not recognized'}
Stop-OwnedServer
if(Get-Process -Id $server.Id -ErrorAction SilentlyContinue){throw 'Owned server was not stopped'}
'DPAPI, host binding, child-only token environment, PID/path/start-time ownership: passed'
`, { TICKETMAP_PACKAGE: portable, TICKETMAP_SERVER_PID: String(child.pid) });
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  child = undefined;
  console.log(JSON.stringify({ artifact: archive, nodeVersion, glabVersion, version: pkg.version,
    applicationReady: true, writeGuard: true, gitLabRequests: 0, nativeProof }, null, 2));
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected smoke directory');
  await rm(temporary, { recursive: true, force: true });
}
