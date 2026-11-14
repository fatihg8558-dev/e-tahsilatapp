package com.example

import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.util.Log
import org.json.JSONObject

/**
 * Contactless EMV / NFC card reader helper.
 * Reads ONLY non-sensitive public card summary (brand, masked last 4 digits, MM/YY expiry)
 * and immediately discards any raw PAN/Track-2 bytes without logging or persisting them.
 */
object NfcEmvHelper {
  private const val TAG = "NfcEmvHelper"

  // 2PAY.SYS.DDF01
  private val SELECT_PPSE = byteArrayOf(
    0x00, 0xA4.toByte(), 0x04, 0x00, 0x0E,
    0x32, 0x50, 0x41, 0x59, 0x2E, 0x53, 0x59, 0x53, 0x2E, 0x44, 0x44, 0x46, 0x30, 0x31,
    0x00
  )

  private val FALLBACK_AIDS = listOf(
    byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x03, 0x10, 0x10), // VISA
    byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x04, 0x10, 0x10), // MASTERCARD
    byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x06, 0x72, 0x30, 0x10), // TROY
    byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x06, 0x72, 0x30, 0x20), // TROY Debit
    byteArrayOf(0xA0.toByte(), 0x00, 0x00, 0x00, 0x25, 0x01) // AMEX
  )

  data class CardSummary(
    val success: Boolean,
    val brand: String = "Temassız NFC Kart",
    val last4: String = "",
    val expiry: String = "",
    val uidRef: String = "",
    val method: String = "android_nfc_isodep",
    val error: String? = null
  ) {
    fun toJson(): JSONObject {
      return JSONObject().apply {
        put("success", success)
        put("brand", brand)
        put("last4", last4)
        put("expiry", expiry)
        put("uidRef", uidRef)
        put("method", method)
        if (!error.isNullOrBlank()) {
          put("error", error)
        }
      }
    }
  }

  fun readCardSummary(tag: Tag): CardSummary {
    val uidBytes = tag.id ?: ByteArray(0)
    val uidHex = uidBytes.joinToString("") { "%02X".format(it) }
    val uidRef = if (uidHex.length >= 4) uidHex.takeLast(4) else uidHex

    val isoDep = IsoDep.get(tag)
    if (isoDep == null) {
      return CardSummary(
        success = true,
        brand = "Temassız NFC Etiket",
        last4 = "",
        expiry = "",
        uidRef = uidRef,
        method = "android_nfc_uid"
      )
    }

    return try {
      isoDep.connect()
      isoDep.timeout = 2500

      var detectedBrand = ""
      var last4 = ""
      var expiry = ""
      var emvConnected = false

      // 1) SELECT PPSE
      val ppseResp = safeTransceive(isoDep, SELECT_PPSE)
      val candidateAids = mutableListOf<ByteArray>()
      if (isStatusOk(ppseResp)) {
        emvConnected = true
        val tlvs = parseBerTlv(stripSw(ppseResp))
        findAllTlvValues(tlvs, "4F").forEach { aid ->
          if (aid.isNotEmpty()) candidateAids.add(aid)
        }
        val ppseLabel = findFirstTlvText(tlvs, "50") ?: findFirstTlvText(tlvs, "9F12")
        if (!ppseLabel.isNullOrBlank()) {
          detectedBrand = normalizeBrandFromLabel(ppseLabel)
        }
      }

      if (candidateAids.isEmpty()) {
        candidateAids.addAll(FALLBACK_AIDS)
      }

      // 2) Try AIDs to extract non-sensitive summary
      for (aid in candidateAids) {
        val selectAidCmd = buildSelectApdu(aid)
        val aidResp = safeTransceive(isoDep, selectAidCmd)
        if (!isStatusOk(aidResp)) continue
        emvConnected = true

        val aidHex = aid.joinToString("") { "%02X".format(it) }
        if (detectedBrand.isBlank()) {
          detectedBrand = detectBrandFromAidHex(aidHex)
        }

        val aidTlvs = parseBerTlv(stripSw(aidResp))
        val appLabel = findFirstTlvText(aidTlvs, "50") ?: findFirstTlvText(aidTlvs, "9F12")
        if (!appLabel.isNullOrBlank()) {
          detectedBrand = normalizeBrandFromLabel(appLabel)
        }

        // Send minimal GPO (either built from PDOL 9F38 with zeros, or standard 83 00)
        val pdolBytes = findFirstTlvBytes(aidTlvs, "9F38")
        val gpoCmd = buildGpoApdu(pdolBytes)
        val gpoResp = safeTransceive(isoDep, gpoCmd)
        val aflEntries = mutableListOf<Pair<Int, Int>>()

        if (isStatusOk(gpoResp)) {
          val gpoData = stripSw(gpoResp)
          val gpoTlvs = parseBerTlv(gpoData)
          val track2 = findFirstTlvBytes(gpoTlvs, "57")
          if (track2 != null) {
            val extracted = extractSummaryFromTrack2(track2)
            if (extracted.first.isNotBlank()) last4 = extracted.first
            if (extracted.second.isNotBlank()) expiry = extracted.second
            if (extracted.third.isNotBlank()) detectedBrand = extracted.third
          }

          val aflBytes = findFirstTlvBytes(gpoTlvs, "94")
            ?: extractFormat1Afl(gpoData)
          if (aflBytes != null) {
            var idx = 0
            while (idx + 3 < aflBytes.size) {
              val sfi = (aflBytes[idx].toInt() and 0xF8) ushr 3
              val firstRec = aflBytes[idx + 1].toInt() and 0xFF
              val lastRec = aflBytes[idx + 2].toInt() and 0xFF
              if (sfi in 1..30 && firstRec >= 1) {
                for (r in firstRec..lastRec.coerceAtMost(firstRec + 6)) {
                  aflEntries.add(sfi to r)
                }
              }
              idx += 4
            }
          }
        }

        // Fallback SFI records if AFL absent or Track2 not yet found
        if (last4.isBlank()) {
          if (aflEntries.isEmpty()) {
            for (sfi in 1..3) {
              for (rec in 1..4) {
                aflEntries.add(sfi to rec)
              }
            }
          }

          for ((sfi, rec) in aflEntries) {
            val readCmd = byteArrayOf(
              0x00,
              0xB2.toByte(),
              rec.toByte(),
              ((sfi shl 3) or 0x04).toByte(),
              0x00
            )
            val recResp = safeTransceive(isoDep, readCmd)
            if (!isStatusOk(recResp)) continue

            val recTlvs = parseBerTlv(stripSw(recResp))

            val track2 = findFirstTlvBytes(recTlvs, "57")
            if (track2 != null) {
              val extracted = extractSummaryFromTrack2(track2)
              if (last4.isBlank() && extracted.first.isNotBlank()) last4 = extracted.first
              if (expiry.isBlank() && extracted.second.isNotBlank()) expiry = extracted.second
              if (detectedBrand.isBlank() && extracted.third.isNotBlank()) detectedBrand = extracted.third
            }

            if (last4.isBlank()) {
              val panBytes = findFirstTlvBytes(recTlvs, "5A")
              if (panBytes != null) {
                val panSummary = extractSummaryFromPanBytes(panBytes)
                if (panSummary.first.isNotBlank()) last4 = panSummary.first
                if (detectedBrand.isBlank() && panSummary.second.isNotBlank()) {
                  detectedBrand = panSummary.second
                }
              }
            }

            if (expiry.isBlank()) {
              val expBytes = findFirstTlvBytes(recTlvs, "5F24")
              if (expBytes != null && expBytes.size >= 2) {
                val hex = expBytes.joinToString("") { "%02X".format(it) }
                if (hex.length >= 4 && hex.take(4).all { it.isDigit() }) {
                  expiry = "${hex.substring(2, 4)}/${hex.substring(0, 2)}"
                }
              }
            }

            if (last4.isNotBlank() && expiry.isNotBlank()) break
          }
        }

        if (last4.isNotBlank() || emvConnected) {
          break
        }
      }

      if (!emvConnected && uidRef.isBlank()) {
        CardSummary(
          success = false,
          error = "Kart yanıt vermedi. Lütfen kartı telefonun NFC antenine 1-2 saniye sabit tutunuz."
        )
      } else {
        CardSummary(
          success = true,
          brand = detectedBrand.ifBlank { "Temassız Banka/Kredi Kartı" },
          last4 = last4,
          expiry = expiry,
          uidRef = uidRef,
          method = if (last4.isNotBlank()) "android_nfc_emv" else "android_nfc_contactless"
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "NFC EMV read interrupted", e)
      CardSummary(
        success = false,
        error = "Kart okuma kesildi. Lütfen kartı sabit tutarak tekrar okutunuz."
      )
    } finally {
      try {
        isoDep.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun safeTransceive(isoDep: IsoDep, cmd: ByteArray): ByteArray? {
    return try {
      val resp = isoDep.transceive(cmd)
      // Handle 61 xx (GET RESPONSE) or 6C xx (wrong Le)
      if (resp.size == 2 && resp[0] == 0x6C.toByte() && cmd.size >= 5) {
        val retry = cmd.copyOf()
        retry[retry.size - 1] = resp[1]
        isoDep.transceive(retry)
      } else if (resp.size >= 2 && resp[resp.size - 2] == 0x61.toByte()) {
        val getResp = byteArrayOf(0x00, 0xC0.toByte(), 0x00, 0x00, resp[resp.size - 1])
        isoDep.transceive(getResp)
      } else {
        resp
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun isStatusOk(resp: ByteArray?): Boolean {
    if (resp == null || resp.size < 2) return false
    val sw1 = resp[resp.size - 2].toInt() and 0xFF
    val sw2 = resp[resp.size - 1].toInt() and 0xFF
    return sw1 == 0x90 && sw2 == 0x00
  }

  private fun stripSw(resp: ByteArray?): ByteArray {
    if (resp == null || resp.size < 2) return ByteArray(0)
    return resp.copyOfRange(0, resp.size - 2)
  }

  private fun buildSelectApdu(aid: ByteArray): ByteArray {
    val cmd = ByteArray(6 + aid.size)
    cmd[0] = 0x00
    cmd[1] = 0xA4.toByte()
    cmd[2] = 0x04
    cmd[3] = 0x00
    cmd[4] = aid.size.toByte()
    System.arraycopy(aid, 0, cmd, 5, aid.size)
    cmd[cmd.size - 1] = 0x00
    return cmd
  }

  private fun buildGpoApdu(pdol: ByteArray?): ByteArray {
    if (pdol == null || pdol.isEmpty()) {
      return byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00, 0x00, 0x02, 0x83.toByte(), 0x00, 0x00)
    }

    var totalLen = 0
    var i = 0
    val pdolEntries = mutableListOf<Pair<String, Int>>()
    while (i < pdol.size) {
      var tagByte = pdol[i].toInt() and 0xFF
      val tagSb = StringBuilder("%02X".format(tagByte))
      i++
      if ((tagByte and 0x1F) == 0x1F && i < pdol.size) {
        tagByte = pdol[i].toInt() and 0xFF
        tagSb.append("%02X".format(tagByte))
        i++
      }
      if (i >= pdol.size) break
      val len = pdol[i].toInt() and 0xFF
      i++
      pdolEntries.add(tagSb.toString() to len)
      totalLen += len
    }

    if (totalLen <= 0 || totalLen > 128) {
      return byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00, 0x00, 0x02, 0x83.toByte(), 0x00, 0x00)
    }

    val dolData = ByteArray(totalLen)
    var pos = 0
    for ((tagName, len) in pdolEntries) {
      if (tagName == "9F66" && len >= 1) {
        // Terminal Transaction Qualifiers: contactless EMV & MSD supported
        dolData[pos] = 0x36.toByte()
      } else if (tagName == "9F1A" && len == 2) {
        // Turkey country code 0792
        dolData[pos] = 0x07
        dolData[pos + 1] = 0x92.toByte()
      } else if (tagName == "5F2A" && len == 2) {
        // TRY currency code 0949
        dolData[pos] = 0x09
        dolData[pos + 1] = 0x49
      } else if (tagName == "9F37" && len == 4) {
        dolData[pos] = 0x12
        dolData[pos + 1] = 0x34
        dolData[pos + 2] = 0x56
        dolData[pos + 3] = 0x78
      }
      pos += len
    }

    val lc = 2 + dolData.size
    val cmd = ByteArray(6 + lc)
    cmd[0] = 0x80.toByte()
    cmd[1] = 0xA8.toByte()
    cmd[2] = 0x00
    cmd[3] = 0x00
    cmd[4] = lc.toByte()
    cmd[5] = 0x83.toByte()
    cmd[6] = dolData.size.toByte()
    System.arraycopy(dolData, 0, cmd, 7, dolData.size)
    cmd[cmd.size - 1] = 0x00
    return cmd
  }

  private fun extractFormat1Afl(gpoData: ByteArray): ByteArray? {
    if (gpoData.size > 4 && gpoData[0] == 0x80.toByte()) {
      val len = gpoData[1].toInt() and 0xFF
      if (len >= 6 && gpoData.size >= 2 + len) {
        return gpoData.copyOfRange(4, 2 + len)
      }
    }
    return null
  }

  private data class TlvNode(
    val tag: String,
    val value: ByteArray,
    val children: List<TlvNode>
  )

  private fun parseBerTlv(data: ByteArray): List<TlvNode> {
    val result = mutableListOf<TlvNode>()
    var i = 0
    while (i < data.size) {
      val first = data[i].toInt() and 0xFF
      if (first == 0x00 || first == 0xFF) {
        i++
        continue
      }
      val isConstructed = (first and 0x20) != 0
      val tagSb = StringBuilder("%02X".format(first))
      i++
      if ((first and 0x1F) == 0x1F) {
        while (i < data.size) {
          val next = data[i].toInt() and 0xFF
          tagSb.append("%02X".format(next))
          i++
          if ((next and 0x80) == 0) break
        }
      }
      if (i >= data.size) break
      val lenByte = data[i].toInt() and 0xFF
      i++
      val len = if ((lenByte and 0x80) != 0) {
        val numOctets = lenByte and 0x7F
        if (numOctets <= 0 || numOctets > 3 || i + numOctets > data.size) break
        var acc = 0
        for (k in 0 until numOctets) {
          acc = (acc shl 8) or (data[i++].toInt() and 0xFF)
        }
        acc
      } else {
        lenByte
      }
      if (len < 0 || i + len > data.size) break
      val valBytes = data.copyOfRange(i, i + len)
      i += len
      val children = if (isConstructed) parseBerTlv(valBytes) else emptyList()
      result.add(TlvNode(tagSb.toString(), valBytes, children))
    }
    return result
  }

  private fun findAllTlvValues(nodes: List<TlvNode>, targetTag: String): List<ByteArray> {
    val list = mutableListOf<ByteArray>()
    for (node in nodes) {
      if (node.tag.equals(targetTag, ignoreCase = true)) {
        list.add(node.value)
      }
      if (node.children.isNotEmpty()) {
        list.addAll(findAllTlvValues(node.children, targetTag))
      }
    }
    return list
  }

  private fun findFirstTlvBytes(nodes: List<TlvNode>, targetTag: String): ByteArray? {
    for (node in nodes) {
      if (node.tag.equals(targetTag, ignoreCase = true)) {
        return node.value
      }
      if (node.children.isNotEmpty()) {
        val child = findFirstTlvBytes(node.children, targetTag)
        if (child != null) return child
      }
    }
    return null
  }

  private fun findFirstTlvText(nodes: List<TlvNode>, targetTag: String): String? {
    val bytes = findFirstTlvBytes(nodes, targetTag) ?: return null
    val str = String(bytes, Charsets.UTF_8).trim()
    return str.takeIf { it.isNotEmpty() && it.all { ch -> ch.code in 32..126 } }
  }

  private fun extractSummaryFromTrack2(track2: ByteArray): Triple<String, String, String> {
    val hex = track2.joinToString("") { "%02X".format(it) }
    val sepIdx = hex.indexOf('D')
    if (sepIdx < 8) return Triple("", "", "")

    val panDigits = hex.substring(0, sepIdx)
    val last4 = if (panDigits.length >= 4) panDigits.takeLast(4) else ""
    val brand = detectBrandFromPanPrefix(panDigits)

    val afterSep = hex.substring(sepIdx + 1)
    val expiry = if (afterSep.length >= 4 && afterSep.take(4).all { it.isDigit() }) {
      "${afterSep.substring(2, 4)}/${afterSep.substring(0, 2)}"
    } else {
      ""
    }
    return Triple(last4, expiry, brand)
  }

  private fun extractSummaryFromPanBytes(panBytes: ByteArray): Pair<String, String> {
    val digits = panBytes.joinToString("") { "%02X".format(it) }.trimEnd('F')
    if (digits.length < 8) return "" to ""
    val last4 = digits.takeLast(4)
    val brand = detectBrandFromPanPrefix(digits)
    return last4 to brand
  }

  private fun detectBrandFromPanPrefix(pan: String): String {
    return when {
      pan.startsWith("4") -> "VISA"
      pan.startsWith("9792") || pan.startsWith("65") -> "TROY"
      pan.startsWith("34") || pan.startsWith("37") -> "AMEX"
      pan.length >= 2 && pan.substring(0, 2).toIntOrNull() in 51..55 -> "MASTERCARD"
      pan.length >= 4 && pan.substring(0, 4).toIntOrNull() in 2221..2720 -> "MASTERCARD"
      else -> ""
    }
  }

  private fun detectBrandFromAidHex(aidHex: String): String {
    return when {
      aidHex.startsWith("A000000003") -> "VISA"
      aidHex.startsWith("A000000004") -> "MASTERCARD"
      aidHex.startsWith("A000000672") -> "TROY"
      aidHex.startsWith("A000000025") -> "AMEX"
      else -> ""
    }
  }

  private fun normalizeBrandFromLabel(label: String): String {
    val upper = label.uppercase()
    return when {
      upper.contains("VISA") -> "VISA"
      upper.contains("MASTERCARD") || upper.contains("DEBIT MASTERCARD") -> "MASTERCARD"
      upper.contains("TROY") -> "TROY"
      upper.contains("AMEX") || upper.contains("AMERICAN EXPRESS") -> "AMEX"
      else -> label.trim()
    }
  }
}
