import { describe, expect, it } from "vitest";
import { open, rewrap, seal } from "@/server/crypto/envelope";
import { LocalKeyWrapper } from "@/server/crypto/key-wrapper";

const ring = new LocalKeyWrapper({ "local-v1": "key one" }, "local-v1");

describe("envelope encryption (CRED-3)", () => {
  it("round-trips a secret", async () => {
    const sealed = await seal(ring, "hunter2-password", "credential:1");
    expect(await open(ring, sealed, "credential:1")).toBe("hunter2-password");
  });

  it("stores no plaintext and uses a fresh data key each time", async () => {
    const a = await seal(ring, "hunter2-password", "credential:1");
    const b = await seal(ring, "hunter2-password", "credential:1");
    expect(a.ciphertext.toString("utf8")).not.toContain("hunter2");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.keyVersion).toBe("local-v1");
  });

  it("won't decrypt ciphertext moved to another row", async () => {
    const sealed = await seal(ring, "secret-value", "credential:1");
    await expect(open(ring, sealed, "credential:2")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const sealed = await seal(ring, "secret-value", "credential:1");
    sealed.ciphertext[sealed.ciphertext.length - 1] ^= 1;
    await expect(open(ring, sealed, "credential:1")).rejects.toThrow();
  });

  it("rotation re-wraps the data key with the new version without touching the secret", async () => {
    const sealed = await seal(ring, "secret-value", "credential:1");
    const rotated = new LocalKeyWrapper({ "local-v1": "key one", "local-v2": "key two" }, "local-v2");
    const rewrapped = await rewrap(rotated, sealed);
    expect(rewrapped.keyVersion).toBe("local-v2");
    expect(rewrapped.ciphertext.equals(sealed.ciphertext)).toBe(true);
    const onlyV2 = new LocalKeyWrapper({ "local-v2": "key two" }, "local-v2");
    expect(await open(onlyV2, rewrapped, "credential:1")).toBe("secret-value");
    await expect(open(onlyV2, sealed, "credential:1")).rejects.toThrow();
  });
});
