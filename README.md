# Ventory

The floor book for boots, watches, and everything else you sell: where each piece came from, its size, cost, asking and sale price, who bought it, and how long it sat with you.

- Web: https://oscarvelz.github.io/Ventory/ (installable; works offline after the first open)
- Android: https://github.com/Oscarvelz/Ventory/releases/latest/download/Ventory.apk (Android 11+)

Sign in with email. The same account keeps the floor online and a copy on each device. With no internet, changes stay on the device and sync when the connection returns. Each piece, ad and setting syncs on its own, so two devices merge (the newest edit of a piece wins).

## Bringing data from the Grok version
In the old app: Settings › Backup › Export (a `ventory-backup-YYYY-MM-DD.json` file). In this app: Settings › Backup › Restore and pick that file. The floor as it was is saved first as a backup ("Before restore …"). Exports from this app also carry Facebook ads and subcategory photos.

## Layout
- `main`: the built site for GitHub Pages (`./build.sh` → `dist/`).
- `source`: this code. `spa/` + `src/spa/` replace the Grok server functions and auth with the browser floor (`store.ts`, IndexedDB) and Supabase (`api.ts`, `cloud.ts`); the UI in `src/components/ventory/` is the Grok app's own.
- `android/`: Ventory for Android (WebView app, see `android/README.md`). `android-signed`: orphan branch with the privately signed APK that publishes releases `android-N`.
- `supabase/ventory.sql`: tables `ventory_records` and `ventory_checkpoints` (row-level security: each user sees only their own rows) and the `ventory_put` function, in the shared Supabase project.
- `migrations/`: the Grok version's Postgres schema, kept for reference.

## Build
```
npm install
./build.sh          # dist/ with sw.js, precache.json, .nojekyll
npm run typecheck
```
Bump `VERSION` in `public/sw.js` and `APP_VERSION` in `src/spa/config.ts` on every web release.
