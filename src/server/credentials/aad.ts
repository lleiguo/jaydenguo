// Additional authenticated data for a credential's ciphertext: binds it to
// its row (spec §7.3).
export const aadFor = (id: string) => `credential:${id}`;
