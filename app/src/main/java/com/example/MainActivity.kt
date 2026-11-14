package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.util.Calendar
import org.json.JSONObject

class MainActivity : ComponentActivity() {
  private var webView: WebView? = null
  private var filePathCallback: ValueCallback<Array<Uri>>? = null
  private var pendingOpenTab: String? = null
  private var pendingCepPosCallbackJson: String? = null
  @Volatile
  private var nfcReaderActive: Boolean = false
  private var nfcAdapter: NfcAdapter? = null

  companion object {
    private const val APP_ASSETS_ORIGIN = "https://appassets.androidplatform.net"
    private const val APP_ASSETS_ENTRY = "$APP_ASSETS_ORIGIN/assets/index.html"
    private const val FILE_CHOOSER_REQUEST_CODE = 5001
    private const val FRIDAY_BACKUP_REQUEST_CODE = 5002
    private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 5003
  }

  private fun guessMimeType(path: String): String {
    val lower = path.lowercase()
    return when {
      lower.endsWith(".html") || lower.endsWith(".htm") -> "text/html"
      lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
      lower.endsWith(".css") -> "text/css"
      lower.endsWith(".json") -> "application/json"
      lower.endsWith(".png") -> "image/png"
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
      lower.endsWith(".svg") -> "image/svg+xml"
      lower.endsWith(".webp") -> "image/webp"
      lower.endsWith(".woff2") -> "font/woff2"
      lower.endsWith(".woff") -> "font/woff"
      lower.endsWith(".ttf") -> "font/ttf"
      lower.endsWith(".ico") -> "image/x-icon"
      else -> "application/octet-stream"
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Tam ekran sürükleyici mod: Sistem navigasyon ve durum çubuğu otomatik saklanır
    WindowCompat.setDecorFitsSystemWindows(window, false)
    hideSystemBars()

    nfcAdapter = NfcAdapter.getDefaultAdapter(this)
    pendingOpenTab = intent?.getStringExtra("open_tab")
    pendingCepPosCallbackJson = extractCepPosCallbackJson(intent)

    try {
      WebView.setWebContentsDebuggingEnabled(true)

      val rootContainer = FrameLayout(this).apply {
        layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(Color.parseColor("#0b1322"))
      }

      val wv = WebView(this).apply {
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(Color.parseColor("#0b1322"))

        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          allowFileAccess = true
          allowContentAccess = true
          allowFileAccessFromFileURLs = true
          allowUniversalAccessFromFileURLs = true
          defaultTextEncodingName = "UTF-8"
          cacheMode = WebSettings.LOAD_DEFAULT
          useWideViewPort = true
          loadWithOverviewMode = true
        }

        // JavaScript Köprüsü: Web tarafından doğrudan WhatsApp ve Mail ile PDF dosya eki paylaşımı
        addJavascriptInterface(AndroidNativeBridge(), "AndroidBridge")

        webChromeClient = object : WebChromeClient() {
          override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
            Log.d("WebApp", "${consoleMessage?.message()} -- line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
            return super.onConsoleMessage(consoleMessage)
          }

          override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
          ): Boolean {
            this@MainActivity.filePathCallback?.onReceiveValue(null)
            this@MainActivity.filePathCallback = filePathCallback
            return try {
              val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
              }
              if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
              }
              @Suppress("DEPRECATION")
              startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE)
              true
            } catch (e: Exception) {
              Log.e("MainActivity", "File chooser error", e)
              this@MainActivity.filePathCallback = null
              false
            }
          }
        }

        webViewClient = object : WebViewClient() {
          override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
          ): WebResourceResponse? {
            val reqUri = request?.url ?: return null
            if (reqUri.scheme == "https" && reqUri.host == "appassets.androidplatform.net") {
              val rawPath = reqUri.path ?: "/assets/index.html"
              val assetPath = rawPath.removePrefix("/assets/").removePrefix("/").ifEmpty { "index.html" }
              return try {
                val inputStream = assets.open(assetPath)
                WebResourceResponse(
                  guessMimeType(assetPath),
                  "UTF-8",
                  200,
                  "OK",
                  mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store"
                  ),
                  inputStream
                )
              } catch (e: Exception) {
                Log.w("WebAppAsset", "Asset not found: $assetPath", e)
                WebResourceResponse(
                  "text/plain",
                  "UTF-8",
                  404,
                  "Not Found",
                  emptyMap(),
                  ByteArrayInputStream(ByteArray(0))
                )
              }
            }
            return super.shouldInterceptRequest(view, request)
          }

          override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
          ): Boolean {
            val url = request?.url?.toString() ?: return false
            if (url.startsWith(APP_ASSETS_ORIGIN) || url.startsWith("file:///android_asset/")) {
              return false
            }
            return handleExternalUrl(url)
          }

          @Deprecated("Deprecated in Java")
          override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            if (url == null) return false
            if (url.startsWith(APP_ASSETS_ORIGIN) || url.startsWith("file:///android_asset/")) {
              return false
            }
            return handleExternalUrl(url)
          }

          override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            val tabToOpen = pendingOpenTab
            if (!tabToOpen.isNullOrBlank()) {
              pendingOpenTab = null
              dispatchOpenTabToWeb(tabToOpen)
            }
            val cepCallback = pendingCepPosCallbackJson
            if (!cepCallback.isNullOrBlank()) {
              pendingCepPosCallbackJson = null
              dispatchCepPosCallbackToWeb(cepCallback)
            }
          }

          override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
          ) {
            Log.e("WebAppError", "WebView Error (${request?.url}): ${error?.description}")
            super.onReceivedError(view, request, error)
          }
        }

        // HTTPS sanal kök üzerinden yükleyerek tüm Android emülatörlerinde ES module CORS hatasını önler
        loadUrl(APP_ASSETS_ENTRY)
      }

      rootContainer.addView(wv)

      // ÖNEMLİ: Padding doğrudan WebView'e değil, kapsayıcı FrameLayout'a uygulanır!
      // Böylece WebView'in kendi fiziksel yüksekliği (onSizeChanged / window.innerHeight)
      // durum çubuğunun altında ve klavyenin (IME) tam üstünde olacak şekilde gerçekten daralır.
      ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { v, insets ->
        val topSystemInsets = insets.getInsetsIgnoringVisibility(
          WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
        )
        val imeInset = insets.getInsets(WindowInsetsCompat.Type.ime())
        val isImeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

        val topPadding = topSystemInsets.top
        val bottomPadding = if (isImeVisible) imeInset.bottom else 0

        if (v.paddingTop != topPadding || v.paddingBottom != bottomPadding) {
          v.setPadding(0, topPadding, 0, bottomPadding)
          wv.requestLayout()
        }

        val density = resources.displayMetrics.density.coerceAtLeast(1f)
        val cssHeight = (bottomPadding / density).toInt()
        wv.postDelayed({
          wv.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('androidKeyboardChange', { detail: { open: $isImeVisible, height: $cssHeight } }));",
            null
          )
        }, 120)

        WindowInsetsCompat.CONSUMED
      }

      this.webView = wv
      setContentView(rootContainer)

      onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val activeWebView = webView
          if (activeWebView != null && activeWebView.canGoBack()) {
            activeWebView.goBack()
          } else {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      })

      try {
        FridayBackupReceiver.ensureChannel(this)
        scheduleWeeklyFridayBackupReminder()
        requestNotificationPermissionIfNeeded()
      } catch (e: Exception) {
        Log.w("MainActivity", "Notification setup warning", e)
      }
    } catch (e: Exception) {
      Log.e("MainActivity", "Failed to initialize WebView", e)
    }
  }

  /**
   * WhatsApp (wa.me, api.whatsapp.com, whatsapp://), tel, mailto ve harici web URL'lerini
   * telefonun yerel uygulamalarına yönlendirir.
   */
  private fun handleExternalUrl(url: String): Boolean {
    return try {
      val uri = Uri.parse(url)

      if (url.contains("whatsapp") || url.contains("wa.me") || uri.scheme == "whatsapp") {
        try {
          val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
          }
          startActivity(intent)
          return true
        } catch (e: Exception) {
          Log.w("MainActivity", "WhatsApp app not found, falling back to browser", e)
          val browserIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
          }
          startActivity(browserIntent)
          return true
        }
      }

      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      startActivity(intent)
      true
    } catch (e: Exception) {
      Log.e("MainActivity", "Could not handle URL: $url", e)
      false
    }
  }

  private fun normalizeWhatsAppPhone(raw: String?): String {
    val digits = raw?.replace(Regex("\\D"), "") ?: ""
    if (digits.isEmpty()) return ""
    val without00 = if (digits.startsWith("00")) digits.substring(2) else digits
    return when {
      without00.startsWith("90") && without00.length >= 12 -> without00
      without00.startsWith("0") && without00.length == 11 -> "9$without00"
      without00.startsWith("5") && without00.length == 10 -> "90$without00"
      else -> without00
    }
  }

  inner class AndroidNativeBridge {
    /**
     * PDF Dosyasını Base64 olarak alır, geçici PDF dosyası oluşturur ve
     * hedef uygulamaya (targetApp = "whatsapp", "mail" veya "all") PDF EKİ (Attachment) olarak gönderir.
     * WhatsApp'ta "jid" parametresi ile carideki telefon numarasını otomatik açar;
     * Mail'de ise carideki e-posta adresini "Kime" alanına otomatik yazar.
     */
    @JavascriptInterface
    fun sharePdfFile(base64Data: String?, fileName: String?, targetApp: String?, recipient: String?, subject: String?, caption: String?): Boolean {
      if (base64Data.isNullOrBlank()) return false
      return try {
        val cleanBase64 = if (base64Data.contains(",")) {
          base64Data.substringAfter(",")
        } else {
          base64Data
        }

        val pdfBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
        val validFileName = if (!fileName.isNullOrBlank()) {
          if (fileName.endsWith(".pdf", ignoreCase = true)) fileName else "$fileName.pdf"
        } else {
          "makbuz.pdf"
        }

        // Cache klasörüne PDF dosyasını yaz
        val pdfDir = File(cacheDir, "pdf_shares").apply { mkdirs() }
        val pdfFile = File(pdfDir, validFileName)
        FileOutputStream(pdfFile).use { it.write(pdfBytes) }

        val contentUri = FileProvider.getUriForFile(
          this@MainActivity,
          "${applicationContext.packageName}.fileprovider",
          pdfFile
        )

        runOnUiThread {
          try {
            val cleanRecipient = recipient?.trim() ?: ""
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
              type = "application/pdf"
              putExtra(Intent.EXTRA_STREAM, contentUri)
              clipData = ClipData.newRawUri(validFileName, contentUri)
              if (!caption.isNullOrBlank()) {
                putExtra(Intent.EXTRA_TEXT, caption)
              }
              if (!subject.isNullOrBlank()) {
                putExtra(Intent.EXTRA_SUBJECT, subject)
              }
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val target = targetApp?.lowercase() ?: "all"

            if (target == "whatsapp") {
              val formattedPhone = normalizeWhatsAppPhone(cleanRecipient)
              val pm = packageManager
              var targetPkg: String? = null

              for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                val resolveInfos = pm.queryIntentActivities(
                  Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    `package` = pkg
                  },
                  0
                )
                if (resolveInfos.isNotEmpty()) {
                  targetPkg = pkg
                  break
                }
              }

              if (targetPkg != null) {
                val waIntent = Intent(shareIntent).apply {
                  `package` = targetPkg
                  if (formattedPhone.isNotEmpty()) {
                    putExtra("jid", "$formattedPhone@s.whatsapp.net")
                  }
                  addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                  addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                grantUriPermission(targetPkg, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(waIntent)
              } else {
                val chooser = Intent.createChooser(shareIntent, "WhatsApp ile PDF Paylaş").apply {
                  addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                  addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(chooser)
              }
            } else if (target == "mail") {
              if (cleanRecipient.isNotEmpty()) {
                shareIntent.putExtra(Intent.EXTRA_EMAIL, arrayOf(cleanRecipient))
              }

              // Sadece yüklü E-posta uygulamalarını (Gmail, Outlook vb.) bul
              val pm = packageManager
              val mailtoActivities = pm.queryIntentActivities(
                Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")),
                0
              )
              val mailPackageNames = mailtoActivities.mapNotNull { it.activityInfo?.packageName }.distinct()

              val targetedIntents = mutableListOf<Intent>()
              for (pkg in mailPackageNames) {
                val pdfSendMatches = pm.queryIntentActivities(
                  Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    `package` = pkg
                  },
                  0
                )
                if (pdfSendMatches.isNotEmpty()) {
                  grantUriPermission(pkg, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                  val targeted = Intent(shareIntent).apply {
                    `package` = pkg
                    if (cleanRecipient.isNotEmpty()) {
                      putExtra(Intent.EXTRA_EMAIL, arrayOf(cleanRecipient))
                    }
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  }
                  targetedIntents.add(targeted)
                }
              }

              when {
                targetedIntents.size == 1 -> {
                  startActivity(targetedIntents[0])
                }
                targetedIntents.size > 1 -> {
                  val primary = targetedIntents.removeAt(0)
                  val chooser = Intent.createChooser(primary, "E-posta ile PDF Gönder").apply {
                    putExtra(Intent.EXTRA_INITIAL_INTENTS, targetedIntents.toTypedArray<Parcelable>())
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  }
                  startActivity(chooser)
                }
                else -> {
                  val mailChooser = Intent.createChooser(shareIntent, "E-posta ile PDF Gönder").apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  }
                  startActivity(mailChooser)
                }
              }
            } else {
              // Genel Paylaşım Menüsü (Tüm uygulamalar)
              val chooser = Intent.createChooser(shareIntent, "Makbuz PDF Paylaş").apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              startActivity(chooser)
            }
          } catch (e: Exception) {
            Log.e("AndroidBridge", "Failed to launch PDF share intent", e)
          }
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "sharePdfFile error", e)
        false
      }
    }

    @JavascriptInterface
    fun sendWhatsApp(phone: String?, message: String?): Boolean {
      return try {
        val cleanPhone = phone?.trim() ?: ""
        val cleanMsg = message ?: ""

        val url = if (cleanPhone.isNotEmpty()) {
          "https://api.whatsapp.com/send?phone=$cleanPhone&text=${Uri.encode(cleanMsg)}"
        } else {
          "https://api.whatsapp.com/send?text=${Uri.encode(cleanMsg)}"
        }

        runOnUiThread {
          handleExternalUrl(url)
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "sendWhatsApp failed", e)
        false
      }
    }

    @JavascriptInterface
    fun saveAndShareTextFile(content: String?, fileName: String?, mimeType: String?): Boolean {
      if (content.isNullOrBlank()) return false
      return try {
        val validName = if (!fileName.isNullOrBlank()) fileName.trim() else "tahsilatim_yedek.json"
        val validMime = if (!mimeType.isNullOrBlank()) mimeType.trim() else "application/json"

        val exportDir = File(cacheDir, "pdf_shares").apply { mkdirs() }
        val outFile = File(exportDir, validName)
        FileOutputStream(outFile).use { it.write(content.toByteArray(Charsets.UTF_8)) }

        val contentUri = FileProvider.getUriForFile(
          this@MainActivity,
          "${applicationContext.packageName}.fileprovider",
          outFile
        )

        runOnUiThread {
          try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
              type = validMime
              putExtra(Intent.EXTRA_STREAM, contentUri)
              putExtra(Intent.EXTRA_SUBJECT, validName)
              clipData = ClipData.newRawUri(validName, contentUri)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooser = Intent.createChooser(shareIntent, "JSON Yedeği Kaydet veya Paylaş").apply {
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(chooser)
          } catch (e: Exception) {
            Log.e("AndroidBridge", "Failed to share JSON backup", e)
          }
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "saveAndShareTextFile error", e)
        false
      }
    }

    @JavascriptInterface
    fun requestPinHomeWidget(): Boolean {
      return try {
        runOnUiThread {
          try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              val appWidgetManager = AppWidgetManager.getInstance(this@MainActivity)
              val provider = ComponentName(this@MainActivity, TahsilatWidgetProvider::class.java)
              if (appWidgetManager.isRequestPinAppWidgetSupported) {
                appWidgetManager.requestPinAppWidget(provider, null, null)
              } else {
                Toast.makeText(
                  this@MainActivity,
                  "Ana ekrana basılı tutup Widget'lar menüsünden Tahsilatım Widget'ını ekleyebilirsiniz.",
                  Toast.LENGTH_LONG
                ).show()
              }
            } else {
              Toast.makeText(
                this@MainActivity,
                "Ana ekrana basılı tutup Widget'lar menüsünden Tahsilatım Widget'ını ekleyebilirsiniz.",
                Toast.LENGTH_LONG
              ).show()
            }
          } catch (e: Exception) {
            Log.e("AndroidBridge", "requestPinHomeWidget UI error", e)
          }
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "requestPinHomeWidget failed", e)
        false
      }
    }

    @JavascriptInterface
    fun openExternal(url: String?): Boolean {
      if (url.isNullOrBlank()) return false
      return try {
        runOnUiThread {
          handleExternalUrl(url)
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "openExternal failed", e)
        false
      }
    }

    @JavascriptInterface
    fun getNfcStatus(): String {
      val adapter = nfcAdapter ?: NfcAdapter.getDefaultAdapter(this@MainActivity).also {
        nfcAdapter = it
      }
      return when {
        adapter == null -> "unsupported"
        !adapter.isEnabled -> "disabled"
        else -> "ready"
      }
    }

    @JavascriptInterface
    fun openNfcSettings(): Boolean {
      return try {
        runOnUiThread {
          val intent = Intent(Settings.ACTION_NFC_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          startActivity(intent)
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "openNfcSettings failed", e)
        false
      }
    }

    @JavascriptInterface
    fun startNfcReader(): String {
      val adapter = nfcAdapter ?: NfcAdapter.getDefaultAdapter(this@MainActivity).also {
        nfcAdapter = it
      }
      if (adapter == null) return "unsupported"
      if (!adapter.isEnabled) return "disabled"
      nfcReaderActive = true
      runOnUiThread {
        enableNfcReaderModeInternal()
      }
      return "started"
    }

    @JavascriptInterface
    fun stopNfcReader(): Boolean {
      nfcReaderActive = false
      runOnUiThread {
        disableNfcReaderModeInternal()
      }
      return true
    }

    @JavascriptInterface
    fun isCepPosAppInstalled(): Boolean {
      val candidates = listOf("com.iyzico.ceppos", "com.iyzico.isimicin")
      for (pkg in candidates) {
        if (isPackageInstalled(pkg)) return true
      }
      return false
    }

    @JavascriptInterface
    fun launchCepPosDeepLink(deepLinkUrl: String?): Boolean {
      return try {
        val trimmed = deepLinkUrl?.trim() ?: ""
        runOnUiThread {
          try {
            if (trimmed.isNotEmpty()) {
              val intent = Intent(Intent.ACTION_VIEW, Uri.parse(trimmed)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              startActivity(intent)
            } else {
              val installedPkg = listOf("com.iyzico.ceppos", "com.iyzico.isimicin")
                .firstOrNull { isPackageInstalled(it) }
              val launchIntent = installedPkg?.let { packageManager.getLaunchIntentForPackage(it) }
              if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launchIntent)
              } else {
                Toast.makeText(
                  this@MainActivity,
                  "iyzico Cep POS uygulaması cihazda bulunamadı.",
                  Toast.LENGTH_SHORT
                ).show()
              }
            }
          } catch (e: Exception) {
            Log.e("AndroidBridge", "launchCepPosDeepLink UI error", e)
          }
        }
        true
      } catch (e: Exception) {
        Log.e("AndroidBridge", "launchCepPosDeepLink failed", e)
        false
      }
    }
  }

  private fun isPackageInstalled(packageName: String): Boolean {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(packageName, 0)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  private val nfcReaderCallback = NfcAdapter.ReaderCallback { tag: Tag? ->
    if (tag == null || !nfcReaderActive) return@ReaderCallback
    val summary = NfcEmvHelper.readCardSummary(tag)
    if (summary.success) {
      nfcReaderActive = false
      runOnUiThread {
        disableNfcReaderModeInternal()
        val payload = summary.toJson().toString()
        val js = "window.dispatchEvent(new CustomEvent('androidNfcCardRead',{detail:$payload}));"
        webView?.evaluateJavascript(js, null)
      }
    } else {
      runOnUiThread {
        val errPayload = JSONObject().apply {
          put("error", summary.error ?: "Kart okunamadı.")
        }.toString()
        val js = "window.dispatchEvent(new CustomEvent('androidNfcError',{detail:$errPayload}));"
        webView?.evaluateJavascript(js, null)
      }
    }
  }

  private fun enableNfcReaderModeInternal() {
    val adapter = nfcAdapter ?: return
    if (!adapter.isEnabled || !nfcReaderActive) return
    try {
      val flags = NfcAdapter.FLAG_READER_NFC_A or
        NfcAdapter.FLAG_READER_NFC_B or
        NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
      adapter.enableReaderMode(this, nfcReaderCallback, flags, null)
    } catch (e: Exception) {
      Log.w("MainActivity", "enableReaderMode warning", e)
    }
  }

  private fun disableNfcReaderModeInternal() {
    try {
      nfcAdapter?.disableReaderMode(this)
    } catch (e: Exception) {
      Log.w("MainActivity", "disableReaderMode warning", e)
    }
  }

  override fun onResume() {
    super.onResume()
    if (nfcReaderActive) {
      enableNfcReaderModeInternal()
    }
  }

  override fun onPause() {
    disableNfcReaderModeInternal()
    super.onPause()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val openTab = intent.getStringExtra("open_tab")
    if (!openTab.isNullOrBlank()) {
      dispatchOpenTabToWeb(openTab)
    }
    val cepCallbackJson = extractCepPosCallbackJson(intent)
    if (!cepCallbackJson.isNullOrBlank()) {
      dispatchCepPosCallbackToWeb(cepCallbackJson)
    }
  }

  private fun extractCepPosCallbackJson(intent: Intent?): String? {
    val data = intent?.data ?: return null
    if (data.scheme != "tahsilatim" || data.host != "ceppost-callback") return null
    return try {
      val json = JSONObject()
      for (name in data.queryParameterNames) {
        json.put(name, data.getQueryParameter(name) ?: "")
      }
      json.put("rawUrl", data.toString())
      json.toString()
    } catch (e: Exception) {
      Log.w("MainActivity", "Failed to parse ceppost callback URI", e)
      null
    }
  }

  private fun dispatchCepPosCallbackToWeb(jsonString: String) {
    val js = "window.__ANDROID_CEP_POS_CALLBACK__=$jsonString;window.dispatchEvent(new CustomEvent('androidCepPosCallback',{detail:$jsonString}));"
    webView?.post { webView?.evaluateJavascript(js, null) }
    webView?.postDelayed({ webView?.evaluateJavascript(js, null) }, 350)
  }

  private fun dispatchOpenTabToWeb(tab: String) {
    val sanitized = tab.replace("'", "").trim()
    if (sanitized.isEmpty()) return
    val js = "window.__ANDROID_PENDING_TAB__='$sanitized';window.dispatchEvent(new CustomEvent('androidOpenTab',{detail:'$sanitized'}));"
    webView?.post { webView?.evaluateJavascript(js, null) }
    webView?.postDelayed({ webView?.evaluateJavascript(js, null) }, 350)
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
      val callback = filePathCallback
      filePathCallback = null
      if (callback == null) return

      var results: Array<Uri>? = null
      if (resultCode == Activity.RESULT_OK && data != null) {
        val clipData = data.clipData
        if (clipData != null && clipData.itemCount > 0) {
          results = Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
        } else if (data.data != null) {
          results = arrayOf(data.data!!)
        }
      }
      callback.onReceiveValue(results)
    }
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val granted = ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.POST_NOTIFICATIONS
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          NOTIFICATION_PERMISSION_REQUEST_CODE
        )
      }
    }
  }

  private fun scheduleWeeklyFridayBackupReminder() {
    try {
      val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val intent = Intent(this, FridayBackupReceiver::class.java)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val pendingIntent = PendingIntent.getBroadcast(
        this,
        FRIDAY_BACKUP_REQUEST_CODE,
        intent,
        flags
      )

      val now = Calendar.getInstance()
      val nextFriday = Calendar.getInstance().apply {
        set(Calendar.DAY_OF_WEEK, Calendar.FRIDAY)
        set(Calendar.HOUR_OF_DAY, 10)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        if (timeInMillis <= now.timeInMillis) {
          add(Calendar.WEEK_OF_YEAR, 1)
        }
      }

      alarmManager.setInexactRepeating(
        AlarmManager.RTC_WAKEUP,
        nextFriday.timeInMillis,
        AlarmManager.INTERVAL_DAY * 7,
        pendingIntent
      )
    } catch (e: Exception) {
      Log.w("MainActivity", "Could not schedule weekly Friday backup alarm", e)
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      hideSystemBars()
    }
  }

  private fun hideSystemBars() {
    val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
    windowInsetsController.isAppearanceLightStatusBars = false
    windowInsetsController.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    windowInsetsController.hide(WindowInsetsCompat.Type.navigationBars())
  }
}
