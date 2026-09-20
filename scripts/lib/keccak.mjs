// Keccak-256, as Ethereum uses it.
//
// This exists so the delegation snapshot can talk to the Flare RPC without a
// dependency: the repo has no package.json and every other script runs on a
// bare `node`, so pulling in ethers just to hash two constant strings would be
// the largest change in the tree. Only event topics and function selectors are
// hashed here - a few short strings per run - so clarity beats speed and the
// lanes are plain BigInt.
//
// Note this is Keccak (0x01 padding), not the later NIST SHA-3 (0x06). The
// self-test at the bottom of the file pins that difference.

const MASK = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

// Rho offsets, indexed by lane = x + 5y.
const R = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
];

const rotl = (lane, n) => n === 0 ? lane : ((lane << BigInt(n)) | (lane >> BigInt(64 - n))) & MASK;

function keccakF(A) {
  const B = new Array(25).fill(0n);
  const C = new Array(5).fill(0n);
  const D = new Array(5).fill(0n);

  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1) {
      C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) A[x + 5 * y] ^= D[x];
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], R[x + 5 * y]);
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
      }
    }

    A[0] ^= RC[round];
  }
}

/** Keccak-256 of a byte array, returned as 32 bytes. */
export function keccak256Bytes(input) {
  const RATE = 136;
  const bytes = Uint8Array.from(input);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] |= 0x01;
  padded[padded.length - 1] |= 0x80;

  const A = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane += 1) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      }
      A[lane] ^= value;
    }
    keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let value = A[lane];
    for (let byte = 0; byte < 8; byte += 1) {
      out[lane * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return out;
}

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");

/** Keccak-256 of an ASCII string, as an 0x-prefixed hex digest. */
export function keccak256(text) {
  return `0x${hex(keccak256Bytes(new TextEncoder().encode(text)))}`;
}

/** The 32-byte log topic for an event signature, e.g. "Delegate(address,address,uint256,uint256)". */
export const eventTopic = signature => keccak256(signature);

/** The 4-byte call selector for a function signature, e.g. "votePowerFromTo(address,address)". */
export const selector = signature => keccak256(signature).slice(0, 10);

// Two published vectors, checked on import. A silently wrong hash would show up
// downstream as an empty log scan or a reverted call, which is a miserable way
// to find out the padding constant was 0x06.
const VECTORS = [
  ["", "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  ["Transfer(address,address,uint256)", "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
  ["abc", "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"]
];
for (const [input, expected] of VECTORS) {
  const got = keccak256(input);
  if (got !== expected) {
    throw new Error(`keccak256 self-test failed for ${JSON.stringify(input)}: ${got} != ${expected}`);
  }
}
