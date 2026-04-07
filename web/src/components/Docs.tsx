import { useState } from "react";

type DocsTab = "users" | "devs";

export function Docs() {
  const [section, setSection] = useState<DocsTab>("users");

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{
        display: "flex",
        gap: 0,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #2a2a3a",
        marginBottom: 24,
        maxWidth: 360,
      }}>
        <SubTab label="For Users" active={section === "users"} onClick={() => setSection("users")} />
        <SubTab label="For Developers" active={section === "devs"} onClick={() => setSection("devs")} />
      </div>

      {section === "users" ? <UsersDocs /> : <DevsDocs />}
    </div>
  );
}

function SubTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "9px 16px",
        background: active ? "#1e1e2e" : "transparent",
        color: active ? "#e0e0e0" : "#6b7280",
        border: "none",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{
        color: "#e0e0e0",
        fontSize: 14,
        fontWeight: 600,
        margin: "0 0 10px",
        letterSpacing: "-0.01em",
      }}>
        {title}
      </h3>
      <div style={{ color: "#9ca3af", fontSize: 14, lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      background: "#1a1a2e",
      border: "1px solid #1e1e2e",
      borderRadius: 4,
      padding: "1px 6px",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      color: "#d1d5db",
    }}>
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={{
      background: "#13131f",
      border: "1px solid #1e1e2e",
      borderRadius: 8,
      padding: "12px 14px",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      color: "#d1d5db",
      overflow: "auto",
      margin: "10px 0 0",
      lineHeight: 1.5,
    }}>
      {children}
    </pre>
  );
}

function UsersDocs() {
  return (
    <div>
      <Section title="What is EVMFS?">
        EVMFS stores your files permanently inside Ethereum event logs. You pay gas once at upload and the files stay retrievable forever — no subscription, no pinning service, no ongoing fees.
      </Section>

      <Section title="How is this different from IPFS?">
        IPFS relies on voluntary pinners to keep files online — if nobody pins your file, it disappears. EVMFS stores file bytes directly in Ethereum's event logs, backed by the same consensus that secures the chain itself. There are no pinners to keep paying, and no dependency on any specific service staying online.
      </Section>

      <Section title="What happens if evmfs.xyz disappears?">
        <strong style={{ color: "#d1d5db" }}>Your files stay accessible.</strong> This site is a convenience gateway, not the source of truth. Four ways to retrieve files without it:
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Point your app at any other EVMFS gateway</li>
          <li>Run your own gateway (Docker, 30 seconds)</li>
          <li>Fetch directly from any Ethereum RPC via <Code>eth_getLogs</Code></li>
          <li>Read events via Etherscan's free API</li>
        </ul>
        <p style={{ margin: "12px 0 0" }}>
          All you need to save: the contract address, chain ID, your manifest hash, and manifest block number. Those 36 bytes unlock everything you uploaded.
        </p>
      </Section>

      <Section title="Can anyone delete my files?">
        No. The EVMFS contract has no admin, no owner, no delete function, and no upgrade mechanism. Once your files are written to Ethereum's event logs, they're as permanent as the chain itself.
      </Section>

      <Section title="What's a content hash?">
        Every file is identified by its <Code>keccak256</Code> hash — a 32-byte fingerprint of the file's exact bytes. This means files are self-verifying: if anything tampers with the data in transit, the hash won't match, and you'll know. You don't have to trust the gateway; you trust the math.
      </Section>

      <Section title="What does a file URL look like?">
        <CodeBlock>{`https://evmfs.xyz/1/19280143/0xabc.../0`}</CodeBlock>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li><Code>1</Code> — chain ID (Ethereum mainnet)</li>
          <li><Code>19280143</Code> — block where the manifest was stored</li>
          <li><Code>0xabc...</Code> — your manifest hash</li>
          <li><Code>0</Code> — file index within your manifest</li>
        </ul>
      </Section>

      <Section title="How do I verify my files are on-chain?">
        Every upload emits a <Code>Store</Code> event on the EVMFS contract. Look up your transaction hash on Etherscan — you'll see the event directly in the receipt, with your content hash as an indexed topic. No trust required.
      </Section>

      <Section title="How do I access files without this site?">
        You need four values: contract address, chain ID, manifest hash, and manifest block number. Save them in your project README or NFT contract comments. With those, any developer can reconstruct access in ~50 lines of JavaScript against any Ethereum RPC. Full instructions are in the <strong style={{ color: "#d1d5db" }}>For Developers</strong> tab.
      </Section>

      <Section title="Static site hosting">
        EVMFS can host entire websites on Ethereum. Switch to <strong style={{ color: "#d1d5db" }}>Deploy folder</strong> mode, drop your site's build folder, and upload. The gateway serves files by their original path with correct content types:
        <CodeBlock>{`https://evmfs.xyz/1/24826863/0xabc.../index.html
https://evmfs.xyz/1/24826863/0xabc.../assets/style.css`}</CodeBlock>
        <p style={{ margin: "12px 0 0" }}>
          SPA fallback is built in — requests for paths without a file extension serve <Code>index.html</Code> automatically.
        </p>
      </Section>

      <Section title="EVMFS Names">
        Don't want long URLs? Register a permanent subdomain at <a href="https://names.evmfs.xyz" target="_blank" rel="noopener noreferrer" style={{ color: "#5b7def", textDecoration: "none" }}>names.evmfs.xyz</a>. Pick a name, point it at your manifest, and your site is live at <Code>yourname.evmfs.xyz</Code>.
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>0.001 ETH one-time registration, no renewals</li>
          <li>Names are ERC-721 NFTs — transferable and tradeable</li>
          <li>Update your manifest anytime to deploy a new version</li>
          <li>The gateway resolves names on-chain, no databases</li>
        </ul>
        <p style={{ margin: "12px 0 0" }}>
          Or use the CLI: <Code>npm install -g evmfs-cli</Code> then <Code>evmfs register --name mysite --manifest 0x... --block 12345</Code>
        </p>
      </Section>
    </div>
  );
}

