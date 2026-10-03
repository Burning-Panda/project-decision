export const randomBytes = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
export const randomHex = (n: number) => randomBytes(n).toString('hex');
export const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
