import test from "node:test";
import assert from "node:assert/strict";
import { duzenlenebilir, fotoSilinebilir, ilerleme, kalemMetni } from "../src/mantik/cleanup.js";

const kayit = (onay_durum, items) => ({ onay_durum, items });
const foto = (tip, kullanici = "a@x.com") => ({ tip, url: `u-${tip}-${Math.random()}`, kullanici });

test("ilerleme: her kalemde 'sonra' fotoğrafı varsa gönderilebilir", () => {
  const k = kayit(null, [{ id: 1, fotolar: [foto("once"), foto("sonra")], tamamlandi: true }, { id: 2, fotolar: [foto("once")] }]);
  assert.deepEqual(ilerleme(k), { toplam: 2, tamam: 1, sonraEksik: 1, gonderilebilir: false });
  k.items[1].fotolar.push(foto("sonra"));
  assert.equal(ilerleme(k).gonderilebilir, true);
  assert.equal(ilerleme(kayit(null, [])).gonderilebilir, false, "kalemsiz kayıt gönderilemez");
});

test("kilit: onaya gönderilmiş / onaylanmış kayıt düzenlenmez; red sonrası açılır", () => {
  assert.equal(duzenlenebilir(kayit(null, [])), true);
  assert.equal(duzenlenebilir(kayit("TASLAK", [])), true);
  assert.equal(duzenlenebilir(kayit("RED", [])), true);
  assert.equal(duzenlenebilir(kayit("ONAY_BEKLE", [])), false);
  assert.equal(duzenlenebilir(kayit("ONAYLANDI", [])), false);
  assert.equal(duzenlenebilir(null), false);
});

test("foto silme: yalnız yükleyen ve kayıt kilitli değilken", () => {
  const f = foto("sonra", "Ahmet@Simsektel.com");
  assert.equal(fotoSilinebilir(f, "ahmet@simsektel.com", kayit("TASLAK", [])), true);
  assert.equal(fotoSilinebilir(f, "veli@simsektel.com", kayit("TASLAK", [])), false);
  assert.equal(fotoSilinebilir(f, "ahmet@simsektel.com", kayit("ONAY_BEKLE", [])), false);
  assert.equal(fotoSilinebilir(f, "", kayit("TASLAK", [])), false);
});

test("kalem metni: madde işareti temizlenir, boşsa okunur yer tutucu", () => {
  assert.equal(kalemMetni({ kalem: "• Etiket eksik" }), "Etiket eksik");
  assert.equal(kalemMetni({}), "Eksik kalem");
});
