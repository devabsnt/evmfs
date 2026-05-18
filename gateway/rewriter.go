package main

import (
	"bytes"
	"net/http"
	"strings"
)

// URL host-rewriting helpers.
//
// When a gateway serves text-based content from chain (typically NFT metadata
// JSON, but also HTML and CSS for static-site manifests), the content may
// contain hardcoded URLs pointing at *another* gateway — most commonly
// "https://evmfs.xyz/...". If a collection has migrated to a self-hosted
// gateway, those references would still try to resolve at the original host.
//
// rewriteURLs scans the served bytes for references to any host in fromHosts
// and replaces them with the current request's host (with the same scheme).
// This lets a collection owner switch gateways by changing baseURI alone —
// no metadata re-upload required — because every URL inside the served
// content is normalized to the gateway it's currently being fetched from.

// rewriteableContentTypes is the set of content types whose bodies are
// scanned for URL rewrites. Binary formats (PNG, MP4, fonts, …) are passed
// through unchanged.
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

// currentBase returns "<scheme>://<host>" for the request, respecting
// X-Forwarded-Proto when behind a reverse proxy. r.TLS is also a fallback
// for the rare case the gateway is exposed directly on HTTPS.
func currentBase(r *http.Request) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		// Trust the proxy hint. Only the first value if a list.
		if i := strings.Index(proto, ","); i >= 0 {
			proto = strings.TrimSpace(proto[:i])
		}
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// rewriteURLs returns data with every absolute reference to any host in
// fromHosts replaced by the request's current base URL. If no rewrites are
// applicable, the input is returned unchanged.
//
// Three forms are handled per host:
//
//	https://host  →  <current scheme>://<current host>
//	http://host   →  <current scheme>://<current host>
//	//host        →  //<current host>          (protocol-relative)
//
// We don't touch other forms (bare hostnames in href attributes, etc.) to
// avoid false positives inside otherwise-unrelated content.
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
			if bytes.Contains(out, []byte(p.from)) {
				out = bytes.ReplaceAll(out, []byte(p.from), []byte(p.to))
				rewritten = true
			}
		}
	}
	return out, rewritten
}
