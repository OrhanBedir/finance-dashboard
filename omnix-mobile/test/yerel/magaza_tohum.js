// YALNIZ YEREL: App Store ekran görüntüleri için kurgusal "Demo Telekom" firması (gerçek kişi/firma verisi YOK).
// Yalnız 127.0.0.1 üzerindeki "omnix_test" veritabanına yazar. Çalıştırma: NODE_PATH=<backend>/node_modules node test/yerel/magaza_tohum.js
// Giriş adları simülatör klavyesine uygun (özel karakter yok): personel / patronx / taseron — şifre: aşağıdaki SIFRE.
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const SIFRE = "Omnx2026";

(async () => {
  const c = new Client({ host: "127.0.0.1", port: 55432, user: "postgres", database: "omnix_test" });
  if (c.host !== "127.0.0.1" || c.database !== "omnix_test") throw new Error("Yalnız yerel test veritabanı!");
  await c.connect();
  const q = (s, p) => c.query(s, p);
  const h = await bcrypt.hash(SIFRE, 8);
  const bugun = new Date();
  // Yerel takvim günü (toISOString UTC'ye çevirip bir gün geri kaydırıyordu)
  const gun = (g) => { const d = new Date(bugun.getFullYear(), bugun.getMonth(), g); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const ayStr = gun(1).slice(0, 7);

  await q(`INSERT INTO markalar (tenant, kod, ad, hw_yukleme, aktif) VALUES ('erc', 'DEMO', 'Demo Telekom', true, true)
    ON CONFLICT (kod) DO UPDATE SET ad = EXCLUDED.ad, hw_yukleme = true, aktif = true`);
  // Temizlik (yalnız demo kayıtları)
  await q(`DELETE FROM users WHERE email IN ('personel','patronx','taseron')`);
  await q(`DELETE FROM is_atama WHERE site_codes && ARRAY['DT1021','DT1034','DT1047']`);
  await q(`DELETE FROM rollout_cleanup WHERE site_code IN ('DT1034')`);
  await q(`DELETE FROM master_works WHERE site_code IN ('DT1021','DT1034','DT1047')`);
  await q(`DELETE FROM invoice_entries WHERE fatura_no LIKE 'KMT-%'`);
  await q(`DELETE FROM taseron_odeme_log WHERE firma = 'KUZEY MONTAJ'`);
  const eskiP = (await q(`SELECT id FROM personel WHERE UPPER(COALESCE(marka,''))='DEMO'`)).rows.map((r) => r.id);
  if (eskiP.length) {
    await q(`DELETE FROM is_avans_talep WHERE personel_id = ANY($1)`, [eskiP]);
    await q(`DELETE FROM masraf_kalem WHERE form_id IN (SELECT id FROM masraf_form WHERE personel_id = ANY($1))`, [eskiP]);
    await q(`DELETE FROM masraf_form WHERE personel_id = ANY($1)`, [eskiP]);
    await q(`DELETE FROM puantaj WHERE personel_id = ANY($1)`, [eskiP]);
    await q(`DELETE FROM personel WHERE id = ANY($1)`, [eskiP]);
  }

  // Kullanıcılar
  const kul = async (ad, e, rol, ek = {}) => (await q(`INSERT INTO users (name,email,password_hash,role,is_active,tenant,status,marka,subcon_name,kullanici_tipi,taseron_id,yonetim_profili)
    VALUES ($1,$2,$3,$4,true,'erc','active','DEMO',$5,$6,$7,$8) RETURNING id`, [ad, e, h, rol, ek.subcon || null, ek.tip || "IC", ek.tid || null, ek.profil || null])).rows[0].id;
  await q(`INSERT INTO subcons (subcon_name) VALUES ('KUZEY MONTAJ') ON CONFLICT (subcon_name) DO NOTHING`);
  const tid = (await q(`UPDATE subcons SET unvan='Kuzey Montaj Ltd. Şti.', ana_firma='DEMO', aktif=true WHERE subcon_name='KUZEY MONTAJ' RETURNING id`)).rows[0].id;
  const uPersonel = await kul("Emre Yıldız", "personel", "user", { profil: "PERSONEL" });
  await kul("Selin Aydın", "patronx", "user", { profil: "SAHIP" });
  await kul("Burak Kuzey", "taseron", "subcon", { tip: "TASERON", tid, subcon: "KUZEY MONTAJ" });

  // Personel (Demo Telekom)
  const per = async (ad, unvan, bolge, ekip, ek = {}) => (await q(`INSERT INTO personel (ad_soyad, email, unvan, bolge, ekip_bilgisi, aktif, marka, firma_tipi, net_maas, user_id, telefon)
    VALUES ($1,$2,$3,$4,$5,true,'DEMO','simsek',$6,$7,$8) RETURNING id`, [ad, ek.email || null, unvan, bolge, ekip, ek.maas || 38000, ek.user || null, ek.tel || null])).rows[0].id;
  const pEmre = await per("Emre Yıldız", "Saha Teknisyeni", "İzmir", "Ekip 2", { email: "personel", user: uPersonel, maas: 41000, tel: "0555 000 00 21" });
  const pDiger = [];
  for (const [ad, unvan, bolge, ekip] of [["Ayşe Demir", "Saha Mühendisi", "İzmir", "Ekip 1"], ["Mert Kaya", "Saha Teknisyeni", "Ankara", "Ekip 3"],
    ["Zeynep Arslan", "Proje Koordinatörü", "Ankara", "Merkez"], ["Can Öztürk", "Enerji Teknisyeni", "Bursa", "Ekip 4"]]) pDiger.push(await per(ad, unvan, bolge, ekip));

  // Emre: hesap (avans 3.000 ödendi, 1.850 masraf kapandı → +1.150), 750 onayda, taslak form 2 kalem
  await q(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje,odeme_tarihi,firma)
    VALUES ($1,'personel','Emre Yıldız',3000,'İzmir saha turu','TAMAMLANDI',$2,'Yakıt','İzmir','TC - Türkcell',$2,'DEMO'),
           ($1,'personel','Emre Yıldız',750,'Konaklama','TALEP',$3,'Konaklama','İzmir','TC - Türkcell',NULL,NULL)`, [pEmre, gun(3), gun(18)]);
  const fA = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum,arsiv_tarihi) VALUES ($1,'personel','Emre Yıldız',$2,7101,'ARSIVLENDI',$3) RETURNING id`, [pEmre, ayStr, gun(12)])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'YAKIT',$2,'35 DMO 21',1250,true),($1,'YEMEK',$2,'Ekip yemeği',600,true)`, [fA, gun(8)]);
  const fT = (await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum) VALUES ($1,'personel','Emre Yıldız',$2,7102,'TASLAK') RETURNING id`, [pEmre, ayStr])).rows[0].id;
  await q(`INSERT INTO masraf_kalem (form_id,kategori,tarih,aciklama,tutar,fis_var) VALUES ($1,'YAKIT',$2,'Site ID: DT1021 | 35 DMO 21',980,true),($1,'KONAKLAMA',$3,'Site ID: DT1034',1400,true)`, [fT, gun(20), gun(21)]);
  // Taslak formdaki kalemlere örnek fiş görseli (yerel depodaki sahte fiş, kırpılmış)
  const kalemler = (await q(`SELECT id, form_id FROM masraf_kalem WHERE form_id = $1 ORDER BY id`, [fT])).rows;
  const ornekFis = (await q(`SELECT dosya_yolu FROM masraf_belge WHERE dosya_yolu LIKE 'http://127.0.0.1:5098/%' ORDER BY id DESC LIMIT 1`)).rows[0]?.dosya_yolu;
  if (ornekFis) for (const k of kalemler) await q(`INSERT INTO masraf_belge (kalem_id, form_id, dosya_adi, dosya_yolu, kirpildi, kirpma_durum) VALUES ($1,$2,'fis.jpg',$3,true,'OTOMATIK')`, [k.id, k.form_id, ornekFis]);
  // Diğerleri için onayda avans + masraf (şirket sahibi özeti)
  await q(`INSERT INTO is_avans_talep (personel_id,talep_eden_email,talep_eden_ad,tutar,aciklama,durum,tarih,gider_turu,bolge,proje) VALUES ($1,'x','Mert Kaya',1200,'Ankara keşif','RM_ONAY',$2,'Yakıt','Ankara','TT - Türk Telekom')`, [pDiger[1], gun(19)]).catch(() => {});
  await q(`INSERT INTO masraf_form (personel_id,talep_eden_email,talep_eden_ad,donem,form_no,durum) VALUES ($1,'x','Ayşe Demir',$2,7103,'PM_BEKLE')`, [pDiger[0], ayStr]);
  // Puantaj (bu ay)
  for (const p of [pEmre, ...pDiger]) for (let g = 1; g <= Math.min(bugun.getDate(), 24); g++) {
    const d = new Date(bugun.getFullYear(), bugun.getMonth(), g).getDay();
    await q(`INSERT INTO puantaj (personel_id,tarih,durum,fazla_mesai_saat) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [p, gun(g), d === 0 ? "DINLENME" : "CALISDI", d === 6 ? 2 : 0]);
  }
  // Saha
  await q(`DELETE FROM rollout_progress WHERE site_code IN ('DT1021','DT1034','DT1047')`);
  await q(`INSERT INTO rollout_progress (project_code, site_code, site_type, bolge, qc_durum) VALUES ('TC','DT1021','Standalone','İzmir','OK'),
    ('TC','DT1034','Co-Located','İzmir','NOK'),('TC','DT1047','Standalone','Ankara','NOK')`);
  const emreK = JSON.stringify([{ email: "personel", ad: "Emre Yıldız" }]);
  await q(`INSERT INTO is_atama (kategori, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, atayan_not, durum, baslama_ts)
    VALUES ('NEW_SITE', ARRAY['DT1047'], 'Ankara', $1, $2, 'demo', 'Zeynep Arslan', 'Kule montajı; vinç sahada.', 'BASLADI', now()),
           ('SURVEY', ARRAY['DT1021'], 'İzmir', $1, $3, 'demo', 'Zeynep Arslan', NULL, 'ATANDI', NULL)`, [emreK, gun(24), gun(27)]);
  await q(`INSERT INTO rollout_cleanup (site_code, items, atanan_email, atanan_ad, onay_durum, visit_date) VALUES ('DT1034', $1, 'personel', 'Emre Yıldız', 'TASLAK', $2)`,
    [JSON.stringify([{ id: "k1", kalem: "Kablo etiketleri eksik" }, { id: "k2", kalem: "Kabin içi temizlik" }, { id: "k3", kalem: "Topraklama bağlantısı kontrolü" }]), gun(22)]);
  // Taşeron: 3 fiyatlı iş (biri tamamlanmış, QC OK), 2 fatura (biri kısmi ödenmiş)
  const fiyat = async (isId, kalemler) => {
    const toplam = kalemler.reduce((t, k) => t + k.miktar * k.birim_fiyat, 0);
    await q(`INSERT INTO is_atama_fiyat (is_atama_id, surum, taseron_id, kalemler, para_birimi, kdv_esasi, toplam, neden, olusturan) VALUES ($1,1,$2,$3,'TRY','HARIC',$4,'Atama','demo')`, [isId, tid, JSON.stringify(kalemler), toplam]);
  };
  const is1 = (await q(`INSERT INTO is_atama (kategori, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, durum, taseron_id, baslama_ts, bitis_ts)
    VALUES ('NEW_SITE', ARRAY['DT1021'], 'İzmir', '[]', $1, 'demo', 'Zeynep Arslan', 'TAMAMLANDI', $2, $3, $4) RETURNING id`, [gun(5), tid, gun(6), gun(11)])).rows[0].id;
  await fiyat(is1, [{ kalem_kodu: "NS-PKT", aciklama: "New Site montaj paketi", miktar: 1, birim: "Paket", birim_fiyat: 48000 }, { kalem_kodu: "GPS-01", aciklama: "GPS montajı", miktar: 1, birim: "Adet", birim_fiyat: 2500 }]);
  await q(`INSERT INTO master_works (project_code, site_code, item_code, item_description, done_qty, subcon_name, qc_durum) VALUES ('TC','DT1021','GPS-01','GPS montajı',1,'KUZEY MONTAJ','OK'),('TC','DT1021','NS-PKT','New Site montaj paketi',1,'KUZEY MONTAJ','OK')`);
  const is2 = (await q(`INSERT INTO is_atama (kategori, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, atayan_not, durum, taseron_id, baslama_ts)
    VALUES ('POWER', ARRAY['DT1034'], 'İzmir', '[]', $1, 'demo', 'Zeynep Arslan', 'Enerji panosu yeri sahibiyle konuşuldu.', 'BASLADI', $2, now()) RETURNING id`, [gun(23), tid])).rows[0].id;
  await fiyat(is2, [{ kalem_kodu: "ENH-01", aciklama: "Enerji hattı çekimi", miktar: 120, birim: "Metre", birim_fiyat: 185 }, { kalem_kodu: "PANO-01", aciklama: "Pano montajı", miktar: 1, birim: "Adet", birim_fiyat: 6500 }]);
  const is3 = (await q(`INSERT INTO is_atama (kategori, site_codes, bolge, personeller, plan_tarihi, atayan_email, atayan_ad, durum, taseron_id)
    VALUES ('SURVEY', ARRAY['DT1047'], 'Ankara', '[]', $1, 'demo', 'Zeynep Arslan', 'ATANDI', $2) RETURNING id`, [gun(28), tid])).rows[0].id;
  await fiyat(is3, [{ kalem_kodu: "SRV-01", aciklama: "Site survey", miktar: 1, birim: "Adet", birim_fiyat: 3200 }]);
  const f1 = (await q(`INSERT INTO invoice_entries (fatura_no, fatura_tarihi, tedarikci, toplam_tutar, odenen_tutar, kalan_borc, currency) VALUES ('KMT-2026-0412',$1,'KUZEY MONTAJ',60600,30000,30600,'TRY') RETURNING id`, [gun(14)])).rows[0].id;
  await q(`INSERT INTO invoice_entries (fatura_no, fatura_tarihi, tedarikci, toplam_tutar, odenen_tutar, kalan_borc, currency) VALUES ('KMT-2026-0388',$1,'KUZEY MONTAJ',18000,18000,0,'TRY')`, [gun(2)]);
  await q(`INSERT INTO fatura_saha_kalem (fatura_id, site_code, kalem_adi, miktar, birim, tutar) VALUES ($1,'DT1021','New Site montaj paketi',1,'Paket',48000),($1,'DT1021','GPS montajı',1,'Adet',2500)`, [f1]);
  await q(`INSERT INTO taseron_odeme_log (firma, tutar, tarih, dagilim) VALUES ('KUZEY MONTAJ', 30000, $1, $2)`, [gun(20), JSON.stringify([{ fatura_no: "KMT-2026-0412", tutar: 30000 }])]);
  console.log("mağaza demo verisi hazır");
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
