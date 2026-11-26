$ErrorActionPreference = 'Continue'
$stamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
$backup = Join-Path $env:USERPROFILE "organizacion-backup-$stamp"
$log    = Join-Path $env:backup "log.txt"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$log = Join-Path $backup 'log.txt'

function Log($m) { $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Write-Output $line; Add-Content -LiteralPath $log -Value $line }

function Recycle-Path($p) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    if (Test-Path -LiteralPath $p -PathType Container) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
        Log "PAPELERA <- carpeta: $p"
    } elseif (Test-Path -LiteralPath $p) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
        Log "PAPELERA <- archivo: $p"
    }
}

Log "=== INICIO organizacion ==="
Log ("Espacio libre antes: {0:N1} GB" -f ((Get-PSDrive C).Free / 1GB))

# ---- 1. BACKUP del arranque automatico ----
$runKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
reg export $runKey (Join-Path $backup 'HKCU-Run-backup.reg') /y | Out-Null
Log "Backup de claves Run -> $backup\HKCU-Run-backup.reg"

# ---- 2. VACIAR PAPELERA ----
Log "Vaciando papelera (puede tardar por los ~48 GB)..."
try {
    Clear-RecycleBin -DriveLetter C -Force -ErrorAction Stop
    Log "Papelera vaciada correctamente."
} catch {
    Log ("ERROR vaciando papelera: " + $_.Exception.Message)
}

# ---- 3. MESHLIVE: cerrar, quitar del arranque, desinstalar ----
Get-Process meshlive -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force; Log "Proceso meshlive cerrado (PID $($_.Id))" } catch { Log "No se pudo cerrar PID $($_.Id)" }
}

$runPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($name in @('MeshLive', 'utweb', 'RiotClient', 'EADM')) {
    if (Get-ItemProperty -Path $runPath -Name $name -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $runPath -Name $name -ErrorAction SilentlyContinue
        Log "Arranque: eliminada entrada '$name'"
    } else {
        Log "Arranque: '$name' no existia"
    }
}

# lanzadores (.lnk) que apunten a MeshLive o a Descargas
$sh = New-Object -ComObject WScript.Shell
$lnkDirs = @("$env:USERPROFILE\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs")
$lnks = Get-ChildItem $lnkDirs -Filter *.lnk -Recurse -Force -ErrorAction SilentlyContinue
foreach ($l in $lnks) {
    $t = $sh.CreateShortcut($l.FullName).TargetPath
    if ($t -like '*MeshLive*' -or $t -like '*meshlive*') {
        Remove-Item -LiteralPath $l.FullName -Force -ErrorAction SilentlyContinue
        Log "Lanzador eliminado: $($l.FullName)"
    }
}

# carpeta de la app + configuracion
$meshDirs = @(
    "$env:USERPROFILE\Downloads\MeshLive-0.3.1-windows-x64",
    "$env:APPDATA\MeshLive", "$env:APPDATA\meshlive",
    "$env:LOCALAPPDATA\MeshLive", "$env:LOCALAPPDATA\meshlive"
)
foreach ($d in $meshDirs) { if (Test-Path -LiteralPath $d) { Recycle-Path $d } }
$meshZip = "$env:USERPROFILE\Downloads\MeshLive-0.3.1-windows-x64.zip"
if (Test-Path -LiteralPath $meshZip) { Recycle-Path $meshZip }

# ---- 4. CARPETA DESTINO PARA PORTABLES ----
$apps = 'C:\Apps'
try {
    New-Item -ItemType Directory -Path $apps -Force -ErrorAction Stop | Out-Null
} catch {
    $apps = Join-Path $env:USERPROFILE 'Apps'
    New-Item -ItemType Directory -Path $apps -Force -ErrorAction Stop | Out-Null
    Log "Sin permiso en C:\ -> se usa $apps"
}
Log "Carpeta de programas portables: $apps"

# ---- 5. MOVER PORTABLES ----
$moves = @(
    @{ Src = "$env:USERPROFILE\Downloads\Pixelle-Video-v0.1.15-win64"; Dst = "$apps\Pixelle-Video" },
    @{ Src = "$env:USERPROFILE\Downloads\LiveMultiStudio_Touch_Win_v1_4_1"; Dst = "$apps\LiveMultiStudio" }
)
foreach ($m in $moves) {
    if (Test-Path -LiteralPath $m.Src) {
        if (Test-Path -LiteralPath $m.Dst) {
            Log ("OMITIDO (ya existe destino): " + $m.Dst)
        } else {
            try {
                Move-Item -LiteralPath $m.Src -Destination $m.Dst -ErrorAction Stop
                Log ("MOVIDO: " + $m.Src + "  ->  " + $m.Dst)
            } catch {
                Log ("ERROR moviendo " + $m.Src + ": " + $_.Exception.Message)
            }
        }
    } else { Log ("No existe: " + $m.Src) }
}

# ---- 6. ORDENAR INSTALADORES VIEJOS DENTRO DE DESCARGAS ----
$arch = "$env:USERPROFILE\Downloads\Archives"
if (Test-Path -LiteralPath $arch) {
    $toArch = @("$env:USERPROFILE\Downloads\Voice Creator Pro 1.1.9")
    foreach ($p in $toArch) {
        if (Test-Path -LiteralPath $p) {
            $dest = Join-Path $arch (Split-Path $p -Leaf)
            if (-not (Test-Path -LiteralPath $dest)) {
                Move-Item -LiteralPath $p -Destination $dest -ErrorAction SilentlyContinue
                Log ("ARCHIVADO: " + $p + " -> " + $dest)
            }
        }
    }
}

# ---- 7. REVISAR RUTAS ROTAS HACIA DESCARGAS ----
Log "--- Referencias a 'Downloads' en accesos directos ---"
$rest = Get-ChildItem $lnkDirs -Filter *.lnk -Recurse -Force -ErrorAction SilentlyContinue
$found = $false
foreach ($l in $rest) {
    $t = $sh.CreateShortcut($l.FullName).TargetPath
    if ($t -like '*Downloads*') { Log ("PENDIENTE: " + $l.FullName + " -> " + $t); $found = $true }
}
if (-not $found) { Log "Ninguna: todas las rutas quedaron limpias." }

# ---- 8. RESUMEN ----
Log ("Espacio libre despues: {0:N1} GB" -f ((Get-PSDrive C).Free / 1GB))
Log "=== FIN ==="
Write-Output ""
Write-Output "*** ENTRADAS DE ARRANQUE QUE QUEDAN ***"
(Get-ItemProperty -Path $runPath).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { Write-Output ("  {0} = {1}" -f $_.Name, $_.Value) }
