# Política de firma de código (Windows)

ShowCue es software libre bajo licencia MIT. Sus ejecutables de Windows se firman con un
certificado de **SignPath Foundation**, que acredita que el binario se compiló a partir del
código público de este repositorio.

## Qué se firma

En cada versión se firman exactamente estos dos archivos, generados por el flujo de trabajo
`.github/workflows/release.yml`:

| Archivo | Contenido |
| --- | --- |
| `ShowCue-<versión>-instalador.exe` | Instalador NSIS (x64). |
| `ShowCue-<versión>-portable.exe` | Ejecutable portable (x64). |

No se firma ningún otro archivo ni se distribuye ningún binario que no provenga de este
repositorio.

## Cómo se compila

- El flujo de trabajo se ejecuta en `windows-latest`, un runner alojado por GitHub.
- Pasos: `npm ci` → `npm run typecheck` → `npm run dist` (electron-vite + electron-builder),
  sin certificados locales: `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- Los dos ejecutables sin firmar se suben como artefacto del propio flujo de trabajo y se
  envían a SignPath mediante `signpath/github-action-submit-signing-request`. SignPath
  comprueba que el artefacto viene de ese build de GitHub antes de firmarlo.
- El artefacto firmado se descarga, se publica en la Release junto con su `SHA256SUMS.txt` y
  el código fuente de esa etiqueta.
- Cada envío de firma lo aprueba manualmente el mantenedor (política `release-signing`).

Los builds se pueden reproducir localmente con `npm ci && npm run dist`; el resultado no
lleva firma, pero el código es el mismo.

## Cómo verificar la firma

PowerShell:

```powershell
Get-AuthenticodeSignature .\ShowCue-1.0.0-instalador.exe | Format-List Status, SignerCertificate
```

`Status` debe ser `Valid` y el firmante, `SignPath Foundation`. También se puede revisar en
las propiedades del archivo, pestaña *Firmas digitales*.

Las sumas SHA-256 publicadas en cada Release permiten comprobar la integridad de la descarga:

```powershell
Get-FileHash .\ShowCue-1.0.0-instalador.exe -Algorithm SHA256
```

## Limitaciones conocidas

- El ejecutable interior que el instalador deja en `Archivos de programa` no lleva firma
  propia: se firma el instalador y el portable que el usuario descarga. Windows evalúa la
  reputación del archivo descargado.
- No hay firma para macOS ni Linux: sólo se distribuyen ejecutables de Windows.

## Puesta en marcha (mantenedor)

1. Publicar este repositorio en GitHub con la licencia MIT y una Release ya existente
   (SignPath pide que el proyecto ya se distribuya en la forma que se va a firmar).
2. Solicitar el alta en <https://signpath.org/apply> indicando: repositorio, licencia MIT,
   URL de descargas (Releases), esta política como *code signing policy* y los dos
   ejecutables que se firman.
3. En SignPath, dentro del proyecto: crear una configuración de artefacto subiendo una
   muestra del ZIP con los dos `.exe` y marcando *firmar varios archivos*; el slug debe ser
   `showcue-ejecutables` (o cambiar la variable del flujo de trabajo).
4. En GitHub → *Settings → Secrets and variables → Actions*: secreto `SIGNPATH_API_TOKEN` y
   variables `SIGNPATH_ORGANIZATION_ID` (y, si difieren, los slugs).
5. Publicar una etiqueta `v1.0.0`: el flujo de trabajo compila, envía la solicitud, espera la
   aprobación manual, verifica la firma y crea la Release.

## Contacto

Mantenedor: zzever — incidencias en la sección *Issues* de este repositorio.
