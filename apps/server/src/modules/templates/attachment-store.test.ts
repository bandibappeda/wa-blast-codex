import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore, AttachmentValidationError } from "./attachment-store";

describe("AttachmentStore", () => {
  test("validates signatures, size, and storage traversal", async () => {
    const root = mkdtempSync(join(tmpdir(), "wa-blast-attachment-"));
    const store = new AttachmentStore({ rootPath: root, maxBytes: 64 });
    try {
      const stored = await store.put(new File(["%PDF-1.7\ncontent"], "report.pdf", { type: "text/plain" }));
      expect(stored.mimeType).toBe("application/pdf");
      await expect(store.put(new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }))).rejects.toThrow(AttachmentValidationError);
      await expect(store.put(new File(["x".repeat(65)], "large.pdf"))).rejects.toThrow("too_large");
      await expect(store.open("../outside", "application/pdf")).rejects.toThrow("unsafe_storage_key");
      await store.remove(stored.storageKey);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
