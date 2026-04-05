package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var contentHashRegex = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

type Server struct {
	Config    *Config
	Cache     *Cache
	staticFS  http.Handler
	hasStatic bool
}

func NewServer(cfg *Config, cache *Cache) *Server {
	s := &Server{
		Config: cfg,
		Cache:  cache,
	}
	if cfg.StaticDir != "" {
		s.staticFS = http.FileServer(http.Dir(cfg.StaticDir))
		s.hasStatic = true
	}
	return s
}

func isChainId(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isBlockNumber(s string) bool {
	return isChainId(s)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Path
	trailingSlash := strings.HasSuffix(rawPath, "/") && rawPath != "/"
	urlPath := strings.TrimSuffix(rawPath, "/")
	segments := strings.Split(strings.TrimPrefix(urlPath, "/"), "/")

	switch {
	case r.Method == http.MethodGet && urlPath == "/health":
		s.handleHealth(w, r)

	case r.Method == http.MethodGet && len(segments) == 4 && isChainId(segments[0]) && isBlockNumber(segments[1]) && contentHashRegex.MatchString(segments[2]):
		blockNum, _ := strconv.ParseInt(segments[1], 10, 64)
		s.handleManifest(w, r, segments[0], segments[2], segments[3], blockNum)

	case r.Method == http.MethodGet && len(segments) == 3 && isChainId(segments[0]) && isBlockNumber(segments[1]) && contentHashRegex.MatchString(segments[2]) && trailingSlash:
		blockNum, _ := strconv.ParseInt(segments[1], 10, 64)
		s.handleDirectory(w, r, segments[0], segments[2], blockNum)

	case r.Method == http.MethodGet && len(segments) == 3 && isChainId(segments[0]) && isBlockNumber(segments[1]) && contentHashRegex.MatchString(segments[2]):
		blockNum, _ := strconv.ParseInt(segments[1], 10, 64)
		s.handleFile(w, segments[0], segments[2], blockNum)

	case r.Method == http.MethodGet && len(segments) == 3 && isChainId(segments[0]) && contentHashRegex.MatchString(segments[1]):
		s.handleManifest(w, r, segments[0], segments[1], segments[2], 0)

	case r.Method == http.MethodGet && len(segments) == 2 && isChainId(segments[0]) && contentHashRegex.MatchString(segments[1]):
		s.handleFile(w, segments[0], segments[1], 0)

	default:
		if s.hasStatic {
			s.staticFS.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func (s *Server) handleFile(w http.ResponseWriter, chainId, contentHash string, blockHint int64) {
	if !contentHashRegex.MatchString(contentHash) {
		http.Error(w, "invalid content hash: must be 0x + 64 hex characters", http.StatusBadRequest)
		return
	}

	data, err := s.fetchAndDecompress(chainId, contentHash, blockHint)
	if err != nil {
		log.Printf("error fetching %s/%s: %v", chainId, contentHash, err)
		http.Error(w, fmt.Sprintf("failed to fetch content: %v", err), http.StatusBadGateway)
		return
	}

	contentType := DetectContentType(data)
	s.serveContent(w, data, contentType)
}

type manifestEntry struct {
	H string `json:"h"`
	B int64  `json:"b"`
}

func parseManifest(data []byte) ([]manifestEntry, error) {
	var entries []manifestEntry
	if err := json.Unmarshal(data, &entries); err == nil && len(entries) > 0 && entries[0].H != "" {
		return entries, nil
	}

	var hashes []string
	if err := json.Unmarshal(data, &hashes); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}
	entries = make([]manifestEntry, len(hashes))
	for i, h := range hashes {
		entries[i] = manifestEntry{H: h, B: 0}
	}
	return entries, nil
}

func (s *Server) handleManifest(w http.ResponseWriter, r *http.Request, chainId, manifestHash, tokenIdStr string, blockHint int64) {
	if !contentHashRegex.MatchString(manifestHash) {
		http.Error(w, "invalid manifest hash: must be 0x + 64 hex characters", http.StatusBadRequest)
		return
	}

	tokenId, err := strconv.Atoi(tokenIdStr)
	if err != nil {
		http.Error(w, "invalid token ID: must be an integer", http.StatusBadRequest)
		return
	}

	manifestData, err := s.fetchAndDecompress(chainId, manifestHash, blockHint)
	if err != nil {
		log.Printf("error fetching manifest %s/%s: %v", chainId, manifestHash, err)
		http.Error(w, fmt.Sprintf("failed to fetch manifest: %v", err), http.StatusBadGateway)
		return
	}

	entries, err := parseManifest(manifestData)
	if err != nil {
		log.Printf("error parsing manifest %s/%s: %v", chainId, manifestHash, err)
		http.Error(w, "failed to parse manifest", http.StatusInternalServerError)
		return
	}

	if tokenId < 0 || tokenId >= len(entries) {
		http.Error(w, fmt.Sprintf("token ID %d out of range (manifest has %d entries)", tokenId, len(entries)), http.StatusNotFound)
		return
	}

	entry := entries[tokenId]
	if !contentHashRegex.MatchString(entry.H) {
		http.Error(w, "invalid content hash in manifest", http.StatusInternalServerError)
		return
	}

	data, err := s.fetchAndDecompress(chainId, entry.H, entry.B)
	if err != nil {
		log.Printf("error fetching content %s/%s from manifest: %v", chainId, entry.H, err)
		http.Error(w, fmt.Sprintf("failed to fetch content: %v", err), http.StatusBadGateway)
		return
	}

	contentType := DetectContentType(data)
	s.serveContent(w, data, contentType)
}

func (s *Server) handleDirectory(w http.ResponseWriter, r *http.Request, chainId, manifestHash string, blockHint int64) {
	if !contentHashRegex.MatchString(manifestHash) {
		http.Error(w, "invalid manifest hash: must be 0x + 64 hex characters", http.StatusBadRequest)
		return
	}

	manifestData, err := s.fetchAndDecompress(chainId, manifestHash, blockHint)
	if err != nil {
		log.Printf("error fetching manifest %s/%s: %v", chainId, manifestHash, err)
		http.Error(w, fmt.Sprintf("failed to fetch manifest: %v", err), http.StatusBadGateway)
		return
	}

	entries, err := parseManifest(manifestData)
	if err != nil {
		log.Printf("error parsing manifest %s/%s: %v", chainId, manifestHash, err)
		http.Error(w, "failed to parse manifest", http.StatusInternalServerError)
		return
	}

	if r.URL.Query().Get("format") == "json" {
		type jsonEntry struct {
			Index int    `json:"index"`
			Hash  string `json:"hash"`
			Block int64  `json:"block,omitempty"`
		}
		out := make([]jsonEntry, len(entries))
		for i, e := range entries {
			out[i] = jsonEntry{Index: i, Hash: e.H, Block: e.B}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(out)
		return
	}

	basePath := r.URL.Path
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}

	shortHash := manifestHash
	if len(shortHash) > 14 {
		shortHash = shortHash[:10] + "..." + shortHash[len(shortHash)-4:]
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><meta charset="utf-8">`)
	sb.WriteString(fmt.Sprintf(`<title>EVMFS / %s / %s</title>`, chainId, shortHash))
	sb.WriteString(`<meta name="viewport" content="width=device-width,initial-scale=1">`)
	sb.WriteString(`<style>
body{background:#0f0f1a;color:#d1d5db;font-family:'JetBrains Mono',monospace;margin:0;padding:32px}
a{color:#5b7def;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:16px;color:#e0e0e0;margin:0 0 4px;font-weight:600}
.sub{color:#6b7280;font-size:13px;margin:0 0 24px}
table{border-collapse:collapse;width:100%;max-width:720px}
th{text-align:left;color:#6b7280;font-size:12px;padding:8px 12px;border-bottom:1px solid #1e1e2e}
td{padding:6px 12px;font-size:13px;border-bottom:1px solid #1a1a2e}
tr:hover{background:#13131f}
.hash{color:#6b7280;font-size:12px}
</style></head><body>`)
	sb.WriteString(fmt.Sprintf(`<h1>EVMFS / %s / %s</h1>`, chainId, shortHash))
	sb.WriteString(fmt.Sprintf(`<p class="sub">%d files &middot; <a href="?format=json">JSON</a></p>`, len(entries)))
	sb.WriteString(`<table><tr><th>#</th><th>Hash</th></tr>`)

	for i, e := range entries {
		eShort := e.H
		if len(eShort) > 14 {
			eShort = eShort[:10] + "..." + eShort[len(eShort)-4:]
		}
		sb.WriteString(fmt.Sprintf(
			`<tr><td><a href="%s%d">%d</a></td><td class="hash">%s</td></tr>`,
			basePath, i, i, eShort,
		))
	}

	sb.WriteString(`</table></body></html>`)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(sb.String()))
}

func (s *Server) fetchAndDecompress(chainId, contentHash string, blockHint int64) ([]byte, error) {
	cached, err := s.Cache.Get(chainId, contentHash)
	if err != nil {
		log.Printf("cache read error for %s/%s: %v", chainId, contentHash, err)
	}
	if cached != nil {
		return cached, nil
	}

	rpcURLs, ok := s.Config.RPCURLs[chainId]
	if !ok || len(rpcURLs) == 0 {
		return nil, fmt.Errorf("no RPC URLs configured for chain %s", chainId)
	}

	raw, err := FetchContent(rpcURLs, s.Config.ContractAddress, contentHash, blockHint)
	if err != nil {
		return nil, err
	}

	result := raw
	if decompressed, err := gunzip(raw); err == nil {
		result = decompressed
	}

	if err := s.Cache.Set(chainId, contentHash, result); err != nil {
		log.Printf("cache write error for %s/%s: %v", chainId, contentHash, err)
	}

	return result, nil
}

func gunzip(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	return io.ReadAll(reader)
}

func (s *Server) serveContent(w http.ResponseWriter, data []byte, contentType string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}
