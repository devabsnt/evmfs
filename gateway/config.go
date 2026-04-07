package main

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Port             string              `yaml:"port"`
	CacheDir         string              `yaml:"cache_dir"`
	RPCURLs          map[string][]string `yaml:"rpc_urls"`
	ContractAddress  string              `yaml:"contract_address"`
	StaticDir        string              `yaml:"static_dir"`
	NamesContract    string              `yaml:"names_contract"`
	NamesChainId     string              `yaml:"names_chain_id"`
	GatewayDomain    string              `yaml:"gateway_domain"`
}

func LoadConfig() (*Config, error) {
	cfg := &Config{
		Port:     "8080",
		CacheDir: "./cache",
		RPCURLs:  make(map[string][]string),
	}

	data, err := os.ReadFile("config.yaml")
	if err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config.yaml: %w", err)
		}
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

	return cfg, nil
}
