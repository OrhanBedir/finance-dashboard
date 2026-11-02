const fs = require("fs");
const g = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const COS = Math.cos(39 * Math.PI / 180);
const proj = (lng, lat) => [(lng - 25.5) * 100 * COS, (42.4 - lat) * 100];
const TOL = Number(process.argv[4] || 1.1);
function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let mx = -1, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b]; const dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > mx) { mx = d; mi = i; } }
    if (mx > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const alan = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s / 2); };
let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
const iller = g.features.map((f) => {
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  let d = "", best = null, bestA = 0;
  for (const poly of polys) {
    const outer = poly[0].map(([a, b]) => proj(a, b));
    const A = alan(outer);
    if (A > bestA) { bestA = A; best = outer; }
    if (A < 4 && polys.length > 1) continue; // küçük adacıklar
    const m = outer.length >> 1; const s = [...dp(outer.slice(0, m + 1), TOL).slice(0, -1), ...dp(outer.slice(m), TOL)];
    if (s.length < 3) continue;
    d += s.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
    for (const [x, y] of s) { X0 = Math.min(X0, x); Y0 = Math.min(Y0, y); X1 = Math.max(X1, x); Y1 = Math.max(Y1, y); }
  }
  // il merkezi: en büyük parçanın alan ağırlık merkezi
  let cx = 0, cy = 0, a6 = 0;
  for (let i = 0; i < best.length; i++) { const [x1, y1] = best[i], [x2, y2] = best[(i + 1) % best.length]; const c = x1 * y2 - x2 * y1; a6 += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; }
  a6 *= 3; cx /= a6; cy /= a6;
  return { ad: f.properties.name, d, cx: +cx.toFixed(1), cy: +cy.toFixed(1) };
});
const out = `// Türkiye il sınırları (mobil saha haritası, 02.11.2026). Web Rollout haritasıyla AYNI kaynak (frontend/src/data/tr-iller.geo.json,
// Apache-2.0) ve aynı izdüşüm; boyut için Douglas–Peucker ile sadeleştirildi (tolerans ${TOL} birim ≈ ${(TOL * 1.1).toFixed(1)} km).
// Bu dosya üretilmiştir — elle düzenlemeyin (üreteç: teslim/harita/iller-uret.js).
export const IZDUSUM_COS = ${COS};
export const proj = (lng, lat) => [(lng - 25.5) * 100 * IZDUSUM_COS, (42.4 - lat) * 100];
export const SINIR = { x: ${X0.toFixed(1)}, y: ${Y0.toFixed(1)}, w: ${(X1 - X0).toFixed(1)}, h: ${(Y1 - Y0).toFixed(1)} };
export const ILLER = ${JSON.stringify(iller)};
`;
fs.writeFileSync(process.argv[3], out);
console.log(iller.length, "il", (out.length / 1024).toFixed(1), "KB", iller.slice(0, 3).map((x) => x.ad));
