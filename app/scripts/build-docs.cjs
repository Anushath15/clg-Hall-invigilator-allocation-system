// Renders the HTML documents in ../docs to A4 PDFs next to them.
// Run with: npm run docs   (uses Electron's built-in Chromium PDF printer)
const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const path = require("path")

const docsDir = path.join(__dirname, "..", "..", "docs")
const pages = ["HIAS-User-Guide.html", "HIAS-Project-Report.html"]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1400 })
  for (const page of pages) {
    await win.loadFile(path.join(docsDir, page))
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#9CA3AF;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial">
        <span>HIAS – Hall Invigilator Allocation System</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
    })
    const out = path.join(docsDir, page.replace(/\.html$/, ".pdf"))
    fs.writeFileSync(out, pdf)
    console.log(`${path.basename(out)}: ${(pdf.length / 1024).toFixed(0)} KB`)
  }
  app.quit()
})
