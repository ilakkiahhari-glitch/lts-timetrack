// No look-alike characters (0/O, 1/l/I), so a password read out or typed from paper is not misread.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A random password made with the browser's secure random generator. */
export function generatePassword(length = 14): string {
  const limit = 256 - (256 % ALPHABET.length) // reject values that would make some characters likelier
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length]
    }
  }
  return out
}
