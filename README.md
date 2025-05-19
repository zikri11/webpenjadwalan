# Aplikasi Penjadwalan Kuliah

Aplikasi web sederhana untuk mengelola jadwal mata kuliah dengan fitur:
- Penambahan jadwal baru (hari, mata kuliah, jam mulai, jam selesai, ruangan)
- Melihat semua jadwal dalam bentuk tabel
- Mengedit jadwal yang sudah ada
- Menghapus jadwal

## Persyaratan

- Node.js (v14+)
- MySQL

## Installasi

1. Clone repository ini
2. Install dependensi:
   ```
   npm install
   ```
3. Buat database MySQL bernama `jadwal_kuliah`
4. Sesuaikan konfigurasi database di file `.env` jika diperlukan:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=password_anda
   DB_NAME=jadwal_kuliah
   PORT=3000
   ```

## Menjalankan Aplikasi

```
npm start
```

Untuk pengembangan:
```
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000`

## Struktur Proyek

- `src/app.js` - File utama aplikasi
- `src/views/` - Template EJS
- `src/public/` - File statis (CSS, JS)
- `src/public/css/style.css` - Stylesheet utama
- `src/public/js/script.js` - JavaScript untuk fungsionalitas sisi klien

## Fitur

1. **Tambah Jadwal**
   - Isi formulir dengan detail jadwal (hari, mata kuliah, jam mulai, jam selesai, ruangan)
   - Klik tombol "Simpan"

2. **Lihat Jadwal**
   - Semua jadwal ditampilkan dalam tabel di halaman utama

3. **Edit Jadwal**
   - Klik tombol "Edit" pada jadwal yang ingin diubah
   - Ubah detail yang diperlukan
   - Klik tombol "Update"

4. **Hapus Jadwal**
   - Klik tombol "Hapus" pada jadwal yang ingin dihapus
   - Konfirmasi penghapusan 