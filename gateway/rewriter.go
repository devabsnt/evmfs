package main

import (
	"bytes"
	"net/http"
	"strings"
)

// URL host-rewriting: normalizes hardcoded references to other gateways
// (e.g. https://evmfs.xyz/...) so a collection can migrate gateways via
// setBaseURI() alone without re-uploading on-chain metadata.

func isRewriteable(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch ct {
	case "application/json",
		"application/manifest+json",
		"application/javascript",
		"application/xml",
		"text/html",
		"text/css",
		"text/javascript",
		"text/plain",
		"text/xml",
		"image/svg+xml":
		return true
	}
	return false
}

// currentBase returns "<scheme>://<host>", respecting X-Forwarded-Proto.
func currentBase(r *http.Request) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		if i := strings.Index(proto, ","); i >= 0 {
			proto = strings.TrimSpace(proto[:i])
		}
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// rewriteURLs replaces absolute and protocol-relative references to any
// fromHosts with the request's current base. Bare hostnames are not touched
// to avoid false positives.
func rewriteURLs(data []byte, contentType string, r *http.Request, fromHosts []string) ([]byte, bool) {
	if !isRewriteable(contentType) || len(fromHosts) == 0 || len(data) == 0 {
		return data, false
	}
	base := currentBase(r)
	hostOnly := r.Host

	rewritten := false
	out := data
	for _, host := range fromHosts {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		patterns := []struct{ from, to string }{
			{"https://" + host, base},
			{"http://" + host, base},
			{"//" + host, "//" + hostOnly},
		}
		for _, p := range patterns {
			// Identity substitution (gateway hosted at the canonical host
			// itself): skip without marking rewritten so immutable cache
			// header is preserved.
			if p.from == p.to {
				continue
			}
			if bytes.Contains(out, []byte(p.from)) {
				out = bytes.ReplaceAll(out, []byte(p.from), []byte(p.to))
				rewritten = true
			}
		}
	}
	return out, rewritten
}
