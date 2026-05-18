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
	// Tried in order; first match wins. Supersedes ContractAddress.
	ContractAddresses []string `yaml:"contract_addresses"`
	StaticDir       string              `yaml:"static_dir"`
	NamesContract   string              `yaml:"names_contract"`
	// V2 queried before V1 when set. Defaults to canonical V2 address when NamesContract is configured.
	NamesContractV2 string              `yaml:"names_contract_v2"`
	NamesChainId    string              `yaml:"names_chain_id"`
	GatewayDomain   string              `yaml:"gateway_domain"`

	// Enables host-rewriting of text content so a collection can migrate
	// gateways via setBaseURI() alone without re-uploading metadata. See rewriter.go.
	RewriteHosts bool `yaml:"rewrite_hosts"`

	// Defaults to ["evmfs.xyz", "www.evmfs.xyz"] when RewriteHosts is on and unset.
	RewriteFromHosts []string `yaml:"rewrite_from_hosts"`
}

func (c *Config) applyRewriteDefaults() {
	if c.RewriteHosts && len(c.RewriteFromHosts) == 0 {
		c.RewriteFromHosts = []string{"evmfs.xyz", "www.evmfs.xyz"}
	}
}

// Same on every chain via CREATE2.
const evmfsV2Address = "0xb61cdCDC81d97c32122E668AE782b2327d0a623C"

// Ethereum mainnet.
const evmfsNamesV2Address = "0x86342282edF4A1c50249f16f4Cb11C5921455730"

func (c *Config) applyNamesDefaults() {
	if c.NamesContract != "" && c.NamesContractV2 == "" {
		c.NamesContractV2 = evmfsNamesV2Address
	}
}

func (c *Config) applyContractDefaults() {
	if len(c.ContractAddresses) > 0 {
		return
	}
	var list []string
	list = append(list, evmfsV2Address)
	if c.ContractAddress != "" && !strings.EqualFold(c.ContractAddress, evmfsV2Address) {
		list = append(list, c.ContractAddress)
	}
	c.ContractAddresses = list
}

// ResolvedContractAddresses returns EVMFS contracts to query in priority order.
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
		RewriteHosts: true,
	}

	data, err := os.ReadFile("config.yaml")
	if err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config.yaml: %w", err)
		}
		cfg.applyRewriteDefaults()
		cfg.applyContractDefaults()
		cfg.applyNamesDefaults()
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
	if namesContractV2 := os.Getenv("NAMES_CONTRACT_V2"); namesContractV2 != "" {
		cfg.NamesContractV2 = namesContractV2
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
