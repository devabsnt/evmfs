# EVMFS Gateway

A self-hostable HTTP gateway for EVMFS. It turns chain-stored bytes into
ordinary HTTP URLs that any marketplace, wallet, or browser can consume.

The gateway is **stateless**, **content-addressed**, and **trustless**:

- It holds no keys, makes no on-chain writes, has no admin functions.
- It only forwards `eth_getLogs` queries to public RPCs and returns the
  resulting bytes over HTTP.
- The bytes are verifiable — anyone can re-fetch the same hash from a
  different RPC and confirm `keccak256(bytes) == hash`.

This README is **everything you need to spin up your own gateway**. No
prior familiarity with EVMFS internals is required. Hand it to any
developer (or AI assistant) and they can have a gateway live on a real
domain within an hour.

---

## Why run your own gateway

| Concern                          | Without your own gateway                              | With your own gateway                       |
|----------------------------------|-------------------------------------------------------|---------------------------------------------|
| `evmfs.xyz` goes down            | Every URL in your collection's metadata breaks        | Your URLs keep working at `yourgateway.com` |
| Operator visibility into traffic | All requests for your content go through one operator | All requests stay on your infrastructure    |
| Latency                          | Hop to `evmfs.xyz`, then to RPC                       | Direct path: your gateway → RPC             |
| Rate limits                      | Shared across every user of `evmfs.xyz`               | Yours alone                                 |
| Trust assumption                 | One operator's continued benevolence                  | Just RPCs (interchangeable) and the chain   |

---

## Quick start: Docker (≈3 minutes)

```bash
git clone <this-repo>
cd gateway

# Edit Caddyfile — replace `yourgateway.com` with your domain
# (or leave it for localhost-only testing — see Caddyfile comments).
docker compose up -d --build
```

That's it. The compose stack brings up:

- The gateway service on internal port `8080`.
- Caddy in front, listening on `:80` and `:443`, doing automatic HTTPS
  via Let's Encrypt for your domain.

Open `https://yourgateway.com/health` — you should see `ok`.

The compose file uses **environment variables only**, so you do NOT
need to copy `config.yaml.example`. RPC URLs, contract address, and
rewriter settings are all in `docker-compose.yml` — edit them there
before `up`.

Skip to **"Migrate an existing collection"** below if your goal is to
point an NFT collection at your new gateway.

---

## Quick start: from source (≈5 minutes)

Requires Go 1.21+.

```bash
git clone <this-repo>
cd gateway
cp config.yaml.example config.yaml
# Edit config.yaml — at minimum, add your RPC URLs for each chain.
go run .
```

Listens on `:8080` plain HTTP. Put any reverse proxy in front (Nginx,
Caddy, Cloudflare Tunnel) for TLS.

---

## URL syntax (how to actually fetch things)

The gateway's path grammar is the canonical EVMFS one:

| Pattern                                     | Returns                                        |
|---------------------------------------------|------------------------------------------------|
| `/<chainId>/<block>/<manifestHash>`         | HTML directory listing of the manifest's files |
| `/<chainId>/<block>/<manifestHash>/<path>`  | The named file from inside the manifest        |
| `/<chainId>/<block>/<manifestHash>/<index>` | The Nth file (numeric index, 0-based)          |
| `/<chainId>/<contentHash>`                  | A single file (no manifest indirection)        |
| `/<chainId>/<contentHash>/`                 | Force directory mode on a single-file content  |

Field meanings:

- **chainId** — EIP-155 chain ID. `1` = Ethereum mainnet, `11155111` =
  Sepolia, `143` = Monad mainnet, etc.
- **block** — block number where the chain emitted the `Store` event.
  Used as a hint for fast `eth_getLogs`; the gateway falls back to a
  wider scan if the hint misses by a few blocks.
- **manifestHash / contentHash** — `0x` followed by 64 hex characters
  (the 32-byte keccak256 of the stored bytes).
- **path** — filename inside a named manifest, OR a numeric index for
  unnamed manifests.

Plus two utility endpoints:

| Endpoint                      | Purpose                                               |
|-------------------------------|-------------------------------------------------------|
| `GET /health`                 | Returns `ok` (200). Wire this to your uptime monitor. |
| `GET /resolve?url=<full-URL>` | Re-routes any EVMFS-formatted URL string (see below). |

The `/resolve` endpoint accepts a full URL (`https://evmfs.xyz/...`),
a path-only URL, or even a URL pointing at a different gateway host —
strips the scheme + host and dispatches like a normal request. Useful
for browser extensions, CLI fallbacks, and custom proxies.

---

## URL host rewriting (the main feature)

