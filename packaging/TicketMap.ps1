param(
    [ValidateSet('Start', 'Stop', 'Configure')][string]$Mode = 'Start',
    [switch]$NoBrowser,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$node = Join-Path $root 'runtime\node.exe'
$glab = Join-Path $root 'runtime\glab.exe'
$entry = Join-Path $root 'app\server\main.js'
$configHelper = Join-Path $root 'app\portable-config.mjs'
$data = Join-Path $root 'data'
$configFile = Join-Path $data '.env'
$credentialFile = Join-Path $data 'credentials.dat'
$serverFile = Join-Path $data 'server.json'
$distributionFile = Join-Path $root 'app\distribution.json'
$port = 4310
if ($env:TICKETMAP_PORT) {
    if (-not [int]::TryParse($env:TICKETMAP_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw 'TICKETMAP_PORT muss zwischen 1 und 65535 liegen'
    }
}
$address = 'http://127.0.0.1:' + $port

function New-ChildInfo([string]$Executable, [string[]]$Arguments, [string]$Token) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $quoted = @($Arguments | ForEach-Object {
        if ($_ -match '["\r\n]') { throw 'Ungueltiges Prozessargument' }
        '"' + $_ + '"'
    })
    $info.Arguments = $quoted -join ' '
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($name in @('GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'CI_JOB_TOKEN',
                       'GLAB_DEBUG', 'GLAB_DEBUG_HTTP', 'CI', 'GITLAB_CI')) {
        $info.EnvironmentVariables.Remove($name)
    }
    if ($Token) { $info.EnvironmentVariables['GITLAB_TOKEN'] = $Token }
    return $info
}

function Invoke-Child([string]$Executable, [string[]]$Arguments, [string]$Token = '', [string]$InputText = '') {
    $info = New-ChildInfo $Executable $Arguments $Token
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(45000)) {
            $process.Kill()
            throw 'Die Anfrage hat zu lange gedauert'
        }
        $process.WaitForExit()
        [void]$stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ Success = ($process.ExitCode -eq 0); Output = $stdout.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

function Read-Configuration {
    if (-not (Test-Path -LiteralPath $configFile)) { return $null }
    $result = Invoke-Child $node @($configHelper, '--read', $configFile)
    if ($result.Success) { return ($result.Output | ConvertFrom-Json) }
    return $null
}

function Ask-Configuration($Current) {
    if ($NonInteractive) { throw 'Konfiguration fehlt oder ist ungueltig. ConfigureTicketMap.cmd ausfuehren' }
    Write-Host 'TicketMap einrichten' -ForegroundColor Cyan
    Write-Host 'GitLab-Server und Projekt werden nur in diesem Paket gespeichert.'
    while ($true) {
        $urlDefault = if ($Current) { $Current.gitlabUrl } else { 'https://gitlab.com' }
        $projectDefault = if ($Current) { $Current.project } else { '' }
        $url = Read-Host ('GitLab-Server [' + $urlDefault + ']')
        if (-not $url) { $url = $urlDefault }
        $project = Read-Host ('Projekt (Gruppe/Projekt) [' + $projectDefault + ']')
        if (-not $project) { $project = $projectDefault }
        $json = @{ gitlabUrl = $url; project = $project } | ConvertTo-Json -Compress
        $result = Invoke-Child $node @($configHelper, '--validate') '' $json
        if ($result.Success) {
            $target = $result.Output | ConvertFrom-Json
            $text = 'GITLAB_URL=' + $target.gitlabUrl + "`nGITLAB_PROJECT=" + $target.project + "`n"
            [System.IO.File]::WriteAllText($configFile, $text, [System.Text.UTF8Encoding]::new($false))
            return $target
        }
        Write-Host 'Bitte eine HTTPS-Serveradresse und einen gueltigen Projektpfad eingeben.' -ForegroundColor Yellow
    }
}

function Read-Credential($Target) {
    if (-not (Test-Path -LiteralPath $credentialFile)) { return '' }
    try {
        $saved = [System.IO.File]::ReadAllText($credentialFile) | ConvertFrom-Json
        if ($saved.gitlabUrl -ne $Target.gitlabUrl) { return '' }
        $secure = ConvertTo-SecureString $saved.protectedToken
        return [System.Net.NetworkCredential]::new('', $secure).Password
    } catch {
        if ($NonInteractive) { throw 'Die gespeicherte Anmeldung ist auf diesem Windows-Konto nicht verfuegbar' }
        Write-Host 'Die gespeicherte Anmeldung kann hier nicht gelesen werden. Eine neue Anmeldung ist notwendig.' -ForegroundColor Yellow
        return ''
    }
}

function Test-GitLabAccess($Target, [string]$Token) {
    $hostname = ([uri]$Target.gitlabUrl).Authority
    $endpoint = 'projects/' + [uri]::EscapeDataString($Target.project)
    $result = Invoke-Child $glab @('api', $endpoint, '--hostname', $hostname, '--method', 'GET') $Token
    return $result.Success
}

function Resolve-Credential($Target, [bool]$ForcePrompt) {
    $token = Read-Credential $Target
    if (-not $ForcePrompt -and (Test-GitLabAccess $Target $token)) { return $token }
    if ($NonInteractive) { throw 'GitLab-Anmeldung oder Projektzugriff fehlt. ConfigureTicketMap.cmd ausfuehren' }
    Write-Host 'Ein persoenlicher GitLab-Token mit api-Berechtigung und Zugriff auf das Projekt wird benoetigt.'
    while ($true) {
        $secure = Read-Host 'GitLab-Token (Eingabe ist verborgen; leer = abbrechen)' -AsSecureString
        $token = [System.Net.NetworkCredential]::new('', $secure).Password
        if (-not $token) { throw 'Einrichtung abgebrochen' }
        if (Test-GitLabAccess $Target $token) {
            $saved = @{ gitlabUrl = $Target.gitlabUrl; protectedToken = (ConvertFrom-SecureString $secure) }
            [System.IO.File]::WriteAllText($credentialFile, ($saved | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
            return $token
        }
        $token = ''
        Write-Host 'Anmeldung nicht bestaetigt. Server, Projekt und Token-Berechtigungen pruefen.' -ForegroundColor Yellow
    }
}

function Get-OwnedServer {
    if (-not (Test-Path -LiteralPath $serverFile)) { return $null }
    try {
        $saved = [System.IO.File]::ReadAllText($serverFile) | ConvertFrom-Json
        $process = Get-Process -Id ([int]$saved.pid) -ErrorAction Stop
        $details = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $process.Id)
        $expected = '^\s*"?' + [regex]::Escape($node) + '"?\s+"?' + [regex]::Escape($entry) + '"?(?:\s|$)'
        if ($process.Path -ne $node -or $details.CommandLine -notmatch $expected -or
            $process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$saved.startTicks) { return $null }
        return $process
    } catch { return $null }
}

function Stop-OwnedServer {
    $process = Get-OwnedServer
    if ($process) {
        Stop-Process -Id $process.Id -ErrorAction Stop
        $process.WaitForExit()
        Write-Host 'TicketMap wurde beendet.'
    }
    if (Test-Path -LiteralPath $serverFile) { Remove-Item -LiteralPath $serverFile -Force }
}

$mutex = $null
$token = ''
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Dieses Paket benoetigt Windows x64' }
    foreach ($file in @($node, $glab, $entry, $configHelper, $distributionFile)) {
        if (-not (Test-Path -LiteralPath $file)) { throw 'Das Paket ist unvollstaendig. Das gesamte ZIP erneut entpacken' }
    }
    [void][System.IO.Directory]::CreateDirectory($data)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $name = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = [System.Threading.Mutex]::new($false, ('Local\TicketMap-' + $name.Substring(0, 20)))
    if (-not $mutex.WaitOne(0)) { throw 'Eine andere TicketMap-Startaktion ist noch aktiv' }
    if ($Mode -eq 'Stop') { Stop-OwnedServer; exit 0 }

    $existing = Get-OwnedServer
    if ($Mode -eq 'Configure') {
        Stop-OwnedServer
        $existing = $null
    }
    if ($existing) {
        $saved = [System.IO.File]::ReadAllText($serverFile) | ConvertFrom-Json
        $address = 'http://127.0.0.1:' + $saved.port
        if (-not $NoBrowser) { Start-Process $address }
        Write-Host ('TicketMap laeuft: ' + $address)
        exit 0
    }

    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw ('Port ' + $port + ' ist bereits belegt. Die andere Anwendung wird nicht beendet')
    }
    $target = Read-Configuration
    if (-not $target -or $Mode -eq 'Configure') { $target = Ask-Configuration $target }
    $force = $false
    if ($Mode -eq 'Configure' -and -not $NonInteractive) {
        $force = (Read-Host 'Neue GitLab-Anmeldung eingeben? [j/N]') -match '^(j|ja|y|yes)$'
    }
    $token = Resolve-Credential $target $force
    $info = New-ChildInfo $node @($entry) $token
    $info.EnvironmentVariables['TICKETMAP_CONFIG_FILE'] = $configFile
    $info.EnvironmentVariables['GITLAB_URL'] = $target.gitlabUrl
    $info.EnvironmentVariables['GITLAB_PROJECT'] = $target.project
    $info.EnvironmentVariables['TICKETMAP_BIND_HOST'] = '127.0.0.1'
    $info.EnvironmentVariables['TICKETMAP_PORT'] = [string]$port
    $info.EnvironmentVariables['TICKETMAP_DISTRIBUTION_FILE'] = $distributionFile
    $info.EnvironmentVariables['GLAB_PATH'] = $glab
    $process = [System.Diagnostics.Process]::Start($info)
    $token = ''
    $info.EnvironmentVariables.Remove('GITLAB_TOKEN')
    $saved = @{ pid = $process.Id; startTicks = $process.StartTime.ToUniversalTime().Ticks.ToString(); port = $port }
    [System.IO.File]::WriteAllText($serverFile, ($saved | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { break }
        try {
            $status = Invoke-RestMethod -Uri ($address + '/api/app-info') -TimeoutSec 1
            $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
            if ($status.application -eq 'TicketMap' -and $listeners.OwningProcess -contains $process.Id) {
                $ready = $true; break
            }
        } catch { }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { Stop-OwnedServer; throw 'TicketMap konnte nicht gestartet werden. Konfiguration und Port pruefen' }
    if (-not $NoBrowser) { Start-Process $address }
    Write-Host ('TicketMap laeuft: ' + $address)
} catch {
    Write-Host ('Fehler: ' + $_.Exception.Message) -ForegroundColor Red
    if (-not $NonInteractive) { [void](Read-Host 'Enter zum Schliessen') }
    exit 1
} finally {
    $token = ''
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch { }
        $mutex.Dispose()
    }
}
