// Stok defteri miktar kuralları (mobil) — sunucuyla aynı sonuçları vermeli
import { test } from "node:test";
import assert from "node:assert/strict";
import { miktarCoz, miktarGoster, stokIslemKontrol } from "../src/mantik/stok.js";

test("virgüllü / noktalı miktar", () => {
  assert.equal(miktarCoz("12,5").metin, "12.500");
  assert.equal(miktarCoz("12.5").metin, "12.500");
  assert.equal(miktarCoz("1.234,5").metin, "1234.500");
  assert.equal(miktarCoz("0,125").metin, "0.125");
  assert.equal(miktarCoz(" 40 ").metin, "40.000");
  assert.equal(miktarCoz("1,2340").metin, "1.234");
});
test("geçersiz miktarlar", () => {
  for (const v of ["", "0", "0,000", "-3", "abc", "1,2345", "1,2,3", null]) assert.ok(miktarCoz(v).hata, `reddedilmeli: ${v}`);
});
test("ön kontrol: kullanılabilir aşımı, tam sayı, saha", () => {
  assert.match(stokIslemKontrol({ tur: "tuketim", miktar: "25", kullanilabilir: 20, sahaKodu: "IZ1" }), /kullanılabilir 20/);
  assert.match(stokIslemKontrol({ tur: "tuketim", miktar: "2,5", kullanilabilir: 20, sahaKodu: "IZ1", tamSayi: true }), /tam sayı/);
  assert.match(stokIslemKontrol({ tur: "tuketim", miktar: "2", kullanilabilir: 20, sahaKodu: "" }), /Saha/);
  assert.equal(stokIslemKontrol({ tur: "iade", miktar: "20", kullanilabilir: 20 }), null);
  assert.equal(miktarGoster(12.5), "12,5");
});