When the gateway returns **text-based content** (JSON, HTML, CSS, SVG,
JS, XML), it scans for hardcoded references to other gateways and
rewrites them to point at itself. By default, references to `evmfs.xyz`
and `www.evmfs.xyz` get rewritten.

### Why this matters

NFT metadata on EVMFS typically looks like:

```json
{
  "name": "MyNFT #1",
  "image": "https://evmfs.xyz/143/71117086/0x764b.../1.png",
  "attributes": [ ... ]
}
```

That `image` URL is hardcoded to `evmfs.xyz`. If `evmfs.xyz` goes down,
the URL breaks — even though the actual PNG bytes are still permanently
on chain.

The naïve workaround is: re-upload every metadata JSON with rewritten
image URLs. That's **O(token_count)** transactions and impossible for
contracts that hardcode their metadata manifest hash on-chain.

The rewriter makes that workaround unnecessary. Once the collection's
`baseURI` points at your gateway, the rewriter normalizes every served
file on the fly:

```
Marketplace fetches:  https://yourgateway.com/143/<block>/<metaHash>/1
        │
        ▼
Gateway pulls metadata bytes from chain via eth_getLogs.
Rewriter sees `"https://evmfs.xyz/..."` in the JSON body and replaces
it with `"https://yourgateway.com/..."`.
        │
        ▼
Marketplace receives JSON whose image field now points at yourgateway.com.
Marketplace fetches the image. Gateway serves the PNG bytes from chain.
Image renders.
```

**One `setBaseURI()` transaction migrates an entire collection.** No
metadata re-upload, no per-token work, no DNS shenanigans.

### Configuration

In `config.yaml`:

```yaml
rewrite_hosts: true
rewrite_from_hosts:
  - "evmfs.xyz"
  - "www.evmfs.xyz"
```

Or via env vars (Docker users):

```bash
REWRITE_HOSTS=true
REWRITE_FROM_HOSTS=evmfs.xyz,www.evmfs.xyz
```

Defaults are **enabled** with `evmfs.xyz` + `www.evmfs.xyz` as source
hosts.

### What gets rewritten

Three URL forms per source host:

| Input                   | Output                                    |
|-------------------------|-------------------------------------------|
| `https://evmfs.xyz/...` | `<currentScheme>://<yourGateway>/...`     |
| `http://evmfs.xyz/...`  | `<currentScheme>://<yourGateway>/...`     |
| `//evmfs.xyz/...`       | `//<yourGateway>/...` (protocol-relative) |

"Current scheme" comes from `X-Forwarded-Proto` (reverse-proxy header)
or `r.TLS != nil` (direct TLS). "Current gateway host" is whatever the
request's `Host` header is — so the same binary on `gateway-a.com` and
`gateway-b.com` rewrites correctly for each host without reconfig.

### What does NOT get rewritten

- **Binary content** (PNG, JPEG, GIF, WebP, MP4, fonts, WASM, etc.) —
  passed through byte-identical to the on-chain payload.
- **References to hosts not in `rewrite_from_hosts`.** If a metadata
  file mentions `https://example.com`, it's left alone.
- **Bare hostnames without a scheme.** Things like
  `href="evmfs.xyz/..."` are not touched — too easy to false-positive
  inside unrelated text.

### Debug header

When a response is rewritten, the gateway adds:

```
X-EVMFS-Rewritten: from=evmfs.xyz,www.evmfs.xyz; to=yourgateway.com
```

Use this to confirm the rewriter is firing. `curl -I` on any metadata
URL shows it.

### Cache implication

Rewritten responses are not byte-identical to the on-chain payload (the
hash would differ). They're served with `Cache-Control: public,
max-age=3600` instead of the year-long immutable cache used for
unrewritten content. This way a misconfiguration can be rolled forward
fast; the immutable cache is reserved for genuinely content-addressed
responses.

---

## Migrate an existing collection to your gateway

Three scenarios, depending on what admin powers the collection's
contract exposes. Pick the one that matches your situation.

### Case A: contract has `setBaseURI(string)` (most common)

A single transaction is all you need:

```bash
cast send <NFT_CONTRACT> \
  "setBaseURI(string)" \
  "https://yourgateway.com/<chainId>/<metaBlock>/<metaHash>/" \
  --rpc-url <chainRpc> \
  --private-key <ownerKey>
