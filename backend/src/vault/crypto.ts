import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";

// Envelope encryption: the database's real encryption key (MK) is random and
// never derived live from a human secret. The password and the recovery code
// each independently "wrap" (encrypt) the SAME MK — either one can unlock,
// and losing one doesn't invalidate the other. A wrong secret fails loudly
// via the AES-GCM auth tag (see unwrapKey) — there's no separate
// password-hash table to keep in sync or leak.
//
// IMPORTANT invariant: never pass unverified key material to libSQL's
// encryptionKey against the real database file. A spike during development
// found that opening an encrypted libSQL file with the wrong key doesn't
// just fail cleanly — it can leave the file unreadable afterward, even with
// the correct key. Verification must always happen here, in memory, via
// unwrapKey's auth-tag check, before the resulting MK ever reaches db/index.ts.

const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 32; // 256-bit MK, and 256-bit KEK derived from each secret
const IV_LENGTH = 12; // AES-GCM standard nonce size
const SALT_LENGTH = 16;

export interface WrappedKey {
  salt: string; // hex
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex — the wrapped MK itself
  scryptParams: { N: number; r: number; p: number };
}

export function generateMasterKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

// Crockford base32: uppercase, excludes I/L/O/U so a handwritten or
// OCR'd transcription of a printed recovery code can't be misread.
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// 25 random bytes -> 40 base32 chars -> grouped XXXX-XXXX-... (8 groups of 5)
// for readability on a printed page. ~200 bits of entropy, comfortably more
// than the 256-bit MK it wraps needs as a practical brute-force floor.
export function generateRecoveryCode(): string {
  const raw = toBase32(randomBytes(25));
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 5) groups.push(raw.slice(i, i + 5));
  return groups.join("-");
}

function deriveKek(secret: string, salt: Buffer, params: WrappedKey["scryptParams"]): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
}

export function wrapKey(secret: string, mk: Buffer): WrappedKey {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const kek = deriveKek(secret, salt, SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(mk), cipher.final()]);
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    scryptParams: SCRYPT_PARAMS,
  };
}

// Throws (via the GCM auth-tag check inside decipher.final()) on a wrong
// secret — that failure IS the password/recovery-code verification. No
// separate check needed, and nothing here ever touches the database file.
export function unwrapKey(secret: string, wrapped: WrappedKey): Buffer {
  const salt = Buffer.from(wrapped.salt, "hex");
  const iv = Buffer.from(wrapped.iv, "hex");
  const kek = deriveKek(secret, salt, wrapped.scryptParams);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(Buffer.from(wrapped.authTag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "hex")), decipher.final()]);
}

// Constant-time compare for the browser session cookie (routes/vault.ts) — a
// plain === here would leak timing information about how many leading bytes
// matched.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// API keys (routes/vault.ts, the api_keys table): unlike the password or
// recovery code, a key is already 256 bits of uniform randomness — nothing a
// human chose, nothing guessable by trying common values — so a fast hash is
// the right call here, not scrypt. scrypt defends against someone *guessing*
// a low-entropy secret cheaply in bulk; there's no such guessing attack
// against a value this random, so paying scrypt's deliberate slowness here
// would be pure overhead with no real security benefit. Same reasoning
// GitHub/Stripe use for hashing personal access tokens.
const API_KEY_PREFIX = "cfk_"; // "copiloto financeiro key" — purely for human recognizability

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("hex");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
