package com.example

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Parcelable
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.io.FileOutputStream

class MainActivity : ComponentActivity() {
  private var webView: WebView? = null

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Tam ekran sürükleyici mod: Sistem navigasyon ve durum çubuğu otomatik saklanır
    WindowCompat.setDecorFitsSystemWindows(window, false)
    hideSystemBars()

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
        }

        webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
          ): Boolean {
            val url = request?.url?.toString() ?: return false
            if (url.startsWith("file:///android_asset/")) {
              return false
            }
            return handleExternalUrl(url)
          }

          @Deprecated("Deprecated in Java")
          override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            if (url == null) return false
            if (url.startsWith("file:///android_asset/")) {
              return false
            }
            return handleExternalUrl(url)
          }

          override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
          ) {
            Log.e("WebAppError", "WebView Error: ${error?.description}")
            super.onReceivedError(view, request, error)
          }
        }

        loadUrl("file:///android_asset/index.html")
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

  override fun onBackPressed() {
    val wv = webView
    if (wv != null && wv.canGoBack()) {
      wv.goBack()
    } else {
      super.onBackPressed()
    }
  }
}