```

Where:

- `<chainId>` is the chain your metadata manifest lives on
  (e.g. `143` for Monad).
- `<metaBlock>` is the block number the manifest was stored at.
- `<metaHash>` is the metadata manifest hash (`0x` + 64 hex chars).

That's it. Marketplaces will pick up the new baseURI on their next
metadata refresh (typically minutes to hours). Image URLs inside the
metadata are rewritten by the gateway on every request — no re-upload
required.

### Case B: contract overrides `tokenURI(uint256)` to call a viewer

Update the constants inside the viewer/wrapper contract if it has an
admin setter, or deploy a new viewer pointing at the new gateway and
swap the wrapper to use it.

### Case C: contract is non-upgradeable AND only exposes `setBaseURI`

Some collections use EIP-1167 minimal proxies that hardcode the
implementation. If the implementation only exposes `setBaseURI(string)`
and has no `setTokenURIHandler` (or similar), case A still applies — it
covers virtually every real-world setup.

**Edge case:** if `setBaseURI` is somehow blocked too, the only options
are (a) a wrap/unwrap rescue contract that mints new tokens whose
tokenURI uses an on-chain viewer, or (b) operating the gateway under
the *same* domain as the original (only possible if you control DNS for
that domain).

---

## Configuration reference

Every option is settable via YAML (`config.yaml`) or env var. Env vars
override YAML when both are present. The EVMFS contract address is the
same on every chain via CREATE2: `0x140cbDFf649929D003091a5B8B3be34588753aBA`.

| YAML key             | Env var              | Default                   | Description                              |
|----------------------|----------------------|---------------------------|------------------------------------------|
| `port`               | `PORT`               | `8080`                    | TCP port to listen on                    |
| `cache_dir`          | `CACHE_DIR`          | `./cache`                 | Filesystem cache directory               |
| `contract_address`   | `CONTRACT_ADDRESS`   | _none_                    | EVMFS contract address (see above)       |
| `rpc_urls` (map)     | `RPC_URLS`           | _none_                    | Per-chain RPC URLs (see format below)    |
| `static_dir`         | `STATIC_DIR`         | _none_                    | Optional static frontend served at `/`   |
| `names_contract`     | `NAMES_CONTRACT`     | _none_                    | EVMFS-Names registry address             |
| `names_chain_id`     | `NAMES_CHAIN_ID`     | _none_                    | Chain ID the names contract lives on     |
| `gateway_domain`     | `GATEWAY_DOMAIN`     | _none_                    | Bare domain for subdomain name lookups   |
| `rewrite_hosts`      | `REWRITE_HOSTS`      | `true`                    | Toggle the URL host rewriter             |
| `rewrite_from_hosts` | `REWRITE_FROM_HOSTS` | `evmfs.xyz,www.evmfs.xyz` | Comma-separated source hosts to rewrite  |

### RPC URL env-var format

```bash
RPC_URLS="1=https://eth.publicnode.com,https://eth.llamarpc.com;143=https://rpc.monad.xyz"
```

Semicolons separate chains. Commas separate URLs within a chain.

### Default RPC suggestions (no API key required)

These public endpoints work but are rate-limited. For non-trivial
traffic, switch to a paid provider (Alchemy, Infura, QuickNode, …) or
run your own node.

**Ethereum mainnet (chain `1`)**

- `https://ethereum-rpc.publicnode.com`
- `https://eth.llamarpc.com`
- `https://rpc.ankr.com/eth`

**Sepolia (chain `11155111`)**

- `https://ethereum-sepolia-rpc.publicnode.com`
- `https://sepolia.drpc.org`

**Monad mainnet (chain `143`)**

- `https://rpc.monad.xyz`
- `https://rpc1.monad.xyz`
- `https://rpc2.monad.xyz`
- `https://rpc-mainnet.monadinfra.com`

---

## Production checklist

Going live on a real domain. Run through each step before announcing
the gateway publicly.

1. **DNS** — point `yourgateway.com` (`A` or `AAAA` record) at your
   server's IP. Wait for propagation (a minute to several hours
   depending on your registrar).
2. **TLS** — the bundled Caddy service in `docker-compose.yml`
   provisions a Let's Encrypt cert on first start. Edit `Caddyfile` to
   use your domain. First request after deploy may take 10–30 seconds
   while the cert is issued.
3. **Firewall** — open ports `80` and `443`. Block direct access to
   `8080` from outside (Caddy proxies internally over the Docker
   network).
4. **RPC selection** — public endpoints rate-limit. For non-trivial
   traffic, switch to paid endpoints or run your own node. Always list
   multiple URLs per chain for automatic failover.
5. **Cache disk** — the gateway caches fetched bytes under `cache_dir`.
   For high-traffic deployments, point at an SSD volume. There's no
   built-in eviction; if disk fills, you'll see write errors in logs.
6. **Monitoring** — wire `GET /health` to your uptime monitor (UptimeRobot,
   Better Uptime, Pingdom, etc.).
