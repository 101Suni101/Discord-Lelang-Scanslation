# Discord-Lelang-Scanslation
Advanced Discord Task Management Bot built with Discord.js v14 &amp; Google Sheets. Features individual timers, point system, anti-greed logic, and separate logging channels
  # 🤖 Discord Task & Reward Bot (Google Sheets Integration)

Bot Discord kustom yang dirancang untuk mengelola tugas komunitas, sistem poin, dan leaderboard secara real-time menggunakan **Google Sheets** sebagai database utama.

Bot ini memungkinkan admin membuat tugas, member mengambil tugas, dan mendapatkan poin secara otomatis. Dilengkapi dengan fitur leaderboard visual (gambar) yang digenerate menggunakan Canvas.

## ✨ Fitur Utama

* **Google Sheets Database**: Semua data (User, Poin, Tugas, Setting) tersimpan rapi di Google Sheets, mudah dipantau dan diedit manual jika perlu.
* **Sistem Manajemen Tugas**:
    * Admin membuat tugas dengan form interaktif (`/task`).
    * Sistem "Siapa Cepat Dia Dapat" atau alokasi slot per tugas.
    * Timer & Deadline otomatis per user.
* **Sistem Poin & Reward**: Otomatis menambah poin saat tugas selesai.
* **Visual Leaderboard**: Command `/leaderboard` menghasilkan gambar kartu peringkat (Canvas) yang keren, bukan sekadar teks.
* **Auto Reminder**: Notifikasi otomatis ke channel khusus saat deadline tugas tinggal 15, 10, atau 5 menit.
* **Admin Tools**: Fitur `/stop`, `/reset`, dan `/cancel` untuk manajemen penuh.

## 🛠️ Teknologi yang Digunakan

* [Node.js](https://nodejs.org/)
* [Discord.js v14](https://discord.js.org/)
* [Google Spreadsheet API](https://theoephraim.github.io/node-google-spreadsheet/)
* [Canvas / @napi-rs/canvas](https://www.npmjs.com/package/canvas) (Untuk generate gambar)

## 🚀 Cara Install & Menjalankan

1.  **Clone repository ini**
    ```bash
    git clone [https://github.com/username-kamu/nama-repo.git](https://github.com/username-kamu/nama-repo.git)
    cd nama-repo
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```
    *Catatan: Pastikan `canvas` atau `@napi-rs/canvas` terinstall dengan benar.*

3.  **Konfigurasi**
    * Siapkan file `google-credentials.json` (Service Account dari Google Cloud Console) dan letakkan di root folder.
    * Edit bagian `CONFIG` di file utama atau gunakan `.env` untuk menyimpan Token Discord dan ID Spreadsheet.

4.  **Jalankan Bot**
    ```bash
    node app.js
    ```

## 📝 Daftar Command (Slash Commands)

### User Commands
* `/point` - Cek poin pribadi.
* `/list` - Melihat daftar tugas yang sedang aktif.
* `/leaderboard` - Menampilkan Top 10 klasemen dengan gambar.
* `/cancel` - Membatalkan tugas yang sedang diambil.

### Admin Commands
* `/task` - Membuka form pembuatan tugas baru.
* `/stop` - Menghentikan tugas secara paksa.
* `/refresh` - Sinkronisasi manual bot dengan Google Sheets.
* `/reset` - Menghapus semua poin (Reset Season).
* `/setlog` - Mengatur channel untuk log aktivitas bot.
* `/setreminder` - Mengatur channel untuk notifikasi deadline.

## 📸 Preview

https://media.discordapp.net/attachments/1228143822509178929/1450662832050929816/leaderboard.png?ex=69435a8b&is=6942090b&hm=31987a111cb150165454cf230bb6f615cf1d6fd0932bcf82a638ba8057d2b18b&=&format=webp&quality=lossless&width=997&height=1139
---
Dibuat dengan ❤️ oleh Suni
