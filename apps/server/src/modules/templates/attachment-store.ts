import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const OFFICE_MIME_BY_EXTENSION: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
};

export interface StoredAttachment {
  originalName: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export class AttachmentValidationError extends Error {
  constructor(readonly code: "attachment_required" | "attachment_too_large" | "unsupported_attachment" | "unsafe_storage_key") { super(code); }
}

export class AttachmentStore {
  private readonly maxBytes: number;

  constructor(private readonly dependencies: { rootPath: string; maxBytes?: number }) {
    this.maxBytes = dependencies.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async put(file: File): Promise<StoredAttachment> {
    if (!file || file.size === 0) throw new AttachmentValidationError("attachment_required");
    if (file.size > this.maxBytes) throw new AttachmentValidationError("attachment_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = await detectMimeType(bytes, file.name);
    const extension = extensionForMime(mimeType, file.name);
    const storageKey = `${randomBytes(24).toString("base64url")}${extension}`;
    const target = this.resolve(storageKey);
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, bytes, { flag: "wx" });
    } catch (error) {
      throw error;
    }
    return {
      originalName: basename(file.name).slice(0, 255) || "attachment",
      storageKey,
      mimeType,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async open(storageKey: string, mimeType: string): Promise<Blob> {
    const bytes = await readFile(this.resolve(storageKey));
    return new Blob([bytes], { type: mimeType });
  }

  async remove(storageKey: string): Promise<void> {
    await unlink(this.resolve(storageKey));
  }

  private resolve(storageKey: string): string {
    if (!storageKey || isAbsolute(storageKey) || storageKey.includes("\\")) throw new AttachmentValidationError("unsafe_storage_key");
    const root = resolve(this.dependencies.rootPath);
    const target = resolve(root, storageKey);
    const relativeTarget = relative(root, target);
    if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new AttachmentValidationError("unsafe_storage_key");
    return target;
  }
}

async function detectMimeType(bytes: Uint8Array, originalName: string): Promise<string> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected?.mime === "image/jpeg" || detected?.mime === "image/png" || detected?.mime === "application/pdf") return detected.mime;
  const extension = extname(originalName).toLowerCase();
  const officeMime = OFFICE_MIME_BY_EXTENSION[extension];
  if (officeMime && (detected?.mime === "application/zip" || detected?.mime === "application/x-cfb")) return officeMime;
  throw new AttachmentValidationError("unsupported_attachment");
}

function extensionForMime(mimeType: string, originalName: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "application/pdf") return ".pdf";
  return extname(originalName).toLowerCase();
}