7. **Logs** — the gateway logs to stderr. With Docker:
   `docker compose logs -f gateway`.

---

## Operator runbook (incidents)

### Symptom: requests return `502 Bad Gateway`

Almost always an RPC issue. Check:

```bash
docker compose logs gateway | grep "RPC request failed"
```

If your primary RPC is flaky, add fallback URLs in `RPC_URLS`. The
gateway tries them in order, switching after the first failure.

### Symptom: metadata loads but images are broken

If you just changed `baseURI`, marketplaces may still be serving
cached metadata pointing at the old gateway. Wait for the cache to
expire (minutes to hours) or use the marketplace's "refresh metadata"
feature on a few tokens.

If it's been hours, verify the rewriter is actually firing:

```bash
curl -I https://yourgateway.com/143/<metaBlock>/<metaHash>/1
# Look for:
# X-EVMFS-Rewritten: from=evmfs.xyz,www.evmfs.xyz; to=yourgateway.com
```

If the header is absent, check that `REWRITE_HOSTS=true` is set:

```bash
docker compose exec gateway env | grep REWRITE
```

### Symptom: a new chain isn't supported

The EVMFS contract has the same address on every chain via CREATE2, so
adding a chain is just adding RPCs. Edit `RPC_URLS` (env) or
`rpc_urls:` (yaml) and restart:

```bash
RPC_URLS="1=...;143=...;<newChain>=https://rpc.newchain.com"
docker compose restart gateway
```

### Symptom: I want to disable rewriting for some deployment

```bash
REWRITE_HOSTS=false
```

Or in YAML: `rewrite_hosts: false`. The gateway becomes a strict
content-addressed proxy with no transformations.

---

## Verifying the gateway

Three smoke tests any operator should run after deployment:

1. **Health.**

   ```bash
   curl https://yourgateway.com/health
   # expected: ok
   ```

2. **Content retrieval** — pick any known manifest:

   ```bash
   curl https://yourgateway.com/143/71118217/0xd43575d67dc5659f7351892651c0106e4ad4b3e3a6d250a8850dabd56fd6626a/1
   # expected: JSON metadata for SKRUMP #1
   ```

3. **Rewriter active** — same URL, head request:

   ```bash
   curl -I https://yourgateway.com/143/71118217/0xd43575d6.../1
   # expected: `X-EVMFS-Rewritten: from=evmfs.xyz,www.evmfs.xyz; to=yourgateway.com`
   ```

If all three pass, your gateway is operational and ready to handle
real traffic.

---

## Architecture (one paragraph)

The gateway is ~1,000 lines of Go split across small focused files:

| File          | Responsibility                                          |
|---------------|---------------------------------------------------------|
| `main.go`     | Bootstrap, load config, bind port                       |
| `config.go`   | YAML + env loader, default values                       |
| `handlers.go` | HTTP routing, directory listing HTML, response assembly |
| `rpc.go`      | `eth_getLogs` + ABI decode + multi-RPC failover         |
| `detect.go`   | Content-type sniffing from magic bytes                  |
| `cache.go`    | Filesystem cache keyed by `(chainId, contentHash)`      |
| `names.go`    | Optional EVMFS-Names subdomain resolution               |
| `rewriter.go` | URL host rewriting for served text content              |

No database, no message queue, no cron jobs, no admin UI. It's a
request/response server in front of one canonical immutable contract.

---

## Building from source

```bash
go build -o evmfs-gateway .
./evmfs-gateway        # requires config.yaml in cwd OR env vars
```

Cross-compile for other platforms:

```bash
GOOS=linux   GOARCH=amd64 go build -o evmfs-gateway-linux-amd64   .
GOOS=darwin  GOARCH=arm64 go build -o evmfs-gateway-darwin-arm64  .
GOOS=windows GOARCH=amd64 go build -o evmfs-gateway-windows.exe   .
```

The binary is statically linked (use `CGO_ENABLED=0` for fully static
builds) and has no runtime dependencies beyond a working network
connection to your configured RPCs.

---

## Tests

```bash
go test ./...
```

The rewriter has a thorough test suite in `rewriter_test.go` covering:

- Skip for binary content
- HTTPS host substitution
- HTTP scheme normalization
- Protocol-relative URL handling
- Multiple source hosts in one pass
- No-match pass-through
- Empty config no-op
- Unrelated JSON structure preserved
- `currentBase` resolution from TLS state, `X-Forwarded-Proto`, or
  plain HTTP fallback

All 12 tests pass on every supported Go version.

---

## License

MIT, same as the rest of the EVMFS repo.
