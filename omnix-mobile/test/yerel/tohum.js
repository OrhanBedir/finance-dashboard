// YALNIZ YEREL TEST VERİSİ — sahte kişiler ve tutarlar. Canlı veritabanında ÇALIŞTIRILMAZ:
// yalnız 127.0.0.1 üzerindeki "omnix_test" veritabanına bağlanır, başka adreste kendini durdurur.
// Çalıştırma: NODE_PATH=<backend>/node_modules node test/yerel/tohum.js
// Test hesapları (hepsinin şifresi aşağıdaki TEST_SIFRE):
//   saha.user@simsektel.com   — Şimşek (ERC) sahası, personel; hesabı ALACAKLI (negatif bakiye)
//   tekno.saha@teknocenter.test — Teknocenter sahası; üzerinde iş avansı var (pozitif bakiye), taslak masraf formu
//   orhan.bedir@simsektel.com — onaycı (PM); Onaylar sekmesi görünür
//   pasif@simsektel.com       — pasif hesap (giriş reddi testi)
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const HOST = "127.0.0.1", PORT = 55432, DB = "omnix_test";
const TEST_SIFRE = "Omnix-Test-2026";

(async () => {
  const c = new Client({ host: HOST, port: PORT, user: "postgres", database: DB });
  if (c.host !== HOST || c.port !== PORT || c.database !== DB) throw new Error("Yalnız yerel test veritabanı!");
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const h = await bcrypt.hash(TEST_SIFRE, 8);
  await q(`TRUNCATE users, personel, is_avans_talep, masraf_form, masraf_kalem, masraf_belge, puantaj, personel_odeme, malzeme_talepler, malzeme_talep_kalemleri, malzeme_dagitim RESTART IDENTITY CASCADE`);
  const kul = [
    ["Ahmet Yılmaz", "saha.user@simsektel.com", "user", "ERC", true],
    ["Mehmet Kaya", "tekno.saha@teknocenter.test", "user", "TEKNO", true],
    ["Orhan Bedir", "orhan.bedir@simsektel.com", "admin", "ERC", true],
    ["Pasif Kişi", "pasif@simsektel.com", "user", "ERC", false],
  ];
  for (const [ad, e, rol, marka, aktif] of kul) {
    await q(`INSERT INTO users (name,email,password_hash,role,is_active,tenant,status,marka) VALUES ($1,$2,$3,$4,$5,'erc','active',$6)`, [ad, e, h, rol, aktif, marka]);
  }
  const per = async (ad, e, unvan, bolge, marka) => (await q(`INSERT INTO personel (ad_soyad,email,unvan,bolge,aktif,marka,firma_tipi) VALUES ($1,$2,$3,$4,true,$5,'simsek') RETURNING id`, [ad, e, unvan, bolge, marka])).rows[0].id;
  const pAhmet = await per("Ahmet Yılmaz", "saha.user@simsektel.com", "Saha Teknisyeni", "Bursa", "ERC");
  const pMehmet = await per("Mehmet Kaya", "tekno.saha@teknocenter.test", "Saha Mühendisi", "İzmir", "TEKNO");
  await per("Orhan Bedir", "orhan.bedir@simsektel.com", "Proje Müdürü", "Bursa", "ERC");

  const bugun = new Date(); const ay = (g) => `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  // Puantaj (bu ay)
  for (let g = 1; g <= Math.min(bugun.getDate(), 20); g++) {
    const d = g % 7 === 0 ? "DINLENME" : g === 9 ? "GELMEDI" : "CALISDI";
    await q(`INSERT INTO puantaj (personel_id,tarih,durum) VALUES ($1,$2,$3)`, [pAhmet, ay(g), d]);
  }
  // Ahmet: 2.000 avans ödendi, 4.250 masraf arşivlendi → bakiye −2.250 (şirketten alacaklı); 1.500 avans onayda; bir form PM onayında
  await q(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje,odeme_tarihi,firma)
           VALUES ($1,'saha.user@simsektel.com','Ahmet Yılmaz',2000,'Bursa saha turu','TAMAMLANDI',$2,'Yol','Bursa','TC - Türkcell',$2,'ERC')`, [pAhmet, ay(2)]);
  await q(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje)
           VALUES ($1,'saha.user@simsektel.com','Ahmet Yılmaz',1500,'Yalova keşif','TALEP',$2,'Yakıt','Yalova','TT - Türk Telekom')`, [pAhmet, ay(5)]);
  const f1 = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum,arsiv_tarihi) VALUES ($1,'saha.user@simsektel.com','Ahmet Yılmaz',$2,101,'ARSIVLENDI',$3) RETURNING id`, [pAhmet, ay(1).slice(0, 7), ay(4)])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'KONAKLAMA',$2,'2 gece Bursa',2750,true),($1,'YAKIT',$2,'16 ABC 123',1500,true)`, [f1, ay(3)]);
  const f2 = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum) VALUES ($1,'saha.user@simsektel.com','Ahmet Yılmaz',$2,102,'PM_BEKLE') RETURNING id`, [pAhmet, ay(1).slice(0, 7)])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'YEMEK',$2,'Ekip yemeği',640,true)`, [f2, ay(6)]);

  // Mehmet (Teknocenter): 5.000 avans ödendi, 1.200 masraf arşivlendi → +3.800 üzerinde; açık taslak form
  await q(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje,odeme_tarihi,firma)
           VALUES ($1,'tekno.saha@teknocenter.test','Mehmet Kaya',5000,'İzmir montaj','TAMAMLANDI',$2,'Konaklama','İzmir','TC - Türkcell',$2,'TEKNO')`, [pMehmet, ay(1)]);
  const f3 = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum,arsiv_tarihi) VALUES ($1,'tekno.saha@teknocenter.test','Mehmet Kaya',$2,103,'ARSIVLENDI',$3) RETURNING id`, [pMehmet, ay(1).slice(0, 7), ay(3)])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'KONAKLAMA',$2,'Otel',1200,true)`, [f3, ay(2)]);
  const f4 = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum) VALUES ($1,'tekno.saha@teknocenter.test','Mehmet Kaya',$2,104,'TASLAK') RETURNING id`, [pMehmet, ay(1).slice(0, 7)])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'YEMEK',$2,'Öğle yemeği',320,true)`, [f4, ay(7)]);

  // Malzeme: Ahmet'in bir talebi ve üzerinde zimmetli kablo
  const mt = (await q(`INSERT INTO malzeme_talepler (talep_no,talep_eden_email,talep_eden_ad,durum,notlar,bolge,proje,site_id,talep_tarihi) VALUES ('MT-2026-901','saha.user@simsektel.com','Ahmet Yılmaz','ROLLOUT_BEKLE','Acil','Bursa','TC','BU1234',$1) RETURNING id`, [ay(8)])).rows[0].id;
  await q(`INSERT INTO malzeme_talep_kalemleri (talep_id,malzeme_adi,miktar,birim) VALUES ($1,'6 mm² topraklama kablosu',50,'Metre'),($1,'Kablo bağı',2,'Paket')`, [mt]);
  await q(`INSERT INTO malzeme_dagitim (talep_id,malzeme_adi,miktar,birim,alici_tipi,alici_personel_id,alici_personel_ad,alici_personel_email,site_id,verilme_tarihi,durum)
           VALUES ($1,'RF jumper 1/2"',4,'Adet','PERSONEL',$2,'Ahmet Yılmaz','saha.user@simsektel.com','BU1234',$3,'PERSONELDE')`, [mt, pAhmet, ay(9)]);
  // Mehmet'e başka firmanın (Ahmet'in) verisi görünmemeli: test bunu kontrol eder
  console.log("tohum tamam");
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
