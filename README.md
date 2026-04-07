# EVMFS

**Ethereum-native permanent storage.**

Event logs have always been a permanent storage primitive baked into Ethereum's consensus layer. Every log is part of the receipt trie, replicated across every archive node, validated by every full node, and required for chain verification. They are as durable as the chain itself - and vastly cheaper than contract storage.

Nobody wrapped a proper product around this. EVMFS is that product.

It was designed primarily to make NFT metadata cheap to store fully on-chain; images, JSON, attributes, everything - at a fraction of the cost of alternatives, with none of the dependency risk. But nothing about the protocol is NFT-specific. Anything you can represent as bytes works: documents, provenance records, certificates, snapshots, data archives.

---

## What EVMFS actually is

A 31-line Solidity contract that emits events containing your (gzipped) file bytes. LOG opcodes cost ~8 gas per byte: roughly **2,500× cheaper than SSTORE** for bulk data. Files are content-addressed via keccak256 hash. A manifest transaction binds N files into a single hash, producing a URI that drops straight into an ERC-721 `baseURI()`:

```
https://evmfs.xyz/{chainId}/{manifestBlock}/{manifestHash}/
```

Nothing novel in the underlying mechanic. What's different is that the upload tooling, gateway, web UI and manifest format already exist and work - so you can actually use this primitive without writing 2,000 lines of glue code yourself.

---

## What it costs

Rough ballpark for **10,000 small files** (~400 bytes/file gzipped, batched efficiently):

| Gas price | Cost (ETH) | Cost @ $2,500/ETH |
|-----------|-----------|--------------------|
| 0.1 gwei  | ~0.011 ETH | ~$27.50           |
| 1 gwei    | ~0.11 ETH  | ~$275             |
| 10 gwei   | ~1.1 ETH   | ~$2,750           |

At the small end, a **single 2 KB metadata JSON** costs ~76,000 gas — roughly **$0.02 at 0.1 gwei / $2,500 ETH**, or ~$1.90 at 10 gwei. That's the realistic floor for entry-level use.

A **1,000-file batch** is roughly 1/10th of the 10k numbers. A **single 10 KB image** costs ~260,000 gas — about **$0.65 at 1 gwei / $2,500 ETH**, or ~$6.50 at 10 gwei.

This is a **one-time cost**. Nothing ever expires. There is no pinning service, no endowment, no ongoing fee.

### A note on fees

**The EVMFS contract charges no fees.** It has no admin key, no fee switch, no mechanism anyone can flip later to extract value at the protocol level — the contract is immutable and owner-less by design.

The hosted frontend at **evmfs.xyz includes a small convenience fee** on uploads to sustain hosting and development. **Direct contract interaction, the CLI, and self-hosted deployments of the frontend are always free.** If you don't want to pay the convenience fee, clone the repo and upload directly — the contract doesn't know or care who's calling it.

This is the same pattern Uniswap uses: free contract, hosted frontend earns its keep. You're paying for convenience, not for access. The worst case is the frontend fee changes and someone forks the UI — which is fine, because that's how open infrastructure should work.

### Where EVMFS makes sense

- NFT metadata and images (the primary design target)
- Provenance records, certificates, small documents
- Anything you want genuinely immutable and chain-verifiable
- Data that should remain retrievable for as long as Ethereum exists

### Where it doesn't

- **Large files** at scale. Files over ~100 KB are chunked across multiple transactions (the client splits, the gateway reassembles — no contract change required), so size isn't a hard limit, but cost scales linearly with bytes. A 1 MB file costs roughly $65–$300+ at typical gas prices; a 3 MB file runs into the low hundreds of dollars even at moderate gas. For video, audio, or high-res imagery at volume, evaluate whether the trust tradeoff of an external storage network is acceptable — EVMFS is optimized for cases where on-chain permanence is worth a premium per byte.
- **Mutable content**. EVMFS has no delete, no update. Content addressing is the feature.
- **Private data**. Event logs are public. Encrypt first if you need privacy.

---

## Quick start

### CLI

```bash
# Install
npm install -g evmfs-cli

# Set env vars (or pass as flags)
export EVMFS_RPC=https://eth.llamarpc.com
export EVMFS_PRIVATE_KEY=0x...
export EVMFS_CONTRACT=0x140cbDFf649929D003091a5B8B3be34588753aBA

# Deploy a static site (preserves file paths)
evmfs deploy --folder ./dist

# Upload files (numeric indices, for NFT metadata)
evmfs upload --folder ./metadata

# Verify / inspect
evmfs verify --hash 0x...
evmfs info --hash 0x...
```

Or run without installing: `npx evmfs-cli deploy --folder ./dist`

#### Environment variables

All flags can be set via environment variables. Flags override env vars when both are present.

| Env variable | Flag | Default |
|---|---|---|
| `EVMFS_RPC` | `--rpc` | *(required)* |
| `EVMFS_PRIVATE_KEY` | `--private-key` | *(required)* |
| `EVMFS_CONTRACT` | `--contract` | — |
| `EVMFS_CHAIN_ID` | `--chain-id` | `1` |
| `EVMFS_GATEWAY` | `--gateway` | `https://evmfs.xyz` |
| `EVMFS_GAS_LIMIT` | `--gas-limit` | `25000000` |

#### Static site hosting

`evmfs deploy` recursively walks a folder and stores each file with its relative path in the manifest. The gateway serves files by path with extension-based content types and SPA fallback:

```
https://evmfs.xyz/{chainId}/{block}/{manifestHash}/index.html
https://evmfs.xyz/{chainId}/{block}/{manifestHash}/assets/style.css
```

### Web UI

