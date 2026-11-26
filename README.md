# ShowCue

Sistema de cues para shows en vivo para Windows. Reproduce audio, vídeo e imágenes en varias
pantallas y altavoces a la vez, con fades, grupos y control de luces DMX por Art-Net.

Pensado para teatro, danza, conciertos y presentaciones donde alguien tiene que disparar
sonido y vídeo en el momento exacto, sin depender de un DAW ni de un reproductor de vídeo
aparte.

## Funcionalidad

- **Cues** de audio, vídeo, imagen, grupo, espera (*wait*), parada (*stop*), fade y memo.
- **Lista de cues** con número, nombre, duración, notas y arrastre para reordenar; inspector
  para editar cada cue y deshacer/rehacer cambios.
- **Audio** con Web Audio: volumen, paneo, fade in/out, loop, dispositivo de salida elegible.
- **Vídeo e imagen** en ventanas de salida por pantalla, con recorte, ajuste y varias capas
  simultáneas (una salida puede mostrar varios cues a la vez).
- **Grupos**: disparar, pausar o parar varios cues juntos.
- **Pausa / reanudar** de todo el show y **pánico** para cortar la salida.
- **DMX sobre Art-Net** (universos 0-based) con cue de tipo DMX, importación de perfiles
  **GDTF** y JSON, y escucha de RDM para descubrir dispositivos y cambiar dirección de inicio.
- **OSC** bidireccional: salida de `/go`, `/cue/<n>/go`, comandos gMA3 y pánico; entrada en un
  puerto configurable para disparar cues desde una consola o tableta.
- **MIDI**, atajos de teclado, exportación/importación de la lista en CSV y copias de
  seguridad automáticas del proyecto.
- Interfaz en español, con tema oscuro.

## Requisitos

- Windows 10 u 11, 64 bits.
- Para audio y vídeo: una tarjeta de sonido y, si se usan salidas en pantalla completa, una o
  varias pantallas conectadas.
- Para DMX: una interfaz Art-Net en la misma red (nodo Ethernet, consola o software compatible).

## Descarga e instalación

Cada versión se publica en la sección **Releases** de este repositorio, con dos archivos:

| Archivo | Uso |
| --- | --- |
| `ShowCue-<versión>-instalador.exe` | Instalador para Windows (acceso directo en el escritorio y en el menú Inicio). |
| `ShowCue-<versión>-portable.exe` | Versión portable: se ejecuta sin instalar. |

Ambos se compilan en GitHub Actions a partir del código de este repositorio y se firman con
un certificado de **SignPath Foundation**. Los detalles están en
[CODE_SIGNING.md](CODE_SIGNING.md).

Los datos del usuario (proyecto, ajustes y fixtures) se guardan en `%APPDATA%\showcue` y no se
tocan al actualizar ni al desinstalar.

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev        # desarrollo con recarga
npm run typecheck  # comprobación de tipos
npm run build      # compila a out/
npm run dist       # instalador y portable en release/
```

## Licencia

MIT. Véase [LICENSE](LICENSE).
