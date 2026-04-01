import { inflateRawSync } from "zlib";

/**
 * Minimal zip extractor for text files. No external dependencies.
 * Parses the Central Directory to find entries, then extracts stored or deflated files.
 */

interface ZipEntry {
  filename: string;
  content: string;
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
  const cdEntries = readUint16LE(zipBuffer, eocdOffset + 10);

  let offset = cdOffset;

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

    // Only extract text-like files
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const textExts = new Set(["yaml", "yml", "json", "xml", "raml", "txt", "md", "properties", "cfg", "conf"]);
    if (!textExts.has(ext)) continue;

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
        // Stored (no compression)
        content = compressedData.toString("utf-8");
      } else if (compressionMethod === 8) {
        // Deflated
        const decompressed = inflateRawSync(compressedData);
        content = decompressed.toString("utf-8");
      } else {
        continue; // Unsupported compression
      }
    } catch {
      continue; // Skip files that fail to decompress
    }

    entries.push({ filename, content });
  }

  return entries;
}
