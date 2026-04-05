package main

import "strings"

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
