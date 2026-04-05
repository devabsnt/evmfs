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

const maxBlockRange int64 = 50000

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

func FetchContent(rpcURLs []string, contractAddress string, contentHash string, blockHint int64) ([]byte, error) {
	if len(rpcURLs) == 0 {
		return nil, fmt.Errorf("no RPC URLs configured")
	}

	var lastErr error
	for _, rpcURL := range rpcURLs {
		data, err := fetchFromRPC(rpcURL, contractAddress, contentHash, blockHint)
		if err != nil {
			lastErr = err
			continue
		}
		return data, nil
	}

	return nil, fmt.Errorf("all RPC URLs failed, last error: %w", lastErr)
}

func fetchFromRPC(rpcURL, contractAddress, contentHash string, blockHint int64) ([]byte, error) {
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

	for toBlock := latestBlock; toBlock >= 0; {
		fromBlock := toBlock - maxBlockRange + 1
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
