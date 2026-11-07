# Ventory for Android

A thin WebView app around https://oscarvelz.github.io/Ventory/ (package `com.oscarvelz.ventory`, min Android 11).
Web releases arrive on their own (the page is loaded live; the service worker keeps it working offline).

- Bridge: `window.VentoryNative` (see `src/spa/native.ts`, feature-detected; the browser/PWA never see it):
  Back (`VentoryBack`: closes the open sheet, otherwise `atRoot` → "Press back again to close Ventory"), status and
  navigation bar colours from the theme, downloads (backup JSON) into Downloads/Ventory, BiometricPrompt, camera/photo
  picker for piece photos, update offer from GitHub releases `android-N` (asset `Ventory.apk`).
- Build: `.github/workflows/android.yml` on the `source` branch (only when `android/` changes). versionCode = run number.
- Signing: the key is private and never committed. If the `release` environment holds `VENTORY_KS_B64` + `VENTORY_KS_PASS`,
  CI signs and publishes. Otherwise CI uploads `ventory-unsigned-N`; it is signed privately (apksigner, alias `ventory`)
  and pushed to the orphan branch `android-signed` (`Ventory.apk`, `VERSION`=N, `NOTES.md`), whose workflow publishes
  release `android-N`. All updates must use the same key (certificate SHA-256 bf:73:c4:65:…:1a:c5:f6:46).
- Download: https://github.com/Oscarvelz/Ventory/releases/latest/download/Ventory.apk
- Storage is separate from Chrome: sign in once (sync) or restore a backup.
