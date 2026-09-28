// Additional authenticated data for a credential's ciphertext: binds it to
// its row (spec §7.3).
export const aadFor = (id: string) => `credential:${id}`;

// The same for a credential's sealed session extras (browser cookies, a
// typed sign-in code).
export const sessionAadFor = (id: string, kind: "browser" | "code") => `credential-session:${id}:${kind}`;
