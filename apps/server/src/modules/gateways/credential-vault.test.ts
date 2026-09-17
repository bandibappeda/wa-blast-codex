import { describe, expect, test } from "bun:test";
import { CredentialVault } from "./credential-vault";

const key = Buffer.from("01234567890123456789012345678901").toString("base64");

describe("CredentialVault", () => {
  test("round trips with a fresh nonce for every encryption", async () => {
    const vault = new CredentialVault(key);
    const first = await vault.encrypt({ token: "secret", account: "mock" });
    const second = await vault.encrypt({ token: "secret", account: "mock" });

    expect(first).not.toBe(second);
    expect(await vault.decrypt(first)).toEqual({ token: "secret", account: "mock" });
    expect(await vault.decrypt(second)).toEqual({ token: "secret", account: "mock" });
  });

  test("rejects wrong keys, tampering, and invalid key lengths", async () => {
    const vault = new CredentialVault(key);
    const payload = await vault.encrypt({ token: "secret" });
    const wrongKey = new CredentialVault(Buffer.from("abcdefghijklmnopqrstuvwxyz123456").toString("base64"));

    await expect(wrongKey.decrypt(payload)).rejects.toThrow();
    const parts = payload.split(".");
    parts[2] = `${parts[2]}a`;
    await expect(vault.decrypt(parts.join("."))).rejects.toThrow();
    await expect(new CredentialVault(Buffer.from("short").toString("base64")).encrypt({})).rejects.toThrow("32_bytes");
  });
});
