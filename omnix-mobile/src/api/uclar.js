// Mevcut backend uçları — web ve eski mobil uygulamayla AYNI sözleşme. 29.10.2026: stok defteri uçları (stokApi) eklendi.
// Kişisel listelerde kimlik her zaman oturumdaki kullanıcıdır (sunucu da token'dan kilitler); e-posta
// parametresi yalnız sunucunun bunu istediği eski uçlarda ve yalnız kendi adresimizle gönderilir.
import { api } from "./istemci";

const kodla = encodeURIComponent;

export const oturumApi = {
  giris: (email, password) => api.post("/auth/login", { email, password }, { kimliksiz: true, zamanAsimiMs: 45000 }),
  ben: () => api.get("/auth/me", { zamanAsimiMs: 45000 }),
};

export const panoApi = {
  // Puantaj özeti, son avans/masraflar, trafik cezaları, onaycı bayrakları ve onay listeleri
  pano: (k) => api.get(`/hr/mobile-dashboard?email=${kodla(k.email)}&name=${kodla(k.name || "")}`),
  // Kişisel hesap ekstresi: bakiye + hareketler + yoldaki (bakiyeye işlenmemiş) kayıtlar — web ile aynı kaynak
  hesap: () => api.get("/hr/is-avans/hesap"),
};

export const avansApi = {
  listem: (k) => api.get(`/hr/is-avans?email=${kodla(k.email)}&name=${kodla(k.name || "")}`),
  olustur: (govde) => api.post("/hr/is-avans", govde),
  personelSecim: () => api.get("/hr/personel-secim"),
  odemeHesabi: (personelId) => api.get(`/hr/personel-secim/${personelId ? Number(personelId) : "kendim"}/odeme-hesabi`),
  atananArac: (k) => api.get(`/hr/atanan-arac?email=${kodla(k.email)}`),
  // Onaycı işlemleri (yetki backend'de adım adım denetlenir)
  onayla: (id, firma, direktor) => api.put(`/hr/is-avans/${id}/${direktor ? "direktor-onayla" : "onayla"}`, firma ? { firma } : {}),
  reddet: (id, aciklama, email) => api.put(`/hr/is-avans/${id}/reddet`, { red_aciklama: aciklama, reddeden_email: email }),
};

export const masrafApi = {
  formlar: () => api.get("/hr/masraf-form"),
  form: (id) => api.get(`/hr/masraf-form/${id}`),
  // Kullanıcının TASLAK formu varsa onu döndürür, yoksa yeni taslak açar (backend kuralı)
  taslakAc: (k, donem) => api.post("/hr/masraf-form", { talep_eden_email: k.email, talep_eden_ad: k.name || k.email, donem }),
  kalemEkle: (govde) => api.post("/hr/masraf-kalem", govde),
  kalemGuncelle: (id, govde) => api.put(`/hr/masraf-kalem/${id}`, govde),
  kalemSil: (id) => api.sil(`/hr/masraf-kalem/${id}`),
  belgeYukle: (kalemId, dosya) => api.yukle(`/hr/masraf-belge/${kalemId}`, dosya, { kirpildi: "0", kaynak: "omnix-mobil" }),
  // Otomatik fiş kırpma servisi (yayına alınınca): önizleme döner, eki oluşturmaz
  fisIsle: (kalemId, dosya) => api.yukle(`/hr/masraf-belge/${kalemId}/isle`, dosya),
  fisEkle: (kalemId, islemeId, secimler) => api.post(`/hr/masraf-belge/${kalemId}`, { isleme_id: islemeId, secimler }, { zamanAsimiMs: 120000 }),
  belgeSil: (id) => api.sil(`/hr/masraf-belge/${id}`),
  gonder: (id) => api.put(`/hr/masraf-form/${id}/submit`),
};

// Stok defteri (29.10.2026): kişisel stok, sahada tüketim, depo iadesi. Kimlik sunucuda token'dan; personel bilgisi gönderilmez.
// Yazma isteklerinde istek_anahtari taslakta saklanır: bağlantı koparsa aynı anahtarla tekrar → sunucu ikinci kez yazmaz.
export const stokApi = {
  benim: () => api.get("/malzeme/stok/benim?limit=60"),
  sahalarim: (q) => api.get(`/malzeme/stok/sahalarim?q=${kodla(q || "")}`),
  tuketim: (govde) => api.post("/malzeme/stok/tuketim", govde),
  iade: (govde) => api.post("/malzeme/stok/iade", govde),
  iadeIptal: (id, anahtar) => api.post(`/malzeme/stok/iade/${Number(id)}/iptal`, { istek_anahtari: anahtar }),
};

