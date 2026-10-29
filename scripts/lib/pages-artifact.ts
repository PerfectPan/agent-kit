import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

interface Entry {
  name: string;
  directory: boolean;
  size: number;
  compressedSize: number;
  checksum: number;
  flags: number;
  method: number;
  offset: number;
  nameBytes: Buffer;
}

// Privileged jobs install no dependencies. Read only the bounded, single-disk stored/deflated ZIP
// format produced by upload-artifact; reject encryption, ZIP64 and unsupported methods explicitly.
function entriesOf(archive: Buffer): { entries: Entry[]; directoryOffset: number } {
  assert(archive.length <= MAX_ARTIFACT_BYTES, "Artifact is too large");
  let end = archive.length - 22;
  const minimum = Math.max(0, end - 65_535);
  while (end >= minimum) {
    if (archive.readUInt32LE(end) === 0x06054b50 && end + 22 + archive.readUInt16LE(end + 20) === archive.length) {
      break;
    }
    end -= 1;
  }
  assert(end >= minimum, "Missing ZIP directory");
  const count = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryOffset = archive.readUInt32LE(end + 16);
  assert(
    archive.readUInt16LE(end + 4) === 0 &&
      archive.readUInt16LE(end + 6) === 0 &&
      archive.readUInt16LE(end + 8) === count &&
      count <= MAX_ENTRIES &&
      directoryOffset + directorySize === end,
    "Unsupported or oversized ZIP directory"
  );
  const entries: Entry[] = [];
  const seen = new Map<string, boolean>();
  let cursor = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    assert(cursor + 46 <= end && archive.readUInt32LE(cursor) === 0x02014b50, "Invalid ZIP entry");
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const mode = (archive.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    const offset = archive.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    assert(next <= end && archive.readUInt16LE(cursor + 34) === 0, "Invalid ZIP entry bounds");
    assert((flags & ~0x080e) === 0 && (method === 0 || method === 8), "Unsupported ZIP encoding");
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const rawName = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const directory = rawName.endsWith("/");
    const name = directory ? rawName.slice(0, -1) : rawName;
    const parts = name.split("/");
    assert(
      name &&
        !seen.has(name) &&
        !name.includes("\\") &&
        !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
        !parts.some((part) => part === "" || part === "." || part === "..") &&
        !parts.some((part) => part.startsWith(".") && part !== ".nojekyll") &&
        (mode === 0 || mode === 0x8000 || mode === 0x4000) &&
        (name === "metadata.json" || parts[0] === "site") &&
        !(name === "metadata.json" && directory) &&
        !(name === "site/pr-preview" || name.startsWith("site/pr-preview/")),
      "Unsafe artifact entry"
    );
    total += size;
    assert(total <= MAX_ARTIFACT_BYTES && compressedSize <= MAX_ARTIFACT_BYTES, "Artifact is too large");
    seen.set(name, directory);
    entries.push({
      name,
      directory,
      size,
      compressedSize,
      flags,
      method,
      offset,
      nameBytes,
      checksum: archive.readUInt32LE(cursor + 16)
    });
    cursor = next;
  }
  assert(cursor === end, "Invalid ZIP directory size");
  for (const entry of entries) {
    const parts = entry.name.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth).join("/");
      assert(!seen.has(parent) || seen.get(parent), "ZIP path conflict");
    }
  }
  return { entries, directoryOffset };
}

function contentOf(archive: Buffer, entry: Entry, directoryOffset: number): Buffer {
  const { offset } = entry;
  assert(offset + 30 <= directoryOffset && archive.readUInt32LE(offset) === 0x04034b50, "Invalid ZIP local header");
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  assert(
    start + entry.compressedSize <= directoryOffset &&
      archive.readUInt16LE(offset + 6) === entry.flags &&
      archive.readUInt16LE(offset + 8) === entry.method &&
      archive.subarray(offset + 30, offset + 30 + nameLength).equals(entry.nameBytes),
    "ZIP local header mismatch"
  );
  const compressed = archive.subarray(start, start + entry.compressedSize);
  const content =
    entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
  assert(content.length === entry.size && crc32(content) === entry.checksum, "ZIP content size or checksum mismatch");
  assert(!entry.directory || content.length === 0, "ZIP directory contains data");
  return content;
}

/** Validate the entire artifact before writing; restore neither executable modes nor links. */
export function unpackArtifact(archive: Buffer, destination: string, sha: string, preview: boolean): number {
  const { entries, directoryOffset } = entriesOf(archive);
  const metadataEntry = entries.find((entry) => entry.name === "metadata.json");
  assert(metadataEntry && metadataEntry.size <= 1024, "Missing or oversized metadata");
  const metadata: unknown = JSON.parse(contentOf(archive, metadataEntry, directoryOffset).toString("utf8"));
  // No schema dependency can be loaded in the trusted sparse checkout; validate just these two fields.
  assert(
    metadata !== null && typeof metadata === "object" && "pr_number" in metadata && "head_sha" in metadata,
    "Invalid metadata"
  );
  const number = metadata.pr_number;
  assert(
    typeof number === "number" &&
      Number.isInteger(number) &&
      number >= (preview ? 1 : 0) &&
      number <= 2_147_483_647 &&
      (preview || number === 0) &&
      typeof metadata.head_sha === "string" &&
      /^[0-9a-f]{40}$/u.test(metadata.head_sha) &&
      metadata.head_sha === sha,
    "Artifact PR number or head SHA does not match the triggering run"
  );
  assert(
    entries.some((entry) => entry.name === "site/index.html" && !entry.directory),
    "Artifact has no site/index.html file"
  );
  const contents = entries.map((entry) => contentOf(archive, entry, directoryOffset));
  for (const [index, entry] of entries.entries()) {
    const target = join(destination, entry.name);
    if (entry.directory) {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents[index]!, { flag: "wx", mode: 0o644 });
    }
  }
  return number;
}
