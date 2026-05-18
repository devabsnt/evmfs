package main

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Port            string              `yaml:"port"`
	CacheDir        string              `yaml:"cache_dir"`
	RPCURLs         map[string][]string `yaml:"rpc_urls"`
	ContractAddress string              `yaml:"contract_address"`
	// ContractAddresses is the full list of EVMFS contract addresses to
	// query. When set, supersedes ContractAddress. Allows the gateway to
	// serve content from both V1 and V2 (and any future versions) without
	// the caller needing to specify which. Tried in order; the first one
	// that returns a log wins. Default: [ContractAddress, V2 address] when
	// only the legacy single field is set, ensuring V1 + V2 both work
	// out of the box.
	ContractAddresses []string `yaml:"contract_addresses"`
	StaticDir       string              `yaml:"static_dir"`
	NamesContract   string              `yaml:"names_contract"`
	NamesChainId    string              `yaml:"names_chain_id"`
	GatewayDomain   string              `yaml:"gateway_domain"`

	// RewriteHosts toggles the URL host rewriter (see rewriter.go). When
	// true, text-based content served by this gateway has references to
	// hosts in RewriteFromHosts rewritten to the request's current host.
	// This is what lets a collection migrate from evmfs.xyz to a self-hosted
	// gateway with a single setBaseURI() transaction — metadata files
	// still contain hardcoded "https://evmfs.xyz/..." URLs in their on-chain
	// bytes, but the gateway normalizes them on the way out.
	RewriteHosts bool `yaml:"rewrite_hosts"`

	// RewriteFromHosts is the list of source hosts the rewriter watches
	// for. Defaults to ["evmfs.xyz", "www.evmfs.xyz"] when RewriteHosts is
	// enabled and no explicit list is given.
	RewriteFromHosts []string `yaml:"rewrite_from_hosts"`
}

// applyRewriteDefaults sets sensible defaults for the rewriter when the
// config opts in but doesn't list explicit hosts.
func (c *Config) applyRewriteDefaults() {
	if c.RewriteHosts && len(c.RewriteFromHosts) == 0 {
		c.RewriteFromHosts = []string{"evmfs.xyz", "www.evmfs.xyz"}
	}
}

// EVMFSV2 contract address (same on every chain via CREATE2).
const evmfsV2Address = "0xb61cdCDC81d97c32122E668AE782b2327d0a623C"

// applyContractDefaults derives ContractAddresses from the legacy single
// ContractAddress field if the operator hasn't set an explicit list. The
// resulting list contains V2 (tried first — recommended for new uploads)
// followed by the configured V1 address (fallback for legacy content).
// Operators with collections on a non-canonical contract can override the
// whole list via `contract_addresses:` in YAML or CONTRACT_ADDRESSES env.
func (c *Config) applyContractDefaults() {
	if len(c.ContractAddresses) > 0 {
		return // operator set an explicit list; respect it
	}
	var list []string
	// V2 first — forward-looking. Most new content lives here.
	list = append(list, evmfsV2Address)
	// V1 fallback — legacy content (e.g. Skrumpeys) still works.
	if c.ContractAddress != "" && !strings.EqualFold(c.ContractAddress, evmfsV2Address) {
		list = append(list, c.ContractAddress)
	}
	c.ContractAddresses = list
}

// ResolvedContractAddresses returns the list of EVMFS contracts to query
// for content lookups. Tools should iterate this list in order and use the
// first match.
func (c *Config) ResolvedContractAddresses() []string {
	if len(c.ContractAddresses) > 0 {
		return c.ContractAddresses
	}
	if c.ContractAddress != "" {
		return []string{c.ContractAddress}
	}
	return nil
}

func LoadConfig() (*Config, error) {
	cfg := &Config{
		Port:         "8080",
		CacheDir:     "./cache",
		RPCURLs:      make(map[string][]string),
		RewriteHosts: true, // default ON — self-hosted gateways will almost
		// always want this. Operators can set rewrite_hosts: false in
		// config.yaml (or REWRITE_HOSTS=false in env) to opt out.
	}

	data, err := os.ReadFile("config.yaml")
	if err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config.yaml: %w", err)
		}
		cfg.applyRewriteDefaults()
		cfg.applyContractDefaults()
		return cfg, nil
	}

	if port := os.Getenv("PORT"); port != "" {
		cfg.Port = port
	}

	if cacheDir := os.Getenv("CACHE_DIR"); cacheDir != "" {
		cfg.CacheDir = cacheDir
	}

	if contractAddr := os.Getenv("CONTRACT_ADDRESS"); contractAddr != "" {
		cfg.ContractAddress = contractAddr
	}

	if staticDir := os.Getenv("STATIC_DIR"); staticDir != "" {
		cfg.StaticDir = staticDir
	}

	if namesContract := os.Getenv("NAMES_CONTRACT"); namesContract != "" {
		cfg.NamesContract = namesContract
	}
	if namesChainId := os.Getenv("NAMES_CHAIN_ID"); namesChainId != "" {
		cfg.NamesChainId = namesChainId
	}
	if gatewayDomain := os.Getenv("GATEWAY_DOMAIN"); gatewayDomain != "" {
		cfg.GatewayDomain = gatewayDomain
	}

	if v := os.Getenv("REWRITE_HOSTS"); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "0", "false", "no", "off":
			cfg.RewriteHosts = false
		case "1", "true", "yes", "on":
			cfg.RewriteHosts = true
		}
	}
	if v := os.Getenv("REWRITE_FROM_HOSTS"); v != "" {
		var hosts []string
		for _, h := range strings.Split(v, ",") {
			h = strings.TrimSpace(h)
			if h != "" {
				hosts = append(hosts, h)
			}
		}
		cfg.RewriteFromHosts = hosts
	}

	if rpcURLsEnv := os.Getenv("RPC_URLS"); rpcURLsEnv != "" {
		chains := strings.Split(rpcURLsEnv, ";")
		for _, chain := range chains {
			chain = strings.TrimSpace(chain)
			if chain == "" {
				continue
			}
			parts := strings.SplitN(chain, "=", 2)
			if len(parts) != 2 {
				return nil, fmt.Errorf("invalid RPC_URLS format for entry: %s", chain)
			}
			chainId := strings.TrimSpace(parts[0])
			urls := strings.Split(parts[1], ",")
			var trimmedURLs []string
			for _, u := range urls {
				u = strings.TrimSpace(u)
				if u != "" {
					trimmedURLs = append(trimmedURLs, u)
				}
			}
			cfg.RPCURLs[chainId] = trimmedURLs
		}
	}

	cfg.applyRewriteDefaults()
	cfg.applyContractDefaults()
	return cfg, nil
}
