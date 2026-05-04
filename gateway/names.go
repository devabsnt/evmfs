package main

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/sha3"
)

type SiteInfo struct {
	BlockNumber  int64
	ManifestHash string
}

var ErrNameNotRegistered = errors.New("name not registered")

const (
	nameCacheTTL     = 60 * time.Second
	nameCacheMaxSize = 10000
)

type nameCacheEntry struct {
	info      *SiteInfo
	err       error
	expiresAt time.Time
}

type NameCache struct {
	mu      sync.Mutex
	entries map[string]nameCacheEntry

	flightMu sync.Mutex
	flight   map[string]*inflightLookup
}

type inflightLookup struct {
	wg   sync.WaitGroup
	info *SiteInfo
	err  error
}

func NewNameCache() *NameCache {
	c := &NameCache{
		entries: make(map[string]nameCacheEntry),
		flight:  make(map[string]*inflightLookup),
	}
	go c.cleanupLoop()
	return c
}

// do collapses concurrent lookups for the same name into a single fn() call.
// Other callers wait for the first call to complete and receive the same result.
func (c *NameCache) do(name string, fn func() (*SiteInfo, error)) (*SiteInfo, error) {
	c.flightMu.Lock()
	if inf, ok := c.flight[name]; ok {
		c.flightMu.Unlock()
		inf.wg.Wait()
		return inf.info, inf.err
	}
	inf := &inflightLookup{}
	inf.wg.Add(1)
	c.flight[name] = inf
	c.flightMu.Unlock()

	defer func() {
		c.flightMu.Lock()
		delete(c.flight, name)
		c.flightMu.Unlock()
		inf.wg.Done()
	}()

	inf.info, inf.err = fn()
	return inf.info, inf.err
}

func (c *NameCache) get(name string) (nameCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[name]
	if !ok || time.Now().After(e.expiresAt) {
		return nameCacheEntry{}, false
	}
	return e, true
}

func (c *NameCache) set(name string, info *SiteInfo, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= nameCacheMaxSize {
		// Drop expired entries; if still full, drop arbitrary ones.
		now := time.Now()
		for k, v := range c.entries {
			if now.After(v.expiresAt) {
				delete(c.entries, k)
			}
		}
		for k := range c.entries {
			if len(c.entries) < nameCacheMaxSize {
				break
			}
			delete(c.entries, k)
		}
	}
	c.entries[name] = nameCacheEntry{
		info:      info,
		err:       err,
		expiresAt: time.Now().Add(nameCacheTTL),
	}
}

func (c *NameCache) cleanupLoop() {
	t := time.NewTicker(nameCacheTTL)
	defer t.Stop()
	for range t.C {
		c.mu.Lock()
		now := time.Now()
		for k, v := range c.entries {
			if now.After(v.expiresAt) {
				delete(c.entries, k)
			}
		}
		c.mu.Unlock()
	}
}

// lookupName queries the EVMFSNames contract for a registered name.
// Calls lookup(string) which returns (address owner, uint64 blockNumber, bytes32 manifestHash).
func (s *Server) lookupName(name string) (*SiteInfo, error) {
	if s.Config.NamesContract == "" || s.Config.NamesChainId == "" {
		return nil, fmt.Errorf("names contract not configured")
	}

	if s.NameCache != nil {
		if e, ok := s.NameCache.get(name); ok {
			return e.info, e.err
		}
	}

	rpcURLs, ok := s.Config.RPCURLs[s.Config.NamesChainId]
	if !ok || len(rpcURLs) == 0 {
		return nil, fmt.Errorf("no RPC URLs for names chain %s", s.Config.NamesChainId)
	}

	// Build calldata: lookup(string)
	selectorHash := sha3.NewLegacyKeccak256()
	selectorHash.Write([]byte("lookup(string)"))
	selector := selectorHash.Sum(nil)[:4]

	// ABI-encode the string argument
	nameBytes := []byte(name)
	offset := make([]byte, 32)
	offset[31] = 0x20
	length := make([]byte, 32)
	length[31] = byte(len(nameBytes))
	if len(nameBytes) > 255 {
		length[30] = byte(len(nameBytes) >> 8)
	}
	padded := make([]byte, ((len(nameBytes)+31)/32)*32)
	copy(padded, nameBytes)

	calldata := append(selector, offset...)
	calldata = append(calldata, length...)
	calldata = append(calldata, padded...)

	calldataHex := "0x" + hex.EncodeToString(calldata)

	doRPC := func() (*SiteInfo, error) {
		// Re-check cache: a concurrent caller may have populated it while we waited.
		if s.NameCache != nil {
			if e, ok := s.NameCache.get(name); ok {
				return e.info, e.err
			}
		}

		var lastErr error
		for _, rpcURL := range rpcURLs {
			result, err := ethCall(rpcURL, s.Config.NamesContract, calldataHex)
			if err != nil {
				lastErr = err
				continue
			}

			info, err := decodeLookupResult(result)
			if err != nil {
				lastErr = err
				continue
			}
			if s.NameCache != nil {
				s.NameCache.set(name, info, nil)
			}
			return info, nil
		}
		if errors.Is(lastErr, ErrNameNotRegistered) {
			err := fmt.Errorf("lookup failed: %w", lastErr)
			if s.NameCache != nil {
				s.NameCache.set(name, nil, err)
			}
			return nil, err
		}
		return nil, fmt.Errorf("lookup failed: %w", lastErr)
	}

	if s.NameCache != nil {
		return s.NameCache.do(name, doRPC)
	}
	return doRPC()
}

func ethCall(rpcURL, to, data string) (string, error) {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "eth_call",
		Params: []interface{}{
			map[string]string{
				"to":   to,
				"data": data,
			},
			"latest",
		},
		ID: 1,
	}

	var rpcResp jsonRPCResponse
	if err := doRPC(rpcURL, req, &rpcResp); err != nil {
		return "", err
	}
	if rpcResp.Error != nil {
		return "", fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	var result string
	if err := jsonUnmarshal(rpcResp.Result, &result); err != nil {
		return "", fmt.Errorf("failed to parse result: %w", err)
	}
	return result, nil
}

// decodeLookupResult decodes: (address owner, uint64 blockNumber, bytes32 manifestHash)
// = 3 x 32 bytes = 96 bytes
func decodeLookupResult(hexData string) (*SiteInfo, error) {
	hexData = strings.TrimPrefix(hexData, "0x")
	if len(hexData) < 192 { // 96 bytes = 192 hex chars
		return nil, fmt.Errorf("response too short: %d chars", len(hexData))
	}

	data, err := hex.DecodeString(hexData)
	if err != nil {
		return nil, fmt.Errorf("hex decode error: %w", err)
	}

	// Word 0: address (last 20 bytes of 32-byte word)
	owner := data[12:32]
	isZero := true
	for _, b := range owner {
		if b != 0 {
			isZero = false
			break
		}
	}
	if isZero {
		return nil, ErrNameNotRegistered
	}

	// Word 1: uint64 blockNumber (last 8 bytes)
	blockNum := int64(0)
	for _, b := range data[56:64] {
		blockNum = blockNum*256 + int64(b)
	}

	// Word 2: bytes32 manifestHash
	manifestHash := "0x" + hex.EncodeToString(data[64:96])

	return &SiteInfo{
		BlockNumber:  blockNum,
		ManifestHash: manifestHash,
	}, nil
}
