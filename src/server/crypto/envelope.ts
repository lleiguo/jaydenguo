import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyWrapper } from "./key-wrapper";

// Envelope encryption for stored credentials (spec §7.3, CRED-3): every
// secret gets its own random AES-256-GCM data key, and only the wrapped data
// key is stored. `aad` binds the ciphertext to its row, so ciphertext copied
// to another row won't decrypt.

export type SealedSecret = { ciphertext: Buffer; wrappedDek: Buffer; keyVersion: string };

export async function seal(wrapper: KeyWrapper, plaintext: string, aad: string): Promise<SealedSecret> {
  const dek = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const { wrapped, keyVersion } = await wrapper.wrap(dek);
    return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]), wrappedDek: wrapped, keyVersion };
  } finally {
    dek.fill(0);
  }
}

// Only the worker calls this (see eslint.config.mjs: web code may not import
// this module's `open`).
export async function open(wrapper: KeyWrapper, sealed: SealedSecret, aad: string): Promise<string> {
  const dek = await wrapper.unwrap(sealed.wrappedDek, sealed.keyVersion);
  try {
    const iv = sealed.ciphertext.subarray(0, 12);
    const tag = sealed.ciphertext.subarray(12, 28);
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed.ciphertext.subarray(28)), decipher.final()]).toString(
      "utf8",
    );
  } finally {
    dek.fill(0);
  }
}

// Key rotation (plan M1.2): unwrap the data key and wrap it again with the
// current key version. The secret itself is never decrypted.
export async function rewrap(wrapper: KeyWrapper, sealed: SealedSecret): Promise<SealedSecret> {
  const dek = await wrapper.unwrap(sealed.wrappedDek, sealed.keyVersion);
  try {
    const { wrapped, keyVersion } = await wrapper.wrap(dek);
    return { ciphertext: sealed.ciphertext, wrappedDek: wrapped, keyVersion };
  } finally {
    dek.fill(0);
  }
}
