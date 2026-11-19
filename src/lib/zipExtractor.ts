export interface ExtractedZipFile {
  name: string;
  text: string;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isSupportedInvoiceEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (!name || name.endsWith('/')) return false;
  if (lower.startsWith('__macosx/') || lower.includes('/__macosx/')) return false;
  const baseName = lower.split('/').pop() || lower;
  if (baseName.startsWith('._')) return false;
  return lower.endsWith('.xml') || lower.endsWith('.ubl');
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Tarayıcınız ZIP arşiv açma (DecompressionStream) özelliğini desteklemiyor. Lütfen XML dosyalarını çıkartıp yükleyiniz.'
    );
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  await writer.write(copy);
  await writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.byteLength;
    }
  }

  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (readUint32LE(view, i) === END_OF_CENTRAL_DIR_SIG) {
      return i;
    }
  }
  return -1;
}

/**
 * İstemci tarafında ekstra paket gerektirmeden .zip arşivlerindeki .xml ve .ubl fatura dosyalarını açar.
 * Central Directory kullanarak data descriptor (flag bit 3) kullanan GİB/Java ZIP arşivlerini de güvenle okur.
 */
export async function extractXmlFilesFromZip(buffer: ArrayBuffer): Promise<ExtractedZipFile[]> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22) {
    throw new Error('Geçersiz veya boş ZIP arşivi.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const results: ExtractedZipFile[] = [];

  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  if (eocdOffset >= 0) {
    const totalEntries = readUint16LE(view, eocdOffset + 10);
    const centralDirOffset = readUint32LE(view, eocdOffset + 16);
    let ptr = centralDirOffset;

    for (let idx = 0; idx < totalEntries && ptr + 46 <= bytes.length; idx++) {
      if (readUint32LE(view, ptr) !== CENTRAL_DIR_HEADER_SIG) break;
      const compressionMethod = readUint16LE(view, ptr + 10);
      const compressedSize = readUint32LE(view, ptr + 20);
      const nameLength = readUint16LE(view, ptr + 28);
      const extraLength = readUint16LE(view, ptr + 30);
      const commentLength = readUint16LE(view, ptr + 32);
      const localHeaderOffset = readUint32LE(view, ptr + 42);

      const nameBytes = bytes.subarray(ptr + 46, ptr + 46 + nameLength);
      const entryName = decoder.decode(nameBytes);
      ptr += 46 + nameLength + extraLength + commentLength;

      if (!isSupportedInvoiceEntry(entryName)) continue;
      if (localHeaderOffset + 30 > bytes.length) continue;
      if (readUint32LE(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) continue;

      const localNameLen = readUint16LE(view, localHeaderOffset + 26);
      const localExtraLen = readUint16LE(view, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) continue;

      const payload = bytes.subarray(dataStart, dataEnd);
      let rawContent: Uint8Array;

      if (compressionMethod === 0) {
        rawContent = payload;
      } else if (compressionMethod === 8) {
        rawContent = await inflateRawBytes(payload);
      } else {
        throw new Error(`"${entryName}" desteklenmeyen ZIP sıkıştırma yöntemi (${compressionMethod}) kullanıyor.`);
      }

      results.push({
        name: entryName.split('/').pop() || entryName,
        text: stripUtf8Bom(decoder.decode(rawContent)),
      });
    }

    return results;
  }

  // Fallback: Doğrudan local file header taraması (size alanları dolu basit arşivler için)
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (readUint32LE(view, offset) !== LOCAL_FILE_HEADER_SIG) break;
    const compressionMethod = readUint16LE(view, offset + 8);
    const compressedSize = readUint32LE(view, offset + 18);
    const nameLen = readUint16LE(view, offset + 26);
    const extraLen = readUint16LE(view, offset + 28);
    const entryName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) break;

    if (isSupportedInvoiceEntry(entryName)) {
      const payload = bytes.subarray(dataStart, dataEnd);
      const rawContent =
        compressionMethod === 0
          ? payload
          : compressionMethod === 8
          ? await inflateRawBytes(payload)
          : null;
      if (rawContent) {
        results.push({
          name: entryName.split('/').pop() || entryName,
          text: stripUtf8Bom(decoder.decode(rawContent)),
        });
      }
    }
    offset = dataEnd;
  }

  return results;
}
