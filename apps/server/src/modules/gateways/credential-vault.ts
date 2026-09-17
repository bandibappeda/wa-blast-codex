export class CredentialVault {
  private readonly keyPromise: Promise<CryptoKey> | null;

  constructor(encodedKey?: string) {
    this.keyPromise = encodedKey ? importKey(encodedKey) : null;
  }

  async encrypt(credentials: Record<string, string>): Promise<string> {
    const key = await this.requireKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(JSON.stringify(credentials)));
    return ["v1", encode(iv), encode(new Uint8Array(encrypted))].join(".");
  }

  async decrypt(payload: string): Promise<Record<string, string>> {
    const key = await this.requireKey();
    const [version, encodedIv, encodedCiphertext] = payload.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new Error("invalid_credential_payload");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(encodedIv) as unknown as BufferSource }, key, decode(encodedCiphertext) as unknown as BufferSource);
    return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, string>;
  }

  private async requireKey(): Promise<CryptoKey> {
    if (!this.keyPromise) throw new Error("gateway_encryption_key_required");
    return this.keyPromise;
  }
}

async function importKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = decode(encodedKey);
  if (bytes.byteLength !== 32) throw new Error("gateway_encryption_key_must_be_32_bytes");
  return crypto.subtle.importKey("raw", bytes as unknown as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function encode(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
function decode(value: string): Uint8Array { return new Uint8Array(Buffer.from(value, "base64url")); }
