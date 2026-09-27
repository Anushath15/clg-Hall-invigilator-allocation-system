// Regenerates resources/icon.png and resources/icon.ico from the logo artwork
// resources/logo-source.webp.  Run with: npm run icons   (uses Electron's renderer)
//
// The artwork is a portrait shield on a flat dark-green background. We paint over the
// generator watermark in its bottom-right corner, crop a square centred on the shield
// (padding with the background colour), round the corners, and draw it at every icon
// size. The .ico stores each size as PNG data, which Windows Vista and later support.
const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const path = require("path")

const resources = path.join(__dirname, "..", "resources")
const source = fs.readFileSync(path.join(resources, "logo-source.webp")).toString("base64")
const PNG_SIZE = 512
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// Measured on logo-source.webp (1441 x 2000): shield bounds and watermark position.
const BG = "rgb(30,63,47)"
const SHIELD = { x0: 16, y0: 152, x1: 1314, y1: 1885 }
const WATERMARK = { x: 1160, y: 1705, w: 140, h: 145 }
const MARGIN = 40

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL("data:text/html,<html><body></body></html>")
  const render = size => win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        // 1. Clean copy of the artwork with the watermark painted over.
        const clean = document.createElement("canvas")
        clean.width = img.width; clean.height = img.height
        const cx = clean.getContext("2d")
        cx.drawImage(img, 0, 0)
        cx.fillStyle = "${BG}"
        cx.fillRect(${WATERMARK.x}, ${WATERMARK.y}, ${WATERMARK.w}, ${WATERMARK.h})

        // 2. Square crop centred on the shield, padded with the background colour.
        const side = Math.max(${SHIELD.x1 - SHIELD.x0}, ${SHIELD.y1 - SHIELD.y0}) + 2 * ${MARGIN}
        const sx = (${SHIELD.x0} + ${SHIELD.x1}) / 2 - side / 2
        const sy = (${SHIELD.y0} + ${SHIELD.y1}) / 2 - side / 2

        // 3. Draw at the target size inside a rounded tile.
        const c = document.createElement("canvas")
        c.width = c.height = ${size}
        const ctx = c.getContext("2d")
        const r = ${size} * 0.2
        ctx.beginPath(); ctx.roundRect(0, 0, ${size}, ${size}, r); ctx.clip()
        ctx.fillStyle = "${BG}"; ctx.fillRect(0, 0, ${size}, ${size})
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(clean, sx, sy, side, side, 0, 0, ${size}, ${size})
        resolve(c.toDataURL("image/png").split(",")[1])
      }
      img.onerror = reject
      img.src = "data:image/webp;base64,${source}"
    })`)

  fs.writeFileSync(path.join(resources, "icon.png"), Buffer.from(await render(PNG_SIZE), "base64"))
  const images = []
  for (const size of ICO_SIZES) images.push({ size, data: Buffer.from(await render(size), "base64") })
  fs.writeFileSync(path.join(resources, "icon.ico"), buildIco(images))

  console.log(`icon.png (${PNG_SIZE}px) and icon.ico (${ICO_SIZES.join(", ")}px) written to resources/`)
  app.quit()
})