1. Go to https://evmfs.xyz
2. Connect wallet (MetaMask, WalletConnect, etc.) or paste a private key for auto-signing thousands of files
3. Choose **Upload files** (NFT metadata) or **Deploy site** (static site with paths)
4. Drop your files or folder
5. Review the live cost estimate (fetches gas price + ETH price every 30s)
6. Click Upload — batches sign one at a time, progress saves to localStorage so you can resume if interrupted
7. Copy the base URI and paste it into your NFT contract, or click "Visit site" for deployed sites

### JavaScript library

```bash
npm install evmfs-lib
```

```javascript
import { EVMFS } from "evmfs-lib";

const fs = new EVMFS({
  rpc: "https://eth.llamarpc.com",
  contract: "0x140cbDFf649929D003091a5B8B3be34588753aBA"
});

// Fetch a single file by path
const html = await fs.fetch(manifestHash, blockNum, "index.html");

// Fetch all files with concurrency control
const files = await fs.fetchAll(manifestHash, blockNum, { concurrency: 5 });
```

Zero required dependencies. Works in Node 18+ and modern browsers. Optional `@noble/hashes` peer dep for keccak256 hash verification.

### EVMFS Names

Register a permanent subdomain for your deployed site at [names.evmfs.xyz](https://names.evmfs.xyz).

```bash
# Register a name (0.001 ETH, one-time, no renewals)
evmfs register --name mysite --manifest 0xabc... --block 24826863 \
  --names-contract 0x36043906ba7c191c9511a60a8b28e3a602ed1477

# Update to point to a new deployment
evmfs update-name --name mysite --manifest 0xdef... --block 24827000 \
  --names-contract 0x36043906ba7c191c9511a60a8b28e3a602ed1477
```

Names are ERC-721 NFTs — transferable and tradeable on any marketplace. The gateway resolves names on-chain with zero configuration. Only the wallet that uploaded a manifest can register a name for it.

- **EVMFSNames contract** (mainnet): `0x36043906ba7c191c9511a60a8b28e3a602ed1477`

### Security note on auto-signing

The "private key (auto-sign)" option exists because clicking MetaMask 50 times for a 10k-file upload is not a product. **The key stays in browser memory only** — it is never sent to any server, never written to localStorage, never persisted anywhere. Refresh the page and it's gone. If you're uploading from a dedicated deployment wallet, this is the fastest path.

---

## Permanence — what this actually guarantees

**The gateway at `evmfs.xyz` is a convenience layer, not a dependency.** If it vanishes tomorrow, your files remain fully retrievable. Here are the escalating recovery paths:

### Path 1: Run your own gateway (30 seconds)

The gateway is ~1,000 lines of Go in `gateway/`. Clone, `docker build`, point it at an RPC:

```bash
docker run -p 8080:8080 \
  -e CONTRACT_ADDRESS=0x140cbDFf649929D003091a5B8B3be34588753aBA \
  -e RPC_URLS="1=https://eth.llamarpc.com" \
  evmfs-gateway
```

Your NFT base URIs keep working. Multiple gateways coexist; the URL path format is standard.

### Path 2: Fetch directly via any Ethereum RPC

No gateway needed at all:

```javascript
const logs = await provider.getLogs({
  address: EVMFS_CONTRACT,
  topics: [
    keccak256("Store(bytes32,bytes)"),
    contentHash
  ],
  fromBlock: knownBlock,
  toBlock: knownBlock,
});
// decode logs[0].data → gzipped file bytes
```

A static HTML file with ethers.js + `DecompressionStream` is a zero-infrastructure gateway.

### Path 3: Reconstruct from the manifest

The manifest IS the index. With `manifestHash` + `manifestBlock`:

1. One `eth_getLogs` call → gzipped manifest JSON
2. Decompress → `[{h, b}, {h, b}, ...]`
3. For each entry: one `eth_getLogs` at block `b` for hash `h`

The entire retrieval algorithm is ~50 lines of JavaScript.

### Path 4: Any archive node or chain explorer

Etherscan's API exposes `eth_getLogs`. Every archive node serves the same data. Replicated across thousands of nodes globally.

### The 36 bytes you need to keep

- `contractAddress`: `0x140cbDFf649929D003091a5B8B3be34588753aBA` (mainnet)
- `chainId`: `1` (Ethereum mainnet)
- `manifestHash`: 32-byte hash
- `manifestBlock`: block number

Those values unlock everything you uploaded, forever.

### What would have to fail for files to be lost

1. Ethereum itself stops being validated → you have bigger problems
2. All archive nodes prune event logs → they can't, event logs are in the receipt trie required for chain verification
3. Nothing else

---

## Deployment

### EVMFS (storage)
- **Ethereum mainnet** (chain ID `1`): `0x140cbDFf649929D003091a5B8B3be34588753aBA`
- **Sepolia** (chain ID `11155111`): `0x443E0EFed7Ca889e31f65b3a262999C88a1D470F`

### EVMFSNames (subdomain registry)
- **Ethereum mainnet** (chain ID `1`): `0x36043906ba7c191c9511a60a8b28e3a602ed1477`

---

## Repo layout

```
contracts/      Solidity contracts (EVMFS + EVMFSNames)
cli/            TypeScript CLI (npm: evmfs-cli)
lib/            Standalone JS library (npm: evmfs-lib)
gateway/        Go HTTP gateway (stateless, cacheable)
web/            React web UI (wagmi + RainbowKit)
names-ui/       EVMFS Names registration UI (names.evmfs.xyz)
demo-site/      Example static site for deploying to EVMFS
scripts/        Deployment scripts (mainnet + sepolia)
```
