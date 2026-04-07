export const NAMES_ABI = [
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
