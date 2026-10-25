#!/bin/zsh
# Omnix mobil — YEREL TEST SUNUCUSU (canlı veritabanına / depoya BAĞLANMAZ).
# 1) Geçici PostgreSQL kümesi (127.0.0.1:55432, "omnix_test")  2) backend'in anlık kopyası (repo dosyalarına dokunulmaz)
# 3) Supabase yerine yerel klasör  4) sahte veri (tohum.js)  5) backend :5099, fiş görselleri :5098
# Kullanım: test/yerel/kur_ve_baslat.sh <çalışma-klasörü>   (ör. /tmp/omnix-yerel)
set -e
CALISMA=${1:?çalışma klasörü verin}
BURASI=${0:A:h}
BACKEND=${BURASI:h:h:h}/backend
mkdir -p $CALISMA && cd $CALISMA
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
if [ ! -d pgdata ]; then
  initdb -D pgdata -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
  printf "port = 55432\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\n" >> pgdata/postgresql.conf
fi
pg_ctl -D pgdata -l pg.log -w status >/dev/null 2>&1 || pg_ctl -D pgdata -l pg.log -w start
psql -h 127.0.0.1 -p 55432 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='omnix_test'" | grep -q 1 || psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE omnix_test"
psql -h 127.0.0.1 -p 55432 -U postgres -d omnix_test -q -f $BURASI/temel_sema.sql
rm -rf backend_kopya && mkdir backend_kopya
(cd $BACKEND && tar --exclude='./node_modules' --exclude='./node_modules 2' --exclude='./uploads' -cf - .) | (cd backend_kopya && tar -xf -)
ln -s $BACKEND/node_modules backend_kopya/node_modules
cp $BURASI/supabase-storage.yerel.js backend_kopya/supabase-storage.js
mkdir -p depo
export OMNIX_YEREL_DEPO=$CALISMA/depo
node $BURASI/depo_sunucu.js > depo.log 2>&1 &
# Temiz ortam: kabuktaki olası canlı DATABASE_URL / SUPABASE / API anahtarları aktarılmaz
api_baslat() {
  env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 OMNIX_YEREL_DEPO=$OMNIX_YEREL_DEPO \
    JWT_SECRET=yerel-test-anahtari PORT=5099 DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_NAME=omnix_test \
    SUPABASE_URL=http://127.0.0.1:9 FIS_TEMIZLIK_ILK_MS=999999999 node backend_kopya/server.js >> api.log 2>&1 &
  API_PID=$!
  for i in {1..30}; do curl -s -m 2 http://127.0.0.1:5099/health >/dev/null && break; sleep 1; done
  sleep 6   # açılış tabloları
}
# Backend tablolarını açılışta sırayla oluşturur; boş veritabanında bazıları ikinci açılışta tamamlanır
api_baslat; kill $API_PID; sleep 1
api_baslat
psql -h 127.0.0.1 -p 55432 -U postgres -d omnix_test -q -c "ALTER TABLE personel ADD COLUMN IF NOT EXISTS marka TEXT DEFAULT 'ERC'" \
  -c "CREATE TABLE IF NOT EXISTS rollout_progress (id SERIAL PRIMARY KEY, project_code TEXT, site_code TEXT, site_type TEXT, bolge TEXT, il TEXT, tssr_belge_url TEXT, ysb_belge_url TEXT, btk_belge_url TEXT, los_belge_url TEXT, emr_belge_url TEXT, enh_proje_belge_url TEXT, pac_belge_url TEXT, kabul_dosya_url TEXT, hasarsizlik_belge_url TEXT, memnuniyet_belge_url TEXT, fsc_belge_url TEXT, enh_perakende_sozlesme_url TEXT, enh_perakende_dekont_url TEXT, installation_actual_start_date DATE, installation_actual_end_date DATE, qc_durum TEXT, qc_closed_date DATE, general_note TEXT, survey_note TEXT, updated_at TIMESTAMP DEFAULT now())" \
  -c "CREATE TABLE IF NOT EXISTS rollout_cleanup (id SERIAL PRIMARY KEY, site_code TEXT UNIQUE, visit_date DATE, notification_date DATE, completion_date DATE, items JSONB DEFAULT '[]', notlar TEXT, screenshot_url TEXT, onay_durum TEXT DEFAULT 'TASLAK', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())" \
  -c "CREATE TABLE IF NOT EXISTS rollout_is_kolu (id SERIAL PRIMARY KEY)"
NODE_PATH=$BACKEND/node_modules node $BURASI/tohum.js
echo "Hazır: API http://127.0.0.1:5099  (loglar: $CALISMA/api.log)"
