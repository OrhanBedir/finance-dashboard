import test from "node:test";
import assert from "node:assert/strict";
import { yerlesimHesapla, olcudenEkrana, ekrandanOlcuye, varsayilanKose, dondur, disbukey, yeterliBuyuk, sinirla, gecerliKose } from "../src/mantik/kirpma.js";

const olcu = { w: 1200, h: 1600 };
test("yerleşim contain: oran korunur, ortalanır", () => {
  const y = yerlesimHesapla(olcu, { w: 390, h: 600 });
  assert.ok(Math.abs(y.w / y.h - 0.75) < 1e-9);
  assert.ok(y.x >= 22 && y.y >= 22 && y.x + y.w <= 390 - 21.9 && y.y + y.h <= 600 - 21.9);
  assert.equal(yerlesimHesapla(null, { w: 1, h: 1 }), null);
});
test("ekran ↔ fotoğraf ölçüsü dönüşümü tutarlı (sunucunun beklediği [[x,y]×4])", () => {
  const y = yerlesimHesapla(olcu, { w: 390, h: 600 });
  const k = [[100, 120], [1100, 130], [1080, 1500], [90, 1490]];
  const geri = ekrandanOlcuye(olcudenEkrana(k, y), y);
  geri.forEach((p, i) => { assert.ok(Math.abs(p[0] - k[i][0]) <= 0.1 && Math.abs(p[1] - k[i][1]) <= 0.1); });
  assert.ok(gecerliKose(geri));
});
test("döndür köşe sırasını kaydırır (belgenin üstü değişir), dört dönüşte başa döner", () => {
  const k = varsayilanKose(olcu);
  assert.deepEqual(dondur(k)[0], k[3]);
  assert.deepEqual(dondur(dondur(dondur(dondur(k)))), k);
});
test("çaprazlanmış köşe reddedilir, küçük alan uyarılır, nokta sınır dışına çıkmaz", () => {
  assert.equal(disbukey([[0, 0], [10, 0], [10, 10], [0, 10]]), true);
  assert.equal(disbukey([[0, 0], [10, 10], [10, 0], [0, 10]]), false);
  assert.equal(yeterliBuyuk([[0, 0], [10, 0], [10, 10], [0, 10]], olcu), false);
  assert.equal(yeterliBuyuk(varsayilanKose(olcu), olcu), true);
  const y = yerlesimHesapla(olcu, { w: 390, h: 600 });
  const p = sinirla({ x: -50, y: 9999 }, y);
  assert.equal(p.x, y.x); assert.equal(p.y, y.y + y.h);
});
