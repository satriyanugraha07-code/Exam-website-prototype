# Buat Web Ujian Gratis

Web ujian online berbasis Node.js. Admin bisa membuat link ujian, membuka ujian dengan tombol start, memantau submit siswa, dan mengunduh rekap nilai Excel.

## Jalan Lokal

```bash
npm install
npm start
```

Buka:

- Siswa: `http://127.0.0.1:8002`
- Admin: `http://127.0.0.1:8002/admin.html`

Jika `DATABASE_URL` kosong, data disimpan di `data/exam-state.json` untuk pemakaian lokal.

## Deploy Gratis

Jalur gratis yang disarankan:

- GitHub untuk menyimpan kode.
- Supabase Free untuk database.
- Vercel Hobby untuk menjalankan web dan API.

GitHub Pages saja tidak cukup karena aplikasi ini butuh backend `server.js`.

## Buat Database Supabase

1. Daftar atau login ke Supabase.
2. Buat project baru dengan paket Free.
3. Buka menu project database connection.
4. Salin connection string Postgres.
5. Simpan password database karena nanti dipakai di Render.

Server akan membuat tabel otomatis saat pertama kali jalan. Kalau mau membuat manual, jalankan isi file `supabase-schema.sql` di SQL Editor Supabase.

## Deploy ke Vercel

1. Push repo ini ke GitHub.
2. Login ke Vercel memakai GitHub.
3. Pilih `Add New` lalu `Project`.
4. Import repository GitHub ini.
5. Pilih preset `Other`. Jika Vercel menebak `Node`, tidak apa-apa karena `vercel.json` akan memaksa preset `Other`.
6. Biarkan pengaturan build default, atau kosongkan `Build Command` jika diminta.
7. Tambahkan environment variable sebelum deploy:
   - `DATABASE_URL`: connection string Supabase
   - `PGSSLMODE`: `require`
8. Klik `Deploy`.

Setelah deploy selesai:

- Admin: `https://nama-app.vercel.app/admin.html`
- Siswa: pakai link ujian yang dibuat dari halaman admin.

## Catatan Penting

Jangan upload `.env` atau `data/exam-state.json` ke GitHub karena bisa berisi data ujian dan jawaban siswa.

## Alternatif Render

Kalau Render tidak meminta kartu, repo ini juga tetap bisa jalan di Render:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `DATABASE_URL` dan `PGSSLMODE=require`
