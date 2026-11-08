# Ventory for Android

A thin WebView app around https://oscarvelz.github.io/Ventory/ (package `com.oscarvelz.ventory`, min Android 11).
Web releases arrive on their own (the page is loaded live; the service worker keeps it working offline).

- Bridge: `window.VentoryNative` (see `src/spa/native.ts`, feature-detected; the browser/PWA never see it):
  Back (`VentoryBack`: closes the open sheet, otherwise `atRoot` → "Press back again to close Ventory"), status and
  navigation bar colours from the theme, downloads (backup JSON) into Downloads/Ventory, BiometricPrompt, camera/photo
  picker for piece photos, update offer from GitHub releases `android-N` (asset `Ventory.apk`).
- Build: `.github/workflows/android.yml` on the `source` branch (only when `android/` changes). versionCode = run number.
- Signing (the fleet's gate, same as Faro/Brizna/Logos/Iris/Vela/Weekly): the key is private and never committed.
  `.github/workflows/android.yml` runs two jobs: `build` (no secrets; compiles and uploads the unsigned artifact
  `ventory-unsigned-N`) and `release` (needs build; runs inside the GitHub environment `release`, whose required
  reviewer is Oscarvelz and which admins cannot bypass). The environment holds `VENTORY_KS_B64` (base64 of the
  PKCS12 keystore) and `VENTORY_KS_PASS`; nothing is signed until Oscar approves the run ("Review deployments →
  Approve and deploy"). After approval the job signs with apksigner (alias `ventory`), verifies the certificate
  SHA-256 digest (must start bf73c465 and end c5f646; full: bf:73:c4:65:…:1a:c5:f6:46) before publishing release
  `android-N` with `Ventory.apk`, and deletes the keystore in an always() step. If the environment secrets were
  ever missing, the release job ends without publishing — the old private route (sign the artifact by hand and
  push it to the orphan branch `android-signed`) stands as a legacy fallback only. All updates must use the same
  key or Android refuses them.
- Download: https://github.com/Oscarvelz/Ventory/releases/latest/download/Ventory.apk
- Storage is separate from Chrome: sign in once (sync) or restore a backup.
