package main

import (
	"log"
	"net/http"
)

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	cache := NewCache(cfg.CacheDir)

	server := NewServer(cfg, cache)

	addr := ":" + cfg.Port
	log.Printf("EVMFS Gateway starting on %s", addr)
	log.Printf("Cache directory: %s", cfg.CacheDir)
	log.Printf("Contract address: %s", cfg.ContractAddress)
	for chainId, urls := range cfg.RPCURLs {
		log.Printf("Chain %s: %d RPC URL(s)", chainId, len(urls))
	}

	if err := http.ListenAndServe(addr, server); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
