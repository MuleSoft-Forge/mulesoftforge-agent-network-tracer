import { inflateRawSync } from "zlib";

/**
 * Minimal zip extractor for text files. No external dependencies.
 * Parses the Central Directory to find entries, then extracts stored or deflated files.
 */

interface ZipEntry {
  filename: string;
  content: string;
}

/** Zip-bomb / DoS guards. Decompression happens in-memory, so we cap aggressively. */
const MAX_ENTRIES = 2000;
const MAX_ENTRY_DECOMPRESSED_BYTES = 16 * 1024 * 1024; // 16 MB per file
const MAX_TOTAL_DECOMPRESSED_BYTES = 64 * 1024 * 1024; // 64 MB total

/** Max compressed zip we will pull into memory before extracting. */
export const MAX_ZIP_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Read a fetch Response body into a Buffer, refusing payloads larger than
 * `maxBytes`. Checks the advertised Content-Length first, then enforces the cap
 * while streaming (so a lying/absent header can't blow past the limit). Returns
 * null when the limit is exceeded.
 */
export async function readBodyWithLimit(
  res: Response,
  maxBytes: number = MAX_ZIP_DOWNLOAD_BYTES
): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

function readUint16LE(buf: Buffer, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUint32LE(buf: Buffer, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      ((buf[offset + 3] << 24) >>> 0)) >>>
    0
  );
}

/**
 * Extract all text files from a zip buffer.
 * Skips directories and binary files.
 */
export function extractTextFiles(zipBuffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // Find End of Central Directory record (search backwards for signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (readUint32LE(zipBuffer, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) return entries;

  const cdOffset = readUint32LE(zipBuffer, eocdOffset + 16);
  const cdEntries = Math.min(readUint16LE(zipBuffer, eocdOffset + 10), MAX_ENTRIES);

  let offset = cdOffset;
  let totalDecompressed = 0;

  for (let i = 0; i < cdEntries; i++) {
    if (offset + 46 > zipBuffer.length) break;
    if (readUint32LE(zipBuffer, offset) !== 0x02014b50) break;

    const compressionMethod = readUint16LE(zipBuffer, offset + 10);
    const compressedSize = readUint32LE(zipBuffer, offset + 20);
    const uncompressedSize = readUint32LE(zipBuffer, offset + 24);
    const filenameLen = readUint16LE(zipBuffer, offset + 28);
    const extraLen = readUint16LE(zipBuffer, offset + 30);
    const commentLen = readUint16LE(zipBuffer, offset + 32);
    const localHeaderOffset = readUint32LE(zipBuffer, offset + 42);

    const filename = zipBuffer.subarray(offset + 46, offset + 46 + filenameLen).toString("utf-8");

    offset += 46 + filenameLen + extraLen + commentLen;

    // Skip directories
    if (filename.endsWith("/")) continue;

    // Only extract text-like files. `agent` is AgentScript source
    // (network zips ship it under `brokers/*.agent`).
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const textExts = new Set(["yaml", "yml", "json", "xml", "raml", "txt", "md", "properties", "cfg", "conf", "agent"]);
    if (!textExts.has(ext)) continue;

    // Skip entries that declare an oversized uncompressed payload (zip-bomb guard).
    if (uncompressedSize > MAX_ENTRY_DECOMPRESSED_BYTES) continue;

    // Read from local file header
    if (localHeaderOffset + 30 > zipBuffer.length) continue;
    if (readUint32LE(zipBuffer, localHeaderOffset) !== 0x04034b50) continue;

    const localFilenameLen = readUint16LE(zipBuffer, localHeaderOffset + 26);
    const localExtraLen = readUint16LE(zipBuffer, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraLen;

    if (dataOffset + compressedSize > zipBuffer.length) continue;

    const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);

    let content: string;
    try {
      if (compressionMethod === 0) {
        // Stored (no compression) — cap to the per-entry budget.
        if (compressedData.length > MAX_ENTRY_DECOMPRESSED_BYTES) continue;
        content = compressedData.toString("utf-8");
      } else if (compressionMethod === 8) {
        // Deflated — `maxOutputLength` makes inflate throw if a lying header
        // tries to expand past the cap, defeating zip bombs.
        const decompressed = inflateRawSync(compressedData, {
          maxOutputLength: MAX_ENTRY_DECOMPRESSED_BYTES,
        });
        content = decompressed.toString("utf-8");
      } else {
        continue; // Unsupported compression
      }
    } catch {
      continue; // Skip files that fail to decompress (or exceed the cap)
    }

    totalDecompressed += Buffer.byteLength(content, "utf-8");
    if (totalDecompressed > MAX_TOTAL_DECOMPRESSED_BYTES) break;

    entries.push({ filename, content });
  }

  return entries;
}
