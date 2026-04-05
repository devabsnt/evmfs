# EVMFS

**Ethereum-native permanent storage.**

Event logs have always been a permanent storage primitive baked into Ethereum's consensus layer. Every log is part of the receipt trie, replicated across every archive node, validated by every full node, and required for chain verification. They are as durable as the chain itself — and vastly cheaper than contract storage.

Nobody wrapped a proper product around this. EVMFS is that product.

---

## What this actually is

A 31-line Solidity contract that emits events containing your (gzipped) file bytes. LOG opcodes cost ~8 gas per byte — roughly **2,500× cheaper than SSTORE** for bulk data. Files are content-addressed via keccak256 hash. A manifest transaction binds N files into a single hash, producing a URI that drops straight into an ERC-721 `baseURI()`:

```
https://evmfs.xyz/{chainId}/{manifestBlock}/{manifestHash}/
```

Nothing novel in the underlying mechanic. What's novel is that the upload tooling, gateway, web UI, resume logic, batching math, and manifest format already exist and work — so you can actually use this primitive without writing 2,000 lines of glue code yourself.

---

## What it costs

Rough ballpark for a **10,000-file PFP collection** (~400 bytes/file gzipped, batched efficiently):

| Gas price | Cost (ETH) | Cost @ $3,500/ETH |
|-----------|-----------|-------------------|
| 10 gwei   | ~1.1 ETH  | ~$3,850          |
| 30 gwei   | ~3.3 ETH  | ~$11,550         |
| 50 gwei   | ~5.5 ETH  | ~$19,250         |

At the small end, a **single 2 KB metadata JSON** costs ~76,000 gas — roughly **$0.53 at 10 gwei / $3,500 ETH**, or ~$2.65 at 50 gwei. That's the realistic floor for entry-level use.

A **1,000-file collection** is roughly 1/10th of the 10k numbers. A **single 10 KB image** costs ~260,000 gas — about $27 at 30 gwei / $3,500 ETH.

This is a **one-time cost**. Nothing ever expires. There is no pinning service, no endowment, no ongoing fee.

### A note on fees

**The EVMFS contract charges no fees.** It has no admin key, no fee switch, no mechanism anyone can flip later to extract value at the protocol level — the contract is immutable and owner-less by design.

The hosted frontend at **evmfs.xyz includes a small convenience fee** on uploads to sustain hosting and development. **Direct contract interaction, the CLI, and self-hosted deployments of the frontend are always free.** If you don't want to pay the convenience fee, clone the repo and upload directly — the contract doesn't know or care who's calling it.

This is the same pattern Uniswap uses: free contract, hosted frontend earns its keep. You're paying for convenience, not for access. The worst case is the frontend fee changes and someone forks the UI — which is fine, because that's how open infrastructure should work.

### Where EVMFS makes sense

- NFT collections (metadata + images, typically small files)
- Provenance records, certificates, small documents
- Anything you want genuinely immutable and chain-verifiable
- Data that should remain retrievable for as long as Ethereum exists

### Where it doesn't

- **Large files** (>~100 KB per file). A 1 MB file costs roughly $65–$300+ at typical gas prices. For video, audio, or high-res imagery, evaluate whether the trust tradeoff of an external storage network is acceptable for your use case — EVMFS is optimized for small files where on-chain permanence is worth a premium.
- **Mutable content**. EVMFS has no delete, no update. Content addressing is the feature.
- **Private data**. Event logs are public. Encrypt first if you need privacy.

---

## Quick start

### Web UI

1. Go to https://evmfs.xyz
2. Connect wallet (MetaMask, WalletConnect, etc.) or paste a private key for auto-signing thousands of files
3. Drop your folder of files
4. Review the live cost estimate (fetches gas price + ETH price every 30s)
5. Click Upload — batches sign one at a time, progress saves to localStorage so you can resume if interrupted
6. Copy the base URI and paste it into your NFT contract

### CLI

```bash
evmfs upload --folder ./images --rpc <url> --private-key <key>
evmfs verify --hash 0x... --rpc <url>
evmfs info --hash 0x... --rpc <url>
```

Same upload logic as the web UI, same resume capability, no browser required.

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

Those values unlock the whole collection forever.

### What would have to fail for files to be lost

1. Ethereum itself stops being validated → you have bigger problems
2. All archive nodes prune event logs → they can't, event logs are in the receipt trie required for chain verification
3. Nothing else

---

## Deployment

- **Ethereum mainnet** (chain ID `1`): `0x140cbDFf649929D003091a5B8B3be34588753aBA` — production
- **Sepolia** (chain ID `11155111`): `0x443E0EFed7Ca889e31f65b3a262999C88a1D470F` — testing

Both deployed via CREATE2. Addresses differ because the two deploys used different Solidity compiler versions (0.8.34 on mainnet, 0.8.24 on Sepolia) — the contract logic is identical.

---

## Practical recommendations for collection owners

1. Save `(contractAddress, chainId, manifestHash, manifestBlock)` in your project README.
2. Optionally pin the manifest JSON on IPFS or Arweave as belt-and-suspenders.
3. Document the gateway URL pattern in your NFT contract comments so future developers can rebuild access.
4. Wait for manifest tx finality (~2 epochs / ~13 minutes) before publishing base URIs — this closes the narrow window where a reorg could invalidate recorded block numbers.

---

## Repo layout

```
contracts/      Solidity contract + Foundry tests
cli/            TypeScript CLI for scripted uploads
gateway/        Go HTTP gateway (stateless, cacheable)
web/            React web UI (wagmi + RainbowKit)
scripts/        Deployment scripts (mainnet + sepolia)
```

For implementation details — batching math, retry logic, gas formulas, manifest format, contract internals — see [ARCHITECTURE.md](./ARCHITECTURE.md).
