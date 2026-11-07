package com.oscarvelz.ventory

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageInstaller
import android.graphics.Color
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Message
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Ventory for Android: a thin shell around the Ventory web app, loaded live from GitHub Pages so every web release
 * arrives on its own (the service worker keeps it working offline after the first open). The app's WebView storage is
 * its own, separate from Chrome's: the floor comes back by signing in (Supabase sync) or restoring a backup.
 *
 * The page talks to the app through window.VentoryNative (src/spa/native.ts in the web source, feature-detected there):
 * Back (VentoryBack / atRoot), bar colours, downloads into Downloads/Ventory and the phone's BiometricPrompt.
 * Nothing in the web app changes when VentoryNative is absent.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var frame: FrameLayout
    private lateinit var statusBg: View
    private val home = "https://oscarvelz.github.io/Ventory/"
    private val prefs by lazy { getSharedPreferences("ventory-shell", MODE_PRIVATE) }
    private var topColor = Color.parseColor("#121410")
    private var bottomColor = Color.parseColor("#121410")
    private var topDark = true
    private var bottomDark = true
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var camUri: Uri? = null
    @Volatile private var trusted = false
    @Volatile private var pageReady = false
    private var lastBack = 0L
    private val saves = ConcurrentHashMap<String, Save>()

    private class Save(val uri: Uri, val out: OutputStream, val name: String)

    companion object {
        private const val RQ_FILES = 7
        private const val RQ_CAMERA = 8
        private const val AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        private const val REPO_RELEASES = "https://api.github.com/repos/Oscarvelz/Ventory/releases?per_page=30"
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        topColor = prefs.getInt("top", topColor); bottomColor = prefs.getInt("bottom", bottomColor)
        topDark = prefs.getBoolean("topDark", true); bottomDark = prefs.getBoolean("bottomDark", true)
        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        window.isNavigationBarContrastEnforced = false
        window.isStatusBarContrastEnforced = false

        root = FrameLayout(this)
        frame = FrameLayout(this)
        web = WebView(this)
        statusBg = View(this)
        frame.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(frame, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(statusBg, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP))
        // The page sits between the system bars like the installed PWA (no content under them); the status bar shows the
        // colour at the top of the page, the navigation bar the colour at its bottom (both sent by the page).
        root.setOnApplyWindowInsetsListener { _, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = insets.getInsets(WindowInsets.Type.ime())
            frame.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            statusBg.layoutParams = (statusBg.layoutParams as FrameLayout.LayoutParams).apply { height = bars.top }
            WindowInsets.CONSUMED
        }
        setContentView(root)
        applyBars()

        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false; allowContentAccess = true
            setSupportMultipleWindows(true); javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString VentoryAndroid/${BuildConfig.VERSION_NAME}"
        }
        ServiceWorkerController.getInstance().serviceWorkerWebSettings.apply {
            cacheMode = WebSettings.LOAD_DEFAULT; allowContentAccess = true; allowFileAccess = false
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "VentoryNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (isVentory(r.url)) return false
                openOutside(r.url); return true
            }
            override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                trusted = url != null && isVentory(Uri.parse(url)); pageReady = false
            }
            override fun onPageFinished(v: WebView, url: String?) {
                trusted = url != null && isVentory(Uri.parse(url)); pageReady = trusted
            }
            override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                if (!r.isForMainFrame) return
                val bg = String.format("#%06X", 0xFFFFFF and topColor)
                v.loadDataWithBaseURL(home, "<html><head><meta name=viewport content='width=device-width'></head>" +
                    "<body style=\"background:$bg;color:#F3F0E8;font:18px sans-serif;padding:32px;line-height:1.5\">" +
                    "<p>Ventory needs the internet the first time it opens; after that it works offline.</p>" +
                    "<p><a style=\"color:#6F947C\" href=\"$home\">Try again</a></p></body></html>", "text/html", "utf-8", null)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return try { pickFiles(p); true } catch (e: Exception) { fileCb = null; false }
            }
            // target=_blank / window.open: Ventory pages stay here, everything else opens in the browser or its own app.
            override fun onCreateWindow(v: WebView, dialog: Boolean, gesture: Boolean, msg: Message): Boolean {
                val probe = WebView(this@MainActivity)
                var done = false
                fun take(pv: WebView, u: Uri?): Boolean {
                    if (u == null || u.scheme == "about" || done) return true
                    done = true
                    if (isVentory(u)) web.loadUrl(u.toString()) else openOutside(u)
                    pv.post { pv.stopLoading(); pv.destroy() }
                    return true
                }
                probe.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(pv: WebView, r: WebResourceRequest): Boolean = take(pv, r.url)
                    override fun onPageStarted(pv: WebView, url: String?, favicon: android.graphics.Bitmap?) { take(pv, url?.let { Uri.parse(it) }) }
                }
                (msg.obj as WebView.WebViewTransport).webView = probe
                msg.sendToTarget()
                return true
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            // blob:/data: downloads are taken by the page (native.ts) and saved into Downloads/Ventory; real links open outside.
            if (url.startsWith("http")) openOutside(Uri.parse(url))
        }
        if (state != null) web.restoreState(state) else web.loadUrl(home)
        checkUpdate()
    }

    private fun isVentory(u: Uri): Boolean {
        val s = u.scheme ?: return false
        if (s == "blob" || s == "data" || s == "about") return true
        return s == "https" && u.host == "oscarvelz.github.io" && ((u.path ?: "") == "/Ventory" || (u.path ?: "").startsWith("/Ventory/"))
    }

    private fun openOutside(u: Uri) {
        try {
            val i = if (u.scheme == "intent") Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).apply { selector = null; component = null }
                    else Intent(Intent.ACTION_VIEW, u)
            startActivity(i.addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: Exception) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun dispatch(js: String) = runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(js, null) }

    private fun applyBars() {
        statusBg.setBackgroundColor(topColor)
        root.setBackgroundColor(bottomColor)
        web.setBackgroundColor(topColor)
        window.decorView.setBackgroundColor(bottomColor)
        val ls = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
        val ln = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance((if (topDark) 0 else ls) or (if (bottomDark) 0 else ln), ls or ln)
    }

    private fun parseColor(s: String): Int? = runCatching {
        val t = s.trim()
        when {
            t.startsWith("#") -> Color.parseColor(t)
            t.startsWith("rgb") -> { val n = Regex("[\\d.]+").findAll(t).map { it.value.toFloat() }.toList(); Color.rgb(n[0].toInt(), n[1].toInt(), n[2].toInt()) }
            else -> null
        }
    }.getOrNull()

    /* ---------- files: camera, pictures, any file ---------- */

    private fun pickFiles(p: WebChromeClient.FileChooserParams) {
        val accept = p.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val imagesOnly = accept.isNotEmpty() && accept.all { it.startsWith("image/") || it in setOf(".jpg", ".jpeg", ".png", ".webp", ".heic") }
        val multiple = p.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        if (p.isCaptureEnabled && imagesOnly) {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000L) it.delete() }
            val f = File(dir, "Ventory-${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "com.oscarvelz.ventory.files", f)
            camUri = uri
            val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivityForResult(cam, RQ_CAMERA)
            return
        }
        val intent = if (imagesOnly && Build.VERSION.SDK_INT >= 33) {
            // The phone's photo picker (Screenshots album included), one or several pictures.
            Intent(MediaStore.ACTION_PICK_IMAGES).apply { if (multiple) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, minOf(12, MediaStore.getPickImagesMaxLimit())) }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).apply {
                // Exact MIME filters hide .json/.vcf/.csv files that phones label oddly, so only pictures are filtered.
                type = if (imagesOnly) "image/*" else "*/*"
                if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }
        try { startActivityForResult(intent, RQ_FILES) }
        catch (e: ActivityNotFoundException) {
            startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(if (imagesOnly) "image/*" else "*/*")
                .apply { if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true) }, RQ_FILES)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(rq: Int, rc: Int, d: Intent?) {
        when (rq) {
            RQ_CAMERA -> {
                val u = camUri; camUri = null
                val ok = rc == RESULT_OK && u != null && runCatching { contentResolver.openFileDescriptor(u, "r")?.use { it.statSize > 0 } ?: false }.getOrDefault(false)
                fileCb?.onReceiveValue(if (ok) arrayOf(u!!) else null); fileCb = null
            }
            RQ_FILES -> {
                val cd = d?.clipData
                val res: Array<Uri>? = if (rc != RESULT_OK) null
                    else if (cd != null && cd.itemCount > 0) Array(cd.itemCount) { cd.getItemAt(it).uri }
                    else d?.data?.let { arrayOf(it) }
                fileCb?.onReceiveValue(res); fileCb = null
            }
            else -> super.onActivityResult(rq, rc, d)
        }
    }

    /* ---------- the bridge ---------- */

    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface fun setBars(top: String, bottom: String, darkTop: Boolean, darkBottom: Boolean) {
            if (!trusted) return
            val t = parseColor(top) ?: return
            val b = parseColor(bottom) ?: t
            runOnUiThread {
                topColor = t; bottomColor = b; topDark = darkTop; bottomDark = darkBottom
                prefs.edit().putInt("top", t).putInt("bottom", b).putBoolean("topDark", darkTop).putBoolean("bottomDark", darkBottom).apply()
                applyBars()
            }
        }

        @JavascriptInterface fun atRoot(msg: String) {
            runOnUiThread { leaveOnSecondBack(msg.ifBlank { "Press back again to close Ventory" }) }
        }

        @JavascriptInterface fun canAuth(): String {
            val bm = getSystemService(BiometricManager::class.java) ?: return "no"
            return if (bm.canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS) "yes" else "no"
        }

        @JavascriptInterface fun authenticate(id: String, title: String, subtitle: String) {
            if (!trusted) { authReply(id, false); return }
            runOnUiThread {
                try {
                    val prompt = BiometricPrompt.Builder(this@MainActivity)
                        .setTitle(title.ifBlank { "Unlock Ventory" })
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(AUTH)
                        .build()
                    prompt.authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = authReply(id, true)
                        override fun onAuthenticationError(code: Int, msg: CharSequence) = authReply(id, false)
                        // onAuthenticationFailed (a finger not recognised) keeps the prompt open: no reply yet.
                    })
                } catch (e: Exception) { authReply(id, false) }
            }
        }

        @JavascriptInterface fun saveBegin(name: String, mime: String): String {
            if (!trusted) return "error"
            return try {
                val clean = name.replace(Regex("[\\\\/:*?\"<>|\\n\\r]"), "_").trim().ifBlank { "Ventory" }.take(120)
                val v = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, clean)
                    put(MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/Ventory/")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: return "error"
                val out = contentResolver.openOutputStream(uri, "w") ?: return "error"
                var shown = clean
                contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) shown = c.getString(0) ?: clean }
                val id = java.util.UUID.randomUUID().toString()
                saves[id] = Save(uri, out, shown)
                id
            } catch (e: Exception) { "error" }
        }

        @JavascriptInterface fun saveChunk(id: String, b64: String): String {
            val s = saves[id] ?: return "error"
            return try { s.out.write(Base64.decode(b64, Base64.DEFAULT)); "ok" }
            catch (e: Exception) { drop(id); "error" }
        }

        @JavascriptInterface fun saveEnd(id: String, template: String): String {
            val s = saves.remove(id) ?: return "error"
            return try {
                s.out.close()
                contentResolver.update(s.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                val msg = template.ifBlank { "Saved in Downloads › Ventory: %s" }.replace("%s", s.name)
                runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show() }
                "ok"
            } catch (e: Exception) { runCatching { contentResolver.delete(s.uri, null, null) }; "error" }
        }

    }

    private fun drop(id: String) {
        val s = saves.remove(id) ?: return
        runCatching { s.out.close() }; runCatching { contentResolver.delete(s.uri, null, null) }
    }

    private fun authReply(id: String, ok: Boolean) =
        dispatch("dispatchEvent(new CustomEvent('ventorynative-auth',{detail:{id:${JSONObject.quote(id)},ok:$ok}}))")

    /* ---------- back ---------- */

    private fun leaveOnSecondBack(msg: String) {
        val now = System.currentTimeMillis()
        if (now - lastBack < 2000) finish()
        else { lastBack = now; Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (!pageReady) { plainBack(); return }
        // Ventory decides: an open sheet closes; at the first screen the page calls atRoot().
        web.evaluateJavascript("(function(){try{return window.VentoryBack?window.VentoryBack():'none'}catch(e){return 'none'}})()") { r ->
            if (r == null || r.contains("none")) plainBack()
        }
    }

    private fun plainBack() {
        if (web.canGoBack()) web.goBack() else leaveOnSecondBack("Press back again to close Ventory")
    }

    /* ---------- updates of the app itself ---------- */

    /** If GitHub has a newer android-N release with Ventory.apk, offer it (at most once a day per version) and install in place. */
    private fun checkUpdate() = Thread {
        try {
            val c = URL(REPO_RELEASES).openConnection() as HttpURLConnection
            c.setRequestProperty("Accept", "application/vnd.github+json"); c.connectTimeout = 8000; c.readTimeout = 8000
            val list = JSONArray(c.inputStream.bufferedReader().readText())
            var best = BuildConfig.VERSION_CODE
            var url: String? = null
            for (i in 0 until list.length()) {
                val r = list.getJSONObject(i)
                if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue
                val n = r.getString("tag_name").takeIf { it.startsWith("android-") }?.substringAfter("android-")?.toIntOrNull() ?: continue
                if (n <= best) continue
                val assets = r.getJSONArray("assets")
                val apk = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.getString("name") == "Ventory.apk" } ?: continue
                best = n; url = apk.getString("browser_download_url")
            }
            val found = url ?: return@Thread
            val askedAt = prefs.getLong("asked-$best", 0L)
            if (System.currentTimeMillis() - askedAt < 86_400_000L) return@Thread
            runOnUiThread {
                prefs.edit().putLong("asked-$best", System.currentTimeMillis()).apply()
                AlertDialog.Builder(this).setTitle("New version of Ventory")
                    .setMessage("A new version of the app is ready. Install it now? Your floor and your account stay as they are.")
                    .setPositiveButton("Install") { _, _ -> install(found) }.setNegativeButton("Later", null).show()
            }
        } catch (_: Exception) {}
    }.start()

    private fun install(url: String) {
        Toast.makeText(this, "Downloading the update…", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val pi = packageManager.packageInstaller
                val id = pi.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
                pi.openSession(id).use { s ->
                    val c = URL(url).openConnection() as HttpURLConnection; c.instanceFollowRedirects = true
                    c.inputStream.use { inp -> s.openWrite("ventory.apk", 0, -1).use { out -> inp.copyTo(out); s.fsync(out) } }
                    val back = Intent(this, MainActivity::class.java).setAction("ventory.INSTALL")
                    val pend = PendingIntent.getActivity(this, 1, back, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    s.commit(pend.intentSender)
                }
            } catch (e: Exception) { runOnUiThread { Toast.makeText(this, "Could not update: ${e.message}", Toast.LENGTH_LONG).show() } }
        }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == "ventory.INSTALL") {
            when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION") val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    if (confirm != null) startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                PackageInstaller.STATUS_SUCCESS -> {}
                else -> Toast.makeText(this, "The update was not installed: " + (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""), Toast.LENGTH_LONG).show()
            }
            return
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    override fun onDestroy() {
        for (id in saves.keys.toList()) drop(id)
        super.onDestroy()
    }
}
