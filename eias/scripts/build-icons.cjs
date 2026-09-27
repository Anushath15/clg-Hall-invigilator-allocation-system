// Regenerates resources/icon.png and resources/icon.ico from resources/icon.svg.
// Run with: npm run icons   (uses Electron's renderer, so no extra dependencies)
//
// The SVG is drawn directly at every target size (not downscaled from one big
// bitmap), which keeps the 16/24/32 px taskbar icons crisp. The .ico stores
// each size as PNG data, which Windows Vista and later support.
const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const path = require("path")

const resources = path.join(__dirname, "..", "resources")
const svg = fs.readFileSync(path.join(resources, "icon.svg"), "utf8")
const PNG_SIZE = 512
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2)                      // palette colours
    e.writeUInt8(0, 3)                      // reserved
    e.writeUInt16LE(1, 4)                   // colour planes
    e.writeUInt16LE(32, 6)                  // bits per pixel
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
        const c = document.createElement("canvas")
        c.width = c.height = ${size}
        const ctx = c.getContext("2d")
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL("image/png").split(",")[1])
      }
      img.onerror = reject
      img.src = "data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"
    })`)

  const png = Buffer.from(await render(PNG_SIZE), "base64")
  fs.writeFileSync(path.join(resources, "icon.png"), png)

  const images = []
  for (const size of ICO_SIZES) images.push({ size, data: Buffer.from(await render(size), "base64") })
  fs.writeFileSync(path.join(resources, "icon.ico"), buildIco(images))

  console.log(`icon.png (${PNG_SIZE}px) and icon.ico (${ICO_SIZES.join(", ")}px) written to resources/`)
  app.quit()
})