function DevsDocs() {
  return (
    <div>
      <Section title="Contract address">
        <CodeBlock>{`0x140cbDFf649929D003091a5B8B3be34588753aBA`}</CodeBlock>
        <p style={{ margin: "10px 0 0" }}>
          Deployed on Ethereum mainnet (chain ID <Code>1</Code>). Immutable, no admin, no upgrades.
        </p>
      </Section>

      <Section title="URL format">
        <CodeBlock>{`{gateway}/{chainId}/{manifestBlock}/{manifestHash}/{fileIndex}`}</CodeBlock>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li><Code>gateway</Code> — any EVMFS gateway host</li>
          <li><Code>chainId</Code> — EVM chain ID the contract is deployed on</li>
          <li><Code>manifestBlock</Code> — block number of the manifest tx (enables fast RPC lookups)</li>
          <li><Code>manifestHash</Code> — keccak256 of the gzipped manifest bytes</li>
          <li><Code>fileIndex</Code> — 0-indexed position in the manifest array, or a file path for deployed sites</li>
        </ul>
        <p style={{ margin: "12px 0 0" }}>
          Want a shorter URL? Register a subdomain at <a href="https://names.evmfs.xyz" target="_blank" rel="noopener noreferrer" style={{ color: "#5b7def", textDecoration: "none" }}>names.evmfs.xyz</a> and access your content at <Code>yourname.evmfs.xyz</Code>.
        </p>
      </Section>

      <Section title="Manifest format">
        Gzipped JSON array stored via <Code>storeManifest()</Code>:
        <CodeBlock>{`[
  {"h": "0xabc...", "b": 19280143},
  {"h": "0xdef...", "b": 19280143}
]`}</CodeBlock>
        <p style={{ margin: "10px 0 0" }}>
          <Code>h</Code> = file content hash · <Code>b</Code> = block number where the file was stored
        </p>
      </Section>

      <Section title="Large files (multi-part entries)">
        Files over ~100 KB are split into ordered chunks across multiple <Code>store()</Code> calls. The manifest entry uses a <Code>p</Code> (parts) field listing each chunk in order:
        <CodeBlock>{`[
  {"h": "0xabc...", "b": 19280143},
  {"p": [
    {"h": "0xaaa...", "b": 19280150},
    {"h": "0xbbb...", "b": 19280151},
    {"h": "0xccc...", "b": 19280152}
  ]}
]`}</CodeBlock>
        <p style={{ margin: "10px 0 0" }}>
          The gateway fetches all parts, concatenates them in array order, and gunzips the combined blob. No contract change — chunks are ordinary <Code>Store</Code> events. Single-chunk entries remain unchanged, so existing manifests stay valid.
        </p>
      </Section>

      <Section title="Contract ABI">
        <CodeBlock>{`function store(bytes calldata data) external returns (bytes32);
function storeBatch(bytes[] calldata data) external returns (bytes32[]);
function storeManifest(bytes calldata data) external returns (bytes32);
event Store(bytes32 indexed contentHash, bytes data);
mapping(bytes32 => address) public manifests;`}</CodeBlock>
      </Section>

      <Section title="Direct RPC fetch (no gateway required)">
        <CodeBlock>{`import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(rpcUrl);
const topic = ethers.id("Store(bytes32,bytes)");

const logs = await provider.getLogs({
  address: "0x140cbDFf649929D003091a5B8B3be34588753aBA",
  topics: [topic, contentHash],
  fromBlock: knownBlock,
  toBlock: knownBlock,
});

// ABI-decode the data field
const [raw] = ethers.AbiCoder.defaultAbiCoder()
  .decode(["bytes"], logs[0].data);
const bytes = ethers.getBytes(raw);
// Then gunzip(bytes) to get the original file`}</CodeBlock>
      </Section>

      <Section title="Self-host the gateway">
        <CodeBlock>{`docker build -t evmfs-gateway github.com/devabsnt/evmfs#main:gateway

docker run -p 8080:8080 \\
  -e CONTRACT_ADDRESS=0x140cbDFf649929D003091a5B8B3be34588753aBA \\
  -e RPC_URLS="1=https://eth.llamarpc.com" \\
  evmfs-gateway`}</CodeBlock>
      </Section>

      <Section title="EVMFS Names contract">
        On-chain subdomain registry. Register <Code>yourname.evmfs.xyz</Code> for 0.001 ETH — no renewals, names are ERC-721 NFTs.
        <CodeBlock>{`// EVMFSNames — Ethereum mainnet
0x36043906ba7c191c9511a60a8b28e3a602ed1477

// ABI (key functions)
function register(string name, uint64 block, bytes32 manifest) payable
function update(string name, uint64 block, bytes32 manifest)
function lookup(string name) view returns (address, uint64, bytes32)

// Only the manifest uploader can register a name for it.
// Name owner can update the manifest at any time.
// Standard ERC-721 — transferFrom, safeTransferFrom, etc.`}</CodeBlock>
      </Section>

      <Section title="npm packages">
        <p style={{ margin: "0 0 10px" }}>
          <strong style={{ color: "#d1d5db" }}>evmfs-cli</strong> — command-line tool for uploads, deploys, and name registration.
        </p>
        <CodeBlock>{`npm install -g evmfs-cli

evmfs deploy --folder ./dist      # deploy a static site
evmfs upload --folder ./metadata   # upload files (numeric indices)
evmfs register --name mysite \\
  --manifest 0x... --block 12345   # register a subdomain
evmfs update-name --name mysite \\
  --manifest 0x... --block 12346   # update to new deployment
evmfs verify --hash 0x...          # verify on-chain content`}</CodeBlock>
        <p style={{ margin: "12px 0 10px" }}>
          <strong style={{ color: "#d1d5db" }}>evmfs</strong> — standalone JS library for fetching EVMFS content. Zero required dependencies.
        </p>
        <CodeBlock>{`npm install evmfs-lib

import { EVMFS } from "evmfs-lib";
const fs = new EVMFS({ rpc: "...", contract: "0x140c..." });

// Fetch a file by path or index
const data = await fs.fetch(hash, block, "index.html");

// Fetch all files with concurrency control
const files = await fs.fetchAll(hash, block, { concurrency: 5 });

// Parse a manifest
const entries = await fs.manifest(hash, block);`}</CodeBlock>
      </Section>

      <Section title="Run your own gateway">
        <p style={{ margin: "0 0 10px" }}>
          The gateway at evmfs.xyz is a convenience — not a dependency. Anyone can run their own. The gateway is a stateless Go binary that reads from any Ethereum RPC and caches to disk.
        </p>
        <CodeBlock>{`# Clone and build
git clone https://github.com/devabsnt/evmfs
cd evmfs/gateway
go build -o evmfs-gateway .

# Run
CONTRACT_ADDRESS=0x140cbDFf649929D003091a5B8B3be34588753aBA \\
RPC_URLS="1=https://eth.llamarpc.com" \\
./evmfs-gateway

# Or with Docker
docker build -t evmfs-gateway .
docker run -p 8080:8080 \\
  -e CONTRACT_ADDRESS=0x140cbDFf649929D003091a5B8B3be34588753aBA \\
  -e RPC_URLS="1=https://eth.llamarpc.com" \\
  evmfs-gateway`}</CodeBlock>
        <p style={{ margin: "12px 0 0" }}>
          Your gateway serves the same URLs. Multiple gateways can coexist — the data is on Ethereum, not on any particular server. If evmfs.xyz goes down, point your URLs at your own gateway and everything keeps working.
        </p>
        <p style={{ margin: "10px 0 0" }}>
          To enable subdomain resolution, add these env vars and a wildcard DNS record:
        </p>
        <CodeBlock>{`# Gateway env vars
NAMES_CONTRACT=0x36043906ba7c191c9511a60a8b28e3a602ed1477
NAMES_CHAIN_ID=1
GATEWAY_DOMAIN=yourdomain.com

# DNS — add a wildcard CNAME pointing to your gateway
*   CNAME   your-gateway-host.example.com`}</CodeBlock>
        <p style={{ margin: "10px 0 0" }}>
          All registered names resolve from the same on-chain registry — <Code>mysite.yourdomain.com</Code> serves the same content as <Code>mysite.evmfs.xyz</Code>.
        </p>
      </Section>

      <Section title="Source code">
        <a
          href="https://github.com/devabsnt/evmfs"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#5b7def", textDecoration: "none" }}
        >
          github.com/devabsnt/evmfs
        </a>
      </Section>
    </div>
  );
}
