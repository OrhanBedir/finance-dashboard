// Yerel depo dosyalarını uygulamaya sunar (fiş görselleri)
const http = require("http"), fs = require("fs"), path = require("path");
const KOK = process.env.OMNIX_YEREL_DEPO;
http.createServer((q, r) => { const p = path.join(KOK, decodeURIComponent(q.url.split("?")[0])); if (!p.startsWith(KOK) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": p.endsWith(".png") ? "image/png" : "image/jpeg" }); fs.createReadStream(p).pipe(r); }).listen(5098, "127.0.0.1");