export const malzemeApi = {
  taleplerim: (k) => api.get(`/malzeme/talepler?email=${kodla(k.email)}&name=${kodla(k.name || "")}`),
  talep: (id) => api.get(`/malzeme/talepler/${id}`),
  olustur: (govde) => api.post("/malzeme/talepler", govde),
  durum: (id, govde) => api.put(`/malzeme/talepler/${id}/durum`, govde),
  zimmetim: (k) => api.get(`/malzeme/dagitim?personel_email=${kodla(k.email)}`),
  iade: (id, govde) => api.put(`/malzeme/dagitim/${id}/iade`, govde),
};

// Saha haritası (02.11.2026): kimin hangi sahaları göreceğine sunucu karar verir (personel → kendi atanan işleri)
export const haritaApi = {
  sahalar: () => api.get("/mobil/harita", { zamanAsimiMs: 90000 }),
};

export const isApi = {
  benim: () => api.get("/is-atama/benim"),
  detay: (id) => api.get(`/is-atama/${id}`),
  // 03.11.2026: istek_anahtari — aynı dokunuş / çevrimdışı tekrar gönderimi sunucuda ikinci kez işlenmez (is_atama_istek)
  basla: (id, istekAnahtari) => api.post(`/is-atama/${id}/basla`, { istek_anahtari: istekAnahtari }),
  bitir: (id, govde, istekAnahtari) => api.post(`/is-atama/${id}/bitir`, { ...govde, istek_anahtari: istekAnahtari }),
  // Fiilî bildirim (iş kodu bazında, QC'ye yazmaz): BASLADI / TAMAMLANDI / ISSUE / ISSUE_KAPANDI
  bildir: (govde, istekAnahtari) => api.post("/is-fiili/bildir", { ...govde, istek_anahtari: istekAnahtari }),
};

// İş Atama (yönetici, 03.11.2026): web "Rollout İş Atama" ile AYNI kayıtlar / yetki / kurallar; kim neyi görür sunucu karar verir
export const atamaApi = {
  yetkim: () => api.get("/is-atama/yetkim"),
  baslangic: () => api.get("/mobil/is-atama/baslangic", { zamanAsimiMs: 60000 }),
  ara: (q) => api.get(`/mobil/is-atama/ara?q=${kodla(q)}`, { zamanAsimiMs: 90000 }),
  kontrol: (govde) => api.post("/mobil/is-atama/kontrol", govde, { zamanAsimiMs: 60000 }),
  olustur: (govde, istekAnahtari) => api.post("/mobil/is-atama", { ...govde, istek_anahtari: istekAnahtari }, { zamanAsimiMs: 60000 }),
  liste: ({ filtre = "bugun", q = "", bolge = "", ekip_no = "", durum = "", kategori = "" } = {}) =>
    api.get(`/mobil/is-atama/liste?filtre=${kodla(filtre)}&q=${kodla(q)}&bolge=${kodla(bolge)}&ekip_no=${kodla(ekip_no)}&durum=${kodla(durum)}&kategori=${kodla(kategori)}`, { zamanAsimiMs: 90000 }),
  detay: (id) => api.get(`/mobil/is-atama/${id}`),
  guncelle: (id, govde) => api.put(`/mobil/is-atama/${id}`, govde),
  iptal: (id, govde) => api.post(`/mobil/is-atama/${id}/iptal`, govde),
  devret: (id, govde) => api.post(`/mobil/is-atama/${id}/devret`, govde),
};

// Onaylar (25.10.2026): kullanıcının ŞU AN işlem yapabileceği kayıtlar; firma + tarihli onay devri backend'de hesaplanır.
// Masraf formu işlemleri web ile aynı uçlar; her adımın yetkisi sunucuda yeniden denetlenir.
export const onayApi = {
  bekleyen: () => api.get("/onay/bekleyen"),
  masrafForm: (id) => api.get(`/hr/masraf-form/${id}`),
  masrafOnayla: (id, adim, not) => api.put(`/hr/masraf-form/${id}/${{ ROLLOUT: "rollout-onayla", MUHASEBE: "muhasebe-onayla", PM: "pm-onayla", DIREKTOR: "direktor-onayla" }[adim]}`,
    { [{ ROLLOUT: "rollout_not", MUHASEBE: "muhasebe_not", PM: "pm_not", DIREKTOR: "direktor_not" }[adim]]: not || null }),
  masrafGeriGonder: (id, aciklama, email) => api.put(`/hr/masraf-form/${id}/geri-gonder`, { aciklama, gonderen_email: email }),
  masrafReddet: (id, adim, aciklama, email) => api.put(`/hr/masraf-form/${id}/${adim === "DIREKTOR" ? "direktor-reddet" : "pm-reddet"}`, { red_aciklama: aciklama, reddeden_email: email }),
  avansOnayla: (a, firma) => api.put(`/hr/is-avans/${a.id}/${a.uc === "direktor-onayla" ? "direktor-onayla" : "onayla"}`, firma ? { firma } : {}),
};

