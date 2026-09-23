const https = require("https");
const agent = new https.Agent({ rejectUnauthorized: false });
https.get({ hostname: "myapplication-2adb30a9.web.app", path: "/index.html", agent }, res => {
  let b = "";
  res.on("data", d => b += d);
  res.on("end", () => {
    console.log("HTTP status:", res.statusCode);
    console.log("HTML length:", b.length);
    console.log("Has React root:", b.includes('id="root"'));
    console.log("Has script:", b.includes("<script"));
    const idx = b.indexOf("assets/index-");
    if (idx !== -1) {
      console.log("JS bundle:", b.substring(idx, idx + 50));
    } else {
      console.log("JS bundle: none found in HTML");
    }
    console.log("WASM check: pending...");
    https.get({ hostname: "myapplication-2adb30a9.web.app", path: "/sql-wasm-browser.wasm", agent }, r2 => {
      let wb = Buffer.alloc(0);
      r2.on("data", d => { wb = Buffer.concat([wb, Buffer.from(d)]); });
      r2.on("end", () => {
        console.log("WASM HTTP:", r2.statusCode, "Content-Type:", r2.headers["content-type"]);
        console.log("WASM magic bytes:", wb.slice(0, 4).toString("hex"), "(expected: 0061736d)");
      });
    });
  });
});
