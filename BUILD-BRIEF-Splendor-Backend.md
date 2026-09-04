# Build Brief — Splendor Web Game (BACKEND)
Dokumen ini ditujukan untuk dieksekusi oleh coding agent (mis. Claude Code) khusus untuk bagian **backend**. Ikuti fase secara berurutan, jangan lompat fase sebelum fase sebelumnya lulus test.

## Tech Stack
- Node.js + Express + Socket.IO
- Tanpa database — state game in-memory per room
- Testing: Jest
- Tidak ada login/akun. Tidak ada mode vs AI/bot — hanya multiplayer manusia 2-4 pemain.
- Server bersifat **authoritative penuh** — client hanya mengirim intent aksi, server yang validasi & hitung state.

## Struktur Folder Target
```
/server
  /src
    /engine        <- pure functions, TIDAK boleh import socket.io
      cards.js
      nobles.js
      gameState.js
      actions.js   (takeThreeDifferentTokens, takeTwoSameTokens, reserveCard, buyCard, discardExcessTokens)
      rules.js     (checkNobleVisit, checkWinCondition, validateAction, advanceTurn)
    /rooms
      roomManager.js
    /socket
      handlers.js
    server.js
  /test
    engine.test.js
  package.json
```

## FASE 1 — Game Engine (pure logic, test dulu sebelum lanjut)
1. Definisikan data statis di `cards.js` (90 kartu: id, tier 1-3, cost per warna, bonus warna, poin) dan `nobles.js` (10 noble: requirement per warna, poin selalu 3). Gunakan data resmi Splendor sebagai referensi angka.
2. `gameState.js`: buat struktur `GameState`:
   - `players[]`: `{id, name, tokens:{}, cardsOwned:[], reservedCards:[], points}`
   - `bank`: token per warna (emerald, sapphire, ruby, diamond, onyx, gold) — jumlah awal sesuai jumlah pemain (2p=4/warna, 3p=5/warna, 4p=7/warna, gold selalu 5)
   - `tableCards`: `{tier1:[4 kartu], tier2:[4 kartu], tier3:[4 kartu]}`
   - `decks`: `{tier1:[sisa tertutup], tier2:[...], tier3:[...]}`
   - `nobles[]`
   - `currentPlayerIndex`, `turnCount`, `status` (`waiting`/`playing`/`finished`), `winnerId`
3. `actions.js` — tiap fungsi menerima `(gameState, payload)`, return `{success, gameState, error}`, **jangan mutate input langsung** (return objek baru/immutable):
   - `takeThreeDifferentTokens(gameState, {colors: [3 warna berbeda]})`
   - `takeTwoSameTokens(gameState, {color})` — hanya valid jika token warna itu tersisa >=4
   - `reserveCard(gameState, {cardId} atau {tier, fromDeck:true})` — maks 3 kartu reservasi per pemain, ambil 1 gold jika bank masih ada
   - `buyCard(gameState, {cardId, fromReserved:boolean})` — hitung cost dikurangi bonus warna dari kartu yang sudah dimiliki, gold sebagai wildcard
   - `discardExcessTokens(gameState, {tokensToDiscard:{}})` — wajib dipanggil jika token pemain >10 di akhir giliran
4. `rules.js`:
   - `validateAction(gameState, action)` — cek giliran benar & legalitas aksi sebelum eksekusi
   - `checkNobleVisit(gameState)` — jalankan otomatis setelah tiap aksi selesai
   - `checkWinCondition(gameState)` — set `status:'finished'` + `winnerId`; tie-break: poin tertinggi → kartu pengembangan paling sedikit
   - `advanceTurn(gameState)` — pindah `currentPlayerIndex`, increment `turnCount`
5. Tulis `engine.test.js` (Jest), cover minimal:
   - Ambil 3 token beda warna: sukses & gagal (warna sama / token habis)
   - Ambil 2 token sama warna: sukses & gagal (<4 token tersisa)
   - Reservasi: sukses, gagal saat sudah 3 kartu reservasi, gold habis
   - Beli kartu: sukses dengan bonus warna, gagal karena sumber daya kurang
   - Token >10 memicu discard wajib
   - Noble otomatis didapat saat syarat terpenuhi
   - Win condition & tie-break benar
6. **Jangan lanjut ke Fase 2 sebelum semua test di atas hijau.**

## FASE 2 — Room Manager & Socket Server
7. `roomManager.js`: in-memory `Map<roomId, {gameState, players:[{socketId, name, connected}]}>`. Generate `roomId` pakai `nanoid(6)` uppercase.
8. `handlers.js` — event yang harus diimplementasikan:
   - `create_room {name}` → buat room baru, join sebagai host, emit `room_created {roomId}`
   - `join_room {roomId, name}` → validasi room ada, belum penuh (maks 4), belum mulai; emit `room_joined` ke pengirim + `player_list_update` ke semua di room
   - `start_game {roomId}` → hanya host, minimal 2 pemain, inisialisasi `GameState` dari engine sesuai jumlah pemain, emit `game_started` + `state_update` ke semua
   - `player_action {roomId, action}` → jalankan `validateAction` + fungsi aksi terkait, jika sukses broadcast `state_update` ke semua, jika gagal emit `action_error` hanya ke pengirim
   - `disconnect` → tandai `connected:false`, broadcast `player_list_update`, jangan hapus room langsung (beri grace period agar bisa reconnect)
   - `rejoin_room {roomId, name}` → cocokkan by name, restore socketId, kirim `state_update` terakhir ke pengirim
9. Setup CORS di Express agar frontend (origin terpisah) bisa konek ke Socket.IO server.

## Definition of Done
- Fase 1: `npm test` lulus semua test.
- Fase 2: bisa dites manual pakai 2+ socket client (mis. script sederhana atau Postman Socket.IO) — create, join, start, action, broadcast, disconnect/rejoin semua berjalan sesuai spesifikasi event di atas.

## Batasan Eksplisit
- Tidak ada mode vs AI/bot.
- Tidak ada login/akun/database persisten.
- Tidak ada chat/fitur tambahan di luar yang disebutkan di sini tanpa konfirmasi.

## Kontrak API untuk Frontend
Backend harus mengekspos event Socket.IO persis seperti nama & payload di atas (`create_room`, `join_room`, `start_game`, `player_action`, `rejoin_room`, dan broadcast `room_created`, `room_joined`, `player_list_update`, `game_started`, `state_update`, `action_error`) — ini adalah kontrak yang dipakai oleh brief frontend terpisah, jangan ubah nama event tanpa update juga di sisi frontend.
