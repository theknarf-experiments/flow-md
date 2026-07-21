// A ULID: 48 bits of millisecond timestamp, 80 bits of randomness, in
// Crockford's base32. Sorts by creation time as a string, which is why it's
// worth the eight extra characters over a random id — a file full of them
// reads in the order the tabs were opened.
//
// Twenty-six characters, no dependency: the whole algorithm is two loops.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let random = ''
  for (let i = 0; i < 16; i++) random += CROCKFORD[bytes[i]! % 32]
  return time + random
}
