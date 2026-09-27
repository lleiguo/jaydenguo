import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Wraps and unwraps data keys with the key-encryption key (spec §7.3). In
// production that key lives only in Cloud KMS; local runs and tests use a
// local key behind the same interface (spec §5.2).
export interface KeyWrapper {
  wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyVersion: string }>;
  unwrap(wrapped: Buffer, keyVersion: string): Promise<Buffer>;
}

// Cloud KMS. IAM decides what each service may do: the web service account
// can only encrypt (wrap), the worker can only decrypt (unwrap) (CRED-4).
export class KmsKeyWrapper implements KeyWrapper {
  constructor(private readonly keyName: string) {}

  private async client() {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    return new KeyManagementServiceClient();
  }

  async wrap(dek: Buffer) {
    const kms = await this.client();
    try {
      const [res] = await kms.encrypt({ name: this.keyName, plaintext: dek });
      // res.name is the key version that did the wrapping.
      return { wrapped: Buffer.from(res.ciphertext as Uint8Array), keyVersion: res.name ?? this.keyName };
    } finally {
      await kms.close();
    }
  }

  async unwrap(wrapped: Buffer) {
    const kms = await this.client();
    try {
      // KMS finds the version from the ciphertext itself.
      const [res] = await kms.decrypt({ name: this.keyName, ciphertext: wrapped });
      return Buffer.from(res.plaintext as Uint8Array);
    } finally {
      await kms.close();
    }
  }
}

// Local development keys: AES-256-GCM keys derived from LOCAL_KEK, or a fixed
// development key. A keyring of versions, like KMS, so rotation can be tested
// locally. Never used when KMS_KEY is set.
export class LocalKeyWrapper implements KeyWrapper {
  private readonly keys: Map<string, Buffer>;
  constructor(
    ring: Record<string, string>,
    private readonly current: string,
  ) {
    this.keys = new Map(
      Object.entries(ring).map(([v, secret]) => [v, createHash("sha256").update(secret).digest()]),
    );
    if (!this.keys.has(current)) throw new Error(`no local key ${current}`);
  }

  async wrap(dek: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.current)!, iv);
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return { wrapped: Buffer.concat([iv, cipher.getAuthTag(), body]), keyVersion: this.current };
  }

  async unwrap(wrapped: Buffer, keyVersion: string) {
    const key = this.keys.get(keyVersion);
    if (!key) throw new Error(`unknown local key version ${keyVersion}`);
    const decipher = createDecipheriv("aes-256-gcm", key, wrapped.subarray(0, 12));
    decipher.setAuthTag(wrapped.subarray(12, 28));
    return Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]);
  }
}

export function defaultKeyWrapper(): KeyWrapper {
  const kmsKey = process.env.KMS_KEY;
  if (kmsKey) return new KmsKeyWrapper(kmsKey);
  // Production runs on Cloud Run, which always sets K_SERVICE or
  // CLOUD_RUN_JOB; the local key must never be used there.
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) throw new Error("KMS_KEY must be set on Cloud Run");
  return new LocalKeyWrapper(
    { "local-v1": process.env.LOCAL_KEK ?? "dev-only-local-key-encryption-key" },
    "local-v1",
  );
}
