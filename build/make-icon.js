// Genera build/icon.png (1024) e build/icon.ico (16…256) a partir de build/icon.html.
// Uso: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron')
const { promises: fsp } = require('node:fs')
const { join } = require('node:path')

app.disableHardwareAcceleration()

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const table = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((entry, index) => {
    const at = index * 16
    const dim = entry.size >= 256 ? 0 : entry.size
    table.writeUInt8(dim, at)
    table.writeUInt8(dim, at + 1)
    table.writeUInt8(0, at + 2)
    table.writeUInt8(0, at + 3)
    table.writeUInt16LE(1, at + 4)
    table.writeUInt16LE(32, at + 6)
    table.writeUInt32LE(entry.png.length, at + 8)
    table.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, table, ...entries.map((entry) => entry.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  })

  await win.loadFile(join(__dirname, 'icon.html'))
  await new Promise((resolve) => setTimeout(resolve, 600))

  // Una sola captura grande y escalado de alta calidad para cada tamaño:
  // la ventana de Windows no baja de ~100px, así que no sirve capturar a 16px.
  const raw = await win.webContents.capturePage()
  const { width, height } = raw.getSize()
  console.log('captura', width, 'x', height)
  const side = Math.min(width, height)
  const source = raw.crop({
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    width: side,
    height: side
  })
  const resized = (size) => source.resize({ width: size, height: size, quality: 'best' }).toPNG()

  const large = resized(1024)
  await fsp.writeFile(join(__dirname, 'icon.png'), large)
  console.log('icon.png', large.length, 'bytes')

  const entries = []
  for (const size of SIZES.slice().reverse()) {
    const png = resized(size)
    entries.push({ size, png })
    console.log(`icono ${size}px`, png.length, 'bytes')
  }

  await fsp.writeFile(join(__dirname, 'icon.ico'), buildIco(entries))
  console.log('icon.ico listo')
  app.quit()
})
