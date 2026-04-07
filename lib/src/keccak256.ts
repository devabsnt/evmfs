let keccak256fn: ((data: Uint8Array) => Uint8Array) | null = null;
let attempted = false;
let warned = false;

async function loadKeccak256(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    const mod = await import("@noble/hashes/sha3");
    keccak256fn = mod.keccak_256;
  } catch {
    // @noble/hashes not installed — verification disabled
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function verifyHash(data: Uint8Array, expectedHash: string): Promise<boolean | null> {
  await loadKeccak256();
  if (!keccak256fn) {
    if (!warned) {
      warned = true;
      console.warn("[evmfs] @noble/hashes not installed — hash verification disabled. Install it for content integrity checks.");
    }
    return null; // cannot verify
  }
  const actual = bytesToHex(keccak256fn(data));
  return actual === expectedHash.toLowerCase();
}
