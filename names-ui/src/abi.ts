// V2 register/update take no block arg (V2 reads block from EVMFSV2 storage).
export const NAMES_V2_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "siteName", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "update",
    inputs: [
      { name: "siteName", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "lookup",
    inputs: [{ name: "siteName", type: "string" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "blockNumber", type: "uint64" },
      { name: "manifestHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "REGISTRATION_FEE",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "SiteUpdated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "siteName", type: "string", indexed: false },
      { name: "blockNumber", type: "uint64", indexed: false },
      { name: "manifestHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

// V1 register/update take (name, block, manifest).
export const NAMES_V1_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "siteName", type: "string" },
      { name: "blockNumber", type: "uint64" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "update",
    inputs: [
      { name: "siteName", type: "string" },
      { name: "blockNumber", type: "uint64" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "lookup",
    inputs: [{ name: "siteName", type: "string" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "blockNumber", type: "uint64" },
      { name: "manifestHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "REGISTRATION_FEE",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "names",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sites",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "blockNumber", type: "uint64" },
      { name: "manifestHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "SiteUpdated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "siteName", type: "string", indexed: false },
      { name: "blockNumber", type: "uint64", indexed: false },
      { name: "manifestHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

// Backwards compat for any external imports of NAMES_ABI.
export const NAMES_ABI = NAMES_V1_ABI;

export const NAMES_V2_ADDRESS = "0x86342282edF4A1c50249f16f4Cb11C5921455730" as const;
export const NAMES_V1_ADDRESS = "0x36043906ba7c191c9511a60a8b28e3a602ed1477" as const;

export type ContractVersion = "v2" | "v1";

export function namesAddress(v: ContractVersion): `0x${string}` {
  return (v === "v2" ? NAMES_V2_ADDRESS : NAMES_V1_ADDRESS) as `0x${string}`;
}
