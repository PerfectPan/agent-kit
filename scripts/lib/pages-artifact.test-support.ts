import { crc32, deflateRawSync } from "node:zlib";

export const SHA = "a".repeat(40);

interface ZipFile {
  name: string;
  value: string;
  mode?: number;
  size?: number;
  checksum?: number;
}

/** Includes streaming data descriptors, as emitted by upload-artifact's ZIP writer. */
export function zip(files: ZipFile[], deflate = false): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.value);
    const compressed = deflate ? deflateRawSync(data) : data;
    const checksum = file.checksum ?? crc32(data);
    const size = file.size ?? data.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x808, 6);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(size, 12);
    local.push(header, name, compressed, descriptor);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x808, 8);
    record.writeUInt16LE(deflate ? 8 : 0, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((file.mode ?? 0x81a4) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function archive(extra: ZipFile[] = [], number: unknown = 215, sha = SHA, deflate = false): Buffer {
  return zip(
    [
      { name: "metadata.json", value: JSON.stringify({ pr_number: number, head_sha: sha }) },
      { name: "site/index.html", value: "<h1>Preview</h1>" },
      { name: "site/.nojekyll", value: "" },
      ...extra
    ],
    deflate
  );
}
