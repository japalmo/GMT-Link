// UUID v4 helper with broad browser support.
// Uses `crypto.randomUUID()` when available; otherwise falls back to
// `crypto.getRandomValues()` (or Math.random as a last resort).

function toHex(byte) {
  return byte.toString(16).padStart(2, '0');
}

export function randomUUID() {
  const cryptoObj = globalThis?.crypto;

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Very old environments: non-cryptographic fallback.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 variant and version bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, toHex).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
