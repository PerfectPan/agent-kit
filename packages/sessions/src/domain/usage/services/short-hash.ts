/** The length of a `shortHash`. */
export const SHORT_HASH_LENGTH = 9;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A 54-bit hash of a key in 9 base64url characters (the public-domain cyrb53 mixing), so a cursor or a scan state can
 * remember request ids compactly. Two of n keys collide with a chance of about n² / 2^55: for the 75 000 requests of a
 * busy month, one in 6 million; for a million, one in 36 000.
 */
export function shortHash(key: string): string {
  let h1 = 0xde_ad_be_ef;
  let h2 = 0x41_c6_ce_57;
  for (let at = 0; at < key.length; at++) {
    const code = key.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const word of [h1 >>> 0, h2 >>> 0]) {
    for (let shift = 24; shift >= 0; shift -= 8) {
      value = (value << 8) | ((word >>> shift) & 0xff);
      bits += 8;
      while (bits >= 6) {
        bits -= 6;
        out += BASE64URL[(value >>> bits) & 0x3f];
      }
      value &= (1 << bits) - 1;
    }
  }
  return (out + BASE64URL[(value << (6 - bits)) & 0x3f]!).slice(0, SHORT_HASH_LENGTH);
}
