package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strings"

	"golang.org/x/crypto/sha3"
)

var storeEventTopic string

func init() {
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte("Store(bytes32,bytes)"))
	storeEventTopic = "0x" + hex.EncodeToString(h.Sum(nil))
}

type jsonRPCRequest struct {
	JSONRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
	ID      int           `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *jsonRPCError   `json:"error"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type logEntry struct {
	Topics []string `json:"topics"`
	Data   string   `json:"data"`
}

var maxBlockRangeByChain = map[string]int64{
	"1":        50000,
	"11155111": 50000,
	"143":      100,
}

const defaultMaxBlockRange int64 = 50000

const fallbackScanWindowCap = 200

// EVMFSBlockIndex deployments — hash -> block sidecar for V1 content.
// Same selector (blockOf) is also exposed by EVMFSV2 directly, so a V2 hash
// can be looked up against the V2 contract address instead. We always try the
// sidecar first; V2 lookups are handled by passing the V2 address.
var blockIndexByChain = map[string]string{
	"1":   "0x85fce8503683a76371568f2f1347cf2c85dddc39",
	"143": "0x2b62d34557e7cb8cb31dc83d2132396d0ef5cad0",
}

// keccak256("blockOf(bytes32)")[:4]
const blockOfSelector = "0x7ee64074"

func maxBlockRangeFor(chainId string) int64 {
	if v, ok := maxBlockRangeByChain[chainId]; ok {
		return v
	}
	return defaultMaxBlockRange
}

func getBlockNumber(rpcURL string) (int64, error) {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "eth_blockNumber",
		Params:  []interface{}{},
		ID:      1,
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return 0, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := http.Post(rpcURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return 0, fmt.Errorf("RPC request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, fmt.Errorf("failed to read response: %w", err)
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return 0, fmt.Errorf("failed to parse response: %w", err)
	}

	if rpcResp.Error != nil {
		return 0, fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	var hexBlock string
	if err := json.Unmarshal(rpcResp.Result, &hexBlock); err != nil {
		return 0, fmt.Errorf("failed to parse block number: %w", err)
	}

	blockNum, ok := new(big.Int).SetString(strings.TrimPrefix(hexBlock, "0x"), 16)
	if !ok {
		return 0, fmt.Errorf("invalid block number: %s", hexBlock)
	}

	return blockNum.Int64(), nil
}

// FetchContent tries each EVMFS contract address against each RPC. Full
// chain scan runs only on the LAST address to avoid scanning N times.
func FetchContent(rpcURLs []string, contractAddresses []string, chainId, contentHash string, blockHint int64) ([]byte, error) {
	if len(rpcURLs) == 0 {
		return nil, fmt.Errorf("no RPC URLs configured")
	}
	if len(contractAddresses) == 0 {
		return nil, fmt.Errorf("no EVMFS contract addresses configured")
	}

	// Without a block hint, try the chain's BlockIndex sidecar before any
	// scan. One eth_call per RPC until one returns a non-zero block.
	if blockHint <= 0 {
		if indexAddr := blockIndexByChain[chainId]; indexAddr != "" {
			for _, rpcURL := range rpcURLs {
				if hinted := lookupBlockOf(rpcURL, indexAddr, contentHash); hinted > 0 {
					blockHint = hinted
					break
				}
			}
		}
	}

	var lastErr error
	for i, contractAddress := range contractAddresses {
		isLast := i == len(contractAddresses)-1
		for _, rpcURL := range rpcURLs {
			var data []byte
			var err error
			if isLast {
				data, err = fetchFromRPC(rpcURL, contractAddress, chainId, contentHash, blockHint)
			} else {
				data, err = fetchFromRPCBlockHintOnly(rpcURL, contractAddress, contentHash, blockHint)
			}
			if err != nil {
				lastErr = err
				continue
			}
			if data != nil {
				return data, nil
			}
		}
	}

	if lastErr != nil {
		return nil, fmt.Errorf("all RPC URLs failed across %d contract(s), last error: %w", len(contractAddresses), lastErr)
	}
	return nil, fmt.Errorf("content not found across %d contract(s)", len(contractAddresses))
}

// lookupBlockOf calls blockOf(bytes32) on a BlockIndex (or V2) contract and
// returns the registered block, or 0 if unregistered / RPC error. Caller
// treats 0 as "no hint, fall back to scan".
func lookupBlockOf(rpcURL, indexAddress, contentHash string) int64 {
	if indexAddress == "" {
		return 0
	}
	clean := strings.TrimPrefix(contentHash, "0x")
	if len(clean) != 64 {
		return 0
	}

	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "eth_call",
		Params: []interface{}{
			map[string]string{"to": indexAddress, "data": blockOfSelector + clean},
			"latest",
		},
		ID: 1,
	}
	reqBody, err := json.Marshal(req)
	if err != nil {
		return 0
	}
	resp, err := http.Post(rpcURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return 0
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return 0
	}
	if rpcResp.Error != nil || len(rpcResp.Result) == 0 {
		return 0
	}

	var hexResult string
	if err := json.Unmarshal(rpcResp.Result, &hexResult); err != nil {
		return 0
	}
	n, ok := new(big.Int).SetString(strings.TrimPrefix(hexResult, "0x"), 16)
	if !ok {
		return 0
	}
	return n.Int64()
}

// fetchFromRPCBlockHintOnly does the tight-window check only, no scan.
func fetchFromRPCBlockHintOnly(rpcURL, contractAddress, contentHash string, blockHint int64) ([]byte, error) {
	if blockHint <= 0 {
		return nil, nil
	}
	from := blockHint - 1
	if from < 0 {
		from = 0
	}
	to := blockHint + 1
	return fetchLogsInRange(rpcURL, contractAddress, contentHash, from, to)
}

func fetchFromRPC(rpcURL, contractAddress, chainId, contentHash string, blockHint int64) ([]byte, error) {
	if blockHint > 0 {
		from := blockHint - 1
		if from < 0 {
			from = 0
		}
		to := blockHint + 1
		data, err := fetchLogsInRange(rpcURL, contractAddress, contentHash, from, to)
		if err != nil {
			return nil, err
		}
		if data != nil {
			return data, nil
		}
		log.Printf("block hint %d missed for %s, falling back to full scan", blockHint, contentHash)
	}

	latestBlock, err := getBlockNumber(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to get latest block: %w", err)
	}

	rangeSize := maxBlockRangeFor(chainId)

	windows := 0
	for toBlock := latestBlock; toBlock >= 0; {
		fromBlock := toBlock - rangeSize + 1
		if fromBlock < 0 {
			fromBlock = 0
		}

		data, err := fetchLogsInRange(rpcURL, contractAddress, contentHash, fromBlock, toBlock)
		if err != nil {
			return nil, err
		}
		if data != nil {
			return data, nil
		}

		if fromBlock == 0 {
			break
		}
		toBlock = fromBlock - 1

		windows++
		if windows >= fallbackScanWindowCap {
			return nil, fmt.Errorf("fallback scan exceeded %d windows on chain %s for %s; aborting to avoid RPC abuse", fallbackScanWindowCap, chainId, contentHash)
		}
	}

	return nil, fmt.Errorf("no logs found for content hash %s", contentHash)
}

func fetchLogsInRange(rpcURL, contractAddress, contentHash string, fromBlock, toBlock int64) ([]byte, error) {
	filter := map[string]interface{}{
		"fromBlock": fmt.Sprintf("0x%x", fromBlock),
		"toBlock":   fmt.Sprintf("0x%x", toBlock),
		"address":   contractAddress,
		"topics": []interface{}{
			storeEventTopic,
			contentHash,
		},
	}

	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "eth_getLogs",
		Params:  []interface{}{filter},
		ID:      1,
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := http.Post(rpcURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("RPC request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("failed to parse RPC response: %w", err)
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	var logs []logEntry
	if err := json.Unmarshal(rpcResp.Result, &logs); err != nil {
		return nil, fmt.Errorf("failed to parse logs: %w", err)
	}

	if len(logs) == 0 {
		return nil, nil
	}

	return abiDecodeBytes(logs[0].Data)
}

func abiDecodeBytes(hexData string) ([]byte, error) {
	hexData = strings.TrimPrefix(hexData, "0x")

	data, err := hex.DecodeString(hexData)
	if err != nil {
		return nil, fmt.Errorf("failed to decode hex data: %w", err)
	}

	if len(data) < 64 {
		return nil, fmt.Errorf("data too short for ABI decoding: %d bytes", len(data))
	}

	offset := new(big.Int).SetBytes(data[0:32])
	if offset.Int64() != 32 {
		return nil, fmt.Errorf("unexpected ABI offset: %d", offset.Int64())
	}

	length := new(big.Int).SetBytes(data[32:64])
	dataLen := int(length.Int64())

	if len(data) < 64+dataLen {
		return nil, fmt.Errorf("data truncated: expected %d bytes, got %d", 64+dataLen, len(data))
	}

	return data[64 : 64+dataLen], nil
}

func doRPC(rpcURL string, req jsonRPCRequest, resp *jsonRPCResponse) error {
	reqBody, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	httpResp, err := http.Post(rpcURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("RPC request failed: %w", err)
	}
	defer httpResp.Body.Close()

	body, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	return json.Unmarshal(body, resp)
}

func jsonUnmarshal(data json.RawMessage, v interface{}) error {
	return json.Unmarshal(data, v)
}
