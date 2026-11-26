$ErrorActionPreference = 'Continue'

# ---------- A. LIMPIAR TEMP ----------
$t = $env:TEMP
$before = (Get-ChildItem $t -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum)
Write-Output ("TEMP antes: {0:N2} GB ({1} archivos)" -f ($before.Sum/1GB), $before.Count)

Get-ChildItem $t -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch { }
}

$after = (Get-ChildItem $t -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum)
Write-Output ("TEMP despues: {0:N2} GB ({1} archivos)" -f ($after.Sum/1GB), $after.Count)

# ---------- B. REVISAR INSTALADORES ----------
$keys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$installed = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | Select-Object DisplayName, DisplayVersion
$instNorm  = $installed | ForEach-Object { (($_.DisplayName -replace '[^A-Za-z0-9]', '').ToLower()) }

Write-Output ""
Write-Output "=== INSTALADORES EN Downloads\Programs ==="
$dir = "$env:USERPROFILE\Downloads\Programs"
$total = 0
Get-ChildItem $dir -File -Force -ErrorAction SilentlyContinue | Sort-Object Length -Descending | ForEach-Object {
    $total += $_.Length
    $tokens = [regex]::Matches($_.BaseName, '[A-Za-z]{4,}') | ForEach-Object { $_.Value.ToLower() } | Select-Object -Unique
    $match = $null
    foreach ($tk in $tokens) {
        $hit = $instNorm | Where-Object { $_ -like "*$tk*" } | Select-Object -First 1
        if ($hit) { $match = $tk; break }
    }
    $estado = if ($match) { "instalado ($match)" } else { "SIN coincidencia" }
    Write-Output ("{0,8:N1} MB  {1,-42} {2}" -f ($_.Length/1MB), $_.Name, $estado)
}
Write-Output ("TOTAL: {0:N2} GB" -f ($total/1GB))

# ---------- C. ACCESOS DIRECTOS ----------
$desk = [Environment]::GetFolderPath('Desktop')
$sh   = New-Object -ComObject WScript.Shell

$targets = @(
    @{ Name = 'Pixelle Video.lnk'; Target = 'C:\Apps\Pixelle-Video\start.bat'; WorkDir = 'C:\Apps\Pixelle-Video'; Desc = 'Pixelle Video' }
)

Write-Output ""
Write-Output "=== ACCESOS DIRECTOS ==="
foreach ($t2 in $targets) {
    if (Test-Path -LiteralPath $t2.Target) {
        $lnkPath = Join-Path $desk $t2.Name
        $s = $sh.CreateShortcut($lnkPath)
        $s.TargetPath       = $t2.Target
        $s.WorkingDirectory = $t2.WorkDir
        $s.Description      = $t2.Desc
        $s.WindowStyle      = 7
        $s.Save()
        Write-Output ("CREADO: " + $lnkPath + " -> " + $t2.Target)
    } else {
        Write-Output ("OMITIDO (no existe el destino): " + $t2.Target)
    }
}

# LiveMultiStudio no tiene ejecutable: solo DLLs
$lms = Get-ChildItem 'C:\Apps\LiveMultiStudio' -Recurse -File -ErrorAction SilentlyContinue
$exes = $lms | Where-Object Extension -eq '.exe'
Write-Output ""
Write-Output ("LiveMultiStudio: {0} archivos, {1} ejecutables -> sin destino valido para acceso directo" -f $lms.Count, $exes.Count)
