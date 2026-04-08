import { useState, useEffect, useCallback } from "react";
import { parseEther, type WalletClient, type PublicClient, type Hex, zeroAddress, keccak256, toBytes } from "viem";
import { discoverWallets, connectWallet, defaultPublicClient, type WalletInfo } from "./wallet";
import { NAMES_ABI } from "./abi";

const NAMES_CONTRACT = "0x36043906ba7c191c9511a60a8b28e3a602ed1477" as const;

type View = "guide" | "register" | "update" | "lookup";

export default function App() {
  const [view, setView] = useState<View>("register");
  const [address, setAddress] = useState("");
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [name, setName] = useState("");
  const [manifest, setManifest] = useState("");
  const [block, setBlock] = useState("");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");

  const [lookupName, setLookupName] = useState("");
  const [lookupResult, setLookupResult] = useState<{
    owner: string; block: bigint; manifest: string;
  } | null>(null);
  const [lookupError, setLookupError] = useState("");

  const [updateName, setUpdateName] = useState("");
  const [updateManifest, setUpdateManifest] = useState("");
  const [updateBlock, setUpdateBlock] = useState("");
  const [updateOwner, setUpdateOwner] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    const seen = new Set<string>();
    return discoverWallets((wallet) => {
      if (seen.has(wallet.uuid)) return;
      seen.add(wallet.uuid);
      setWallets((prev) => [...prev, wallet]);
    });
  }, []);

  const handleConnect = useCallback(async (wallet: WalletInfo) => {
    setConnecting(true);
    setShowModal(false);
    try {
      const result = await connectWallet(wallet.provider);
      setAddress(result.address);
      setWalletClient(result.walletClient);
      setPublicClient(result.publicClient);
    } catch (err) {
      console.error("connect failed:", err);
    }
    setConnecting(false);
  }, []);

  const nameValid = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && name.length <= 32;
  const canRegister = !!walletClient && nameValid && manifest.startsWith("0x") && manifest.length === 66 && block.length > 0;

  async function handleRegister() {
    if (!walletClient || !publicClient) return;
    setStatus("Sending transaction...");
    setTxHash("");
    try {
      const hash = await walletClient.writeContract({
        address: NAMES_CONTRACT,
        abi: NAMES_ABI,
        functionName: "register",
        args: [name, BigInt(block), manifest as Hex],
        value: parseEther("0.001"),
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      setTxHash(hash);
      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`Registered! ${name}.evmfs.xyz is live.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${msg.length > 200 ? msg.slice(0, 200) + "..." : msg}`);
    }
  }

  async function checkUpdateOwner() {
    const client = publicClient ?? defaultPublicClient;
    if (!client || !updateName) return;
    setUpdateChecking(true);
    setUpdateOwner(null);
    try {
      const result = await client.readContract({
        address: NAMES_CONTRACT, abi: NAMES_ABI,
        functionName: "lookup", args: [updateName],
      });
      const [owner] = result;
      setUpdateOwner(owner as string);
    } catch {
      setUpdateOwner(null);
    }
    setUpdateChecking(false);
  }

  const isUpdateOwner = updateOwner !== null && updateOwner !== zeroAddress && address && updateOwner.toLowerCase() === address.toLowerCase();
  const canUpdate = isUpdateOwner && updateManifest.startsWith("0x") && updateManifest.length === 66 && updateBlock.length > 0;

  async function handleUpdate() {
    if (!walletClient || !publicClient) return;
    setUpdateStatus("Sending transaction...");
    try {
      const hash = await walletClient.writeContract({
        address: NAMES_CONTRACT, abi: NAMES_ABI,
        functionName: "update",
        args: [updateName, BigInt(updateBlock), updateManifest as Hex],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      setUpdateStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setUpdateStatus(`Updated! ${updateName}.evmfs.xyz now points to the new manifest.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateStatus(`Error: ${msg.length > 200 ? msg.slice(0, 200) + "..." : msg}`);
    }
  }

  async function handleLookup() {
    const client = publicClient ?? defaultPublicClient;
    if (!client) return;
    setLookupResult(null);
    setLookupError("");
    try {
      const result = await client.readContract({
        address: NAMES_CONTRACT,
        abi: NAMES_ABI,
        functionName: "lookup",
        args: [lookupName],
      });
      const [owner, blockNum, manifestHash] = result;
      if (owner === zeroAddress) {
        setLookupError("Available - this name hasn't been claimed yet");
      } else {
        setLookupResult({
          owner: owner as string,
          block: blockNum as bigint,
          manifest: manifestHash as string,
        });
      }
    } catch {
      setLookupError("Lookup failed");
    }
  }

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  const tabs: View[] = ["guide", "register", "update", "lookup"];
  const tabLabels: Record<View, string> = { guide: "Guide", register: "Register", update: "Update", lookup: "Lookup" };

  return (
    <div style={s.root}>
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>Connect Wallet</div>
            {wallets.length === 0 && (
              <div style={s.modalEmpty}>No wallets detected. Install MetaMask, Rabby, or Phantom.</div>
            )}
            {wallets.map((w) => (
              <button key={w.uuid} onClick={() => handleConnect(w)} style={s.walletBtn}>
                <img src={w.icon} alt="" width={24} height={24} style={{ display: "block" }} />
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <header style={s.header}>
        <div style={s.headerInner}>
          <span style={s.logo}>evmfs<span style={s.logoAccent}>names</span></span>
          {address ? (
            <span style={s.addr}>{shortAddr}</span>
          ) : (
            <button onClick={() => setShowModal(true)} disabled={connecting} style={s.connectBtn}>
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <main style={s.main}>
        <h1 style={s.title}>Permanent subdomains on Ethereum</h1>
        <p style={s.sub}>
          Claim <span style={s.hl}>yourname</span>.evmfs.xyz - backed by an on-chain registry, tradeable as an NFT.
        </p>

        <div style={s.tabs}>
          {tabs.map((v) => (
            <button key={v} onClick={() => setView(v)}
              style={{ ...s.tab, ...(view === v ? s.tabActive : {}) }}
            >{tabLabels[v]}</button>
          ))}
        </div>

        {view === "guide" && (
          <div style={s.panel}>
            <div style={s.guideSection}>
              <h2 style={s.guideH}>What are EVMFS Names?</h2>
              <p style={s.guideP}>
                EVMFS stores files permanently on Ethereum. When you deploy a static site
                with <code style={s.code}>evmfs deploy</code>, you get a manifest hash - a
                unique fingerprint for your entire site. EVMFS Names lets you point a human-readable
                subdomain at that manifest.
              </p>
            </div>
            <div style={s.guideSection}>
              <h2 style={s.guideH}>How it works</h2>
              <div style={s.guideCode}>
                <div><span style={s.stepNum}>1</span> Deploy your site to EVMFS</div>
                <div style={s.codeLine}>evmfs deploy --folder ./dist</div>
                <div style={s.codeResult}>manifest: 0xabc...  block: 24826863</div>
                <div style={{ height: 12 }} />
                <div><span style={s.stepNum}>2</span> Register a name (0.001 ETH)</div>
                <div style={s.codeLine}>mysite.evmfs.xyz → 0xabc...</div>
                <div style={{ height: 12 }} />
                <div><span style={s.stepNum}>3</span> Your site is live</div>
                <div style={s.codeLine}>https://mysite.evmfs.xyz</div>
              </div>
            </div>
            <div style={s.guideSection}>
              <h2 style={s.guideH}>Key details</h2>
              <div style={s.guideList}>
                <div style={s.listItem}>Names are <strong>ERC-721 NFTs</strong> - transfer, sell, or trade on any marketplace</div>
                <div style={s.listItem}>Only the wallet that uploaded the manifest can register a name for it</div>
                <div style={s.listItem}>Name owners can update their manifest to a new version at any time</div>
                <div style={s.listItem}>The gateway resolves names on-chain - no databases, no middlemen</div>
                <div style={s.listItem}>Registration costs <strong>0.001 ETH</strong>, one-time, no renewals ever</div>
                <div style={s.listItem}>Use your own domain via Cloudflare or any reverse proxy - <a href="https://evmfs.xyz" target="_blank" rel="noopener noreferrer" style={s.link}>full guide in docs</a></div>
              </div>
            </div>
            <div style={s.guideSection}>
              <h2 style={s.guideH}>Naming rules</h2>
              <div style={s.guideList}>
                <div style={s.listItem}>Lowercase letters (a-z), numbers (0-9), hyphens (-)</div>
                <div style={s.listItem}>Hyphens cannot be at the start or end</div>
                <div style={s.listItem}>Max 32 characters</div>
                <div style={s.listItem}>First come, first served</div>
              </div>
            </div>
            <button onClick={() => setView("register")} style={s.ctaBtn}>Register a name</button>
          </div>
        )}

        {view === "register" && (
          <div style={s.panel}>
            <div style={s.field}>
              <label style={s.label}>Name</label>
              <div style={s.inputRow}>
                <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="mysite" style={s.input} maxLength={32} />
                <span style={s.suffix}>.evmfs.xyz</span>
              </div>
              {name && !nameValid && <div style={s.error}>Lowercase a-z, 0-9, hyphens only (not at start/end)</div>}
            </div>
            <div style={s.field}>
              <label style={s.label}>Manifest hash</label>
              <input value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder="0x..." style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Block number</label>
              <input value={block} onChange={(e) => setBlock(e.target.value.replace(/\D/g, ""))} placeholder="24826863" style={s.input} />
            </div>
            <div style={s.field}>
              <div style={s.feeRow}><span style={s.dim}>Registration fee</span><span>0.001 ETH</span></div>
            </div>
            <button onClick={handleRegister} disabled={!canRegister}
              style={{ ...s.button, ...(canRegister ? {} : s.buttonDisabled) }}>
              {!walletClient ? "Connect wallet first" : !nameValid && name ? "Invalid name" : "Register"}
            </button>
            {status && <div style={s.status}>{status}</div>}
            {txHash && (
              <div style={s.status}>
                <span style={s.dim}>tx: </span>
                <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={s.link}>{txHash.slice(0, 18)}...</a>
              </div>
            )}
          </div>
        )}

        {view === "update" && (
          <div style={s.panel}>
            <div style={s.field}>
              <label style={s.label}>Name to update</label>
              <div style={s.inputRow}>
                <input value={updateName}
                  onChange={(e) => { setUpdateName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setUpdateOwner(null); setUpdateStatus(""); }}
                  placeholder="mysite" style={s.input}
                  onKeyDown={(e) => e.key === "Enter" && checkUpdateOwner()} />
                <span style={s.suffix}>.evmfs.xyz</span>
              </div>
            </div>

            <button onClick={checkUpdateOwner} disabled={!updateName || updateChecking}
              style={{ ...s.button, marginBottom: 16, ...(updateName ? {} : s.buttonDisabled) }}>
              {updateChecking ? "Checking..." : "Check ownership"}
            </button>

            {updateOwner !== null && updateOwner === zeroAddress && (
              <div style={s.status}><span style={{ color: "#d05050" }}>Name not registered</span></div>
            )}

            {updateOwner !== null && updateOwner !== zeroAddress && !isUpdateOwner && (
              <div style={s.status}><span style={{ color: "#d05050" }}>Owned by {updateOwner.slice(0, 10)}... - not your wallet</span></div>
            )}

            {isUpdateOwner && (
              <div>
                <div style={{ color: "#4aba6a", fontSize: 13, marginBottom: 16 }}>You own this name</div>
                <div style={s.field}>
                  <label style={s.label}>New manifest hash</label>
                  <input value={updateManifest} onChange={(e) => setUpdateManifest(e.target.value)}
                    placeholder="0x..." style={s.input} />
                </div>
                <div style={s.field}>
                  <label style={s.label}>New block number</label>
                  <input value={updateBlock} onChange={(e) => setUpdateBlock(e.target.value.replace(/\D/g, ""))}
                    placeholder="24826863" style={s.input} />
                </div>
                <button onClick={handleUpdate} disabled={!canUpdate}
                  style={{ ...s.button, ...(canUpdate ? {} : s.buttonDisabled) }}>
                  Update
                </button>
                {updateStatus && <div style={s.status}>{updateStatus}</div>}
              </div>
            )}
          </div>
        )}

        {view === "lookup" && (
          <div style={s.panel}>
            <div style={s.field}>
              <label style={s.label}>Name</label>
              <div style={s.inputRow}>
                <input value={lookupName} onChange={(e) => setLookupName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="mysite" style={s.input} onKeyDown={(e) => e.key === "Enter" && handleLookup()} />
                <span style={s.suffix}>.evmfs.xyz</span>
              </div>
            </div>
            <button onClick={handleLookup} style={s.button}>Lookup</button>
            {lookupError && (
              <div style={s.status}>
                <span style={{ color: lookupError.includes("Available") ? "#4aba6a" : "#d05050" }}>{lookupError}</span>
              </div>
            )}
            {lookupResult && (
              <div style={s.result}>
                <div style={s.resultRow}><span style={s.dim}>Owner</span><span style={{ fontSize: 12 }}>{lookupResult.owner}</span></div>
                <div style={s.resultRow}><span style={s.dim}>Block</span><span>{lookupResult.block.toString()}</span></div>
                <div style={s.resultRow}><span style={s.dim}>Manifest</span><span style={{ wordBreak: "break-all", fontSize: 12 }}>{lookupResult.manifest}</span></div>
                <div style={{ ...s.resultRow, borderBottom: "none" }}>
                  <span style={s.dim}>URL</span>
                  <a href={`https://${lookupName}.evmfs.xyz`} target="_blank" rel="noopener noreferrer" style={s.link}>{lookupName}.evmfs.xyz</a>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer style={s.footer}>
        <span style={s.dim}>evmfsnames - on-chain subdomain registry</span>
        <span style={s.dim}> · </span>
        <a href="https://evmfs.xyz" target="_blank" rel="noopener noreferrer" style={s.link}>evmfs.xyz</a>
        <span style={s.dim}> · </span>
        <a href="https://names.evmfs.xyz" style={s.link}>names.evmfs.xyz</a>
      </footer>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", background: "#141416", color: "#c2c2c8", fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: 14 },
  header: { borderBottom: "1px solid #222228", padding: "0 24px" },
  headerInner: { maxWidth: 580, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", height: 56 },
  logo: { fontSize: 16, fontWeight: 700, color: "#ededf0", letterSpacing: "-0.02em" },
  logoAccent: { color: "#8a8a94" },
  hl: { color: "#d4d4da", fontWeight: 600 },
  dim: { color: "#606068" },
  addr: { color: "#a0a0aa", fontSize: 13, background: "#1c1c20", padding: "4px 10px", border: "1px solid #2a2a30" },
  connectBtn: { padding: "7px 16px", background: "#1c1c20", border: "1px solid #2a2a30", color: "#c2c2c8", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" },
  main: { maxWidth: 580, margin: "0 auto", padding: "48px 24px 80px" },
  title: { fontSize: 18, fontWeight: 600, color: "#ededf0", marginBottom: 8, letterSpacing: "-0.02em" },
  sub: { color: "#78787e", marginBottom: 32, lineHeight: 1.6, fontSize: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { background: "#1a1a1e", border: "1px solid #2a2a30", padding: 24, width: 320, maxWidth: "90vw" },
  modalTitle: { fontSize: 15, fontWeight: 600, color: "#ededf0", marginBottom: 16 },
  modalEmpty: { color: "#606068", fontSize: 13, lineHeight: 1.6, padding: "12px 0" },
  walletBtn: { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#141416", border: "1px solid #2a2a30", color: "#c2c2c8", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", marginBottom: 8 },
  tabs: { display: "flex", gap: 0, marginBottom: 20, border: "1px solid #222228" },
  tab: { flex: 1, padding: "10px 16px", background: "transparent", color: "#606068", border: "none", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, cursor: "pointer" },
  tabActive: { background: "#1a1a1e", color: "#d4d4da" },
  panel: { border: "1px solid #222228", padding: 24, marginBottom: 24, background: "#18181c" },
  field: { marginBottom: 18 },
  label: { display: "block", color: "#78787e", fontSize: 12, marginBottom: 6 },
  inputRow: { display: "flex", alignItems: "center" },
  input: { flex: 1, padding: "10px 12px", background: "#141416", border: "1px solid #2a2a30", color: "#ededf0", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box" as const, width: "100%" },
  suffix: { padding: "10px 12px", background: "#1c1c20", border: "1px solid #2a2a30", borderLeft: "none", color: "#a0a0aa", fontSize: 14, whiteSpace: "nowrap" as const },
  error: { color: "#d05050", fontSize: 12, marginTop: 4 },
  feeRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13 },
  button: { width: "100%", padding: "12px 24px", background: "#ededf0", color: "#141416", border: "none", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, cursor: "pointer" },
  buttonDisabled: { background: "#222228", color: "#444448", cursor: "not-allowed" },
  status: { marginTop: 12, fontSize: 13, lineHeight: 1.6, wordBreak: "break-all" as const },
  link: { color: "#a0a0aa", textDecoration: "underline", textUnderlineOffset: "3px" },
  result: { marginTop: 16, border: "1px solid #222228" },
  resultRow: { display: "flex", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #222228", fontSize: 13, gap: 16 },
  ctaBtn: { width: "100%", padding: "12px 24px", background: "#ededf0", color: "#141416", border: "none", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, cursor: "pointer", marginTop: 8 },
  code: { background: "#1c1c20", padding: "2px 6px", border: "1px solid #2a2a30", fontSize: 12 },
  stepNum: { display: "inline-block", width: 20, height: 20, lineHeight: "20px", textAlign: "center" as const, background: "#222228", color: "#a0a0aa", fontSize: 11, marginRight: 8, fontWeight: 600 },
  codeLine: { paddingLeft: 28, color: "#a0a0aa", fontSize: 13 },
  codeResult: { paddingLeft: 28, color: "#606068", fontSize: 12 },
  guideSection: { marginBottom: 28 },
  guideH: { color: "#ededf0", fontSize: 14, fontWeight: 600, marginBottom: 10 },
  guideP: { color: "#8a8a94", lineHeight: 1.7, fontSize: 13, margin: 0 },
  guideCode: { background: "#141416", border: "1px solid #222228", padding: "16px 20px", fontSize: 13, lineHeight: 2, color: "#c2c2c8" },
  guideList: { fontSize: 13, color: "#8a8a94" },
  listItem: { padding: "6px 0", borderBottom: "1px solid #1e1e22", lineHeight: 1.6 },
  footer: { borderTop: "1px solid #222228", padding: "16px 24px", textAlign: "center" as const, fontSize: 12 },
};
