package main

import (
	"path/filepath"
	"strings"
)

var extToContentType = map[string]string{
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "application/javascript; charset=utf-8",
	".json":  "application/json",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".webp":  "image/webp",
	".woff2": "font/woff2",
	".woff":  "font/woff",
	".wasm":  "application/wasm",
	".ico":   "image/x-icon",
	".txt":   "text/plain; charset=utf-8",
	".xml":   "application/xml",
	".pdf":   "application/pdf",
	".map":   "application/json",
	".mjs":   "application/javascript; charset=utf-8",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".eot":   "application/vnd.ms-fontobject",
}

func contentTypeByExtension(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ct, ok := extToContentType[ext]; ok {
		return ct
	}
	return ""
}

func DetectContentType(data []byte) string {
	if len(data) == 0 {
		return "application/octet-stream"
	}

	if len(data) >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}

	if len(data) >= 4 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return "image/gif"
	}

	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}

	if len(data) >= 4 && data[0] == 0x3C && data[1] == 0x73 && data[2] == 0x76 && data[3] == 0x67 {
		return "image/svg+xml"
	}
	trimmed := strings.TrimSpace(string(data))
	if strings.HasPrefix(trimmed, "<svg") {
		return "image/svg+xml"
	}

	if data[0] == 0x7B {
		return "application/json"
	}

	if len(data) >= 2 && data[0] == 0x3C && (data[1] == 0x21 || data[1] == 0x68) {
		return "text/html"
	}

	return "application/octet-stream"
}