// Şirket sahibi / yönetici: kendi firma kapsamı (backend doğrular; maaş ayrı izin, yetkisizse yanıtta hiç yok)
export const yonetimApi = {
  ozet: () => api.get("/yonetim/ozet"),
  personel: ({ q = "", aktif = "", bolge = "", ekip = "", sayfa = 1 } = {}) =>
    api.get(`/yonetim/personel?q=${kodla(q)}&aktif=${kodla(aktif)}&bolge=${kodla(bolge)}&ekip=${kodla(ekip)}&sayfa=${sayfa}`),
  personelDetay: (id, donem) => api.get(`/yonetim/personel/${id}${donem ? `?donem=${kodla(donem)}` : ""}`),
};

// Dış taşeron firma paneli: yalnız bağlı taşeronun (taseron_id) verisi
export const taseronPanelApi = {
  profil: () => api.get("/taseron-panel/profil"),
  ozet: () => api.get("/taseron-panel/ozet"),
  isler: () => api.get("/taseron-panel/isler"),
  is: (id) => api.get(`/taseron-panel/isler/${id}`),
  belgeAdresi: (isId, b) => api.get(`/taseron-panel/isler/${isId}/belge?site=${kodla(b.site_code)}&alan=${kodla(b.alan)}&sira=${b.sira}&json=1`),
  belgeler: () => api.get("/taseron-panel/belgeler"),
  hakedis: () => api.get("/taseron-panel/hakedis"),
  // 05.11.2026: Hakediş ve Cari — yönetim cari motoruyla aynı hesap (firma oturumdan)
  cari: () => api.get("/taseron-panel/cari", { zamanAsimiMs: 60000 }),
  atananBedeller: (p = {}) => api.get(`/taseron-panel/atanan-bedeller?${new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString()}`, { zamanAsimiMs: 60000 }),
  cariBelge: (id) => api.get(`/taseron-panel/cari/odeme/${kodla(id)}/belge`),
  faturalar: () => api.get("/taseron-panel/faturalar"),
  fatura: (id) => api.get(`/taseron-panel/faturalar/${id}`),
  basla: (id) => api.post(`/is-atama/${id}/basla`, {}),
  bitir: (id, not) => api.post(`/is-atama/${id}/bitir`, { tamamlandi: true, not: not || null }),
};
// 04.11.2026: taşeron saha operasyonu — Sahalarım / Harita / iş detayı / Montaja Başla / Montajı Tamamla.
// Kapsam (firma + ekip) sunucuda; her yazma isteği istek_anahtari taşır (çift dokunuş / yeniden gönderim tek kayıt).
export const taseronSahaApi = {
  isler: () => api.get("/taseron-saha/isler", { zamanAsimiMs: 60000 }),
  gecmis: () => api.get("/taseron-saha/gecmis", { zamanAsimiMs: 60000 }),
  is: (kod) => api.get(`/taseron-saha/is/${kodla(kod)}`),
  basla: (kod, istekAnahtari) => api.post(`/taseron-saha/is/${kodla(kod)}/basla`, { onay_kod: kod, istek_anahtari: istekAnahtari }),
  tamamla: (kod, govde) => api.post(`/taseron-saha/is/${kodla(kod)}/tamamla`, govde),
  duzelt: (id, govde) => api.put(`/taseron-saha/bildirim/${id}`, govde),
  fotoYukle: (id, foto, istekAnahtari) => api.yukle(`/taseron-saha/bildirim/${id}/foto`, foto, { istek_anahtari: istekAnahtari, ad: foto.etiket }),
  fotoYolu: (id, fid) => `/taseron-saha/bildirim/${id}/foto/${fid}`,
};

// Clean Up (rollout): saha başına eksik kalemler, kalem başına önce/sonra fotoğrafı, onaya gönderme ve bölge onayı.
// Saha kodu boşluksuz büyük harf (backend aynı biçime çevirir). Onay yetkisi kayıt satırındaki onay_yetkim'den okunur.
const sahaKodu = (s) => encodeURIComponent(String(s || "").replace(/\s+/g, "").toUpperCase());
export const cleanupApi = {
  atananlarim: () => api.get("/rollout/cleanup/atananlarim"),
  saha: (site) => api.get(`/rollout/cleanup/site/${sahaKodu(site)}`),
  fotoYukle: (site, kalemId, tip, dosya) =>
    api.yukle(`/rollout/cleanup/${sahaKodu(site)}/foto?item_id=${encodeURIComponent(kalemId)}&tip=${tip}`, dosya),
  fotoSil: (site, kalemId, url) => api.sil(`/rollout/cleanup/${sahaKodu(site)}/foto`, { item_id: kalemId, url }),
  onayaGonder: (site) => api.post(`/rollout/cleanup/${sahaKodu(site)}/onaya-gonder`, {}),
  onayBekleyen: () => api.get("/rollout/cleanup/onay-bekleyen"),
  onayla: (site) => api.put(`/rollout/cleanup/${sahaKodu(site)}/onayla`, {}),
  reddet: (site, not) => api.put(`/rollout/cleanup/${sahaKodu(site)}/reddet`, { not }),
};
