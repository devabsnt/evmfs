package main

import (
	"crypto/tls"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsRewriteable(t *testing.T) {
	cases := []struct {
		ct   string
		want bool
	}{
		{"application/json", true},
		{"application/json; charset=utf-8", true},
		{"text/html", true},
		{"text/html; charset=utf-8", true},
		{"text/css", true},
		{"text/css ; charset=utf-8", true},
		{"image/svg+xml", true},
		{"application/javascript", true},
		{"application/manifest+json", true},
		{"image/png", false},
		{"image/jpeg", false},
		{"video/mp4", false},
		{"application/octet-stream", false},
		{"", false},
		{"FONT/WOFF2", false},
	}
	for _, c := range cases {
		got := isRewriteable(c.ct)
		if got != c.want {
			t.Errorf("isRewriteable(%q) = %v; want %v", c.ct, got, c.want)
		}
	}
}

func TestRewriteURLs_SkipsBinaryContent(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	// PNG header bytes containing the string "evmfs.xyz" in payload —
	// rewriter should leave them alone because content type is image/png.
	payload := []byte("\x89PNG\r\n\x1a\n  evmfs.xyz some image bytes")
	out, rw := rewriteURLs(payload, "image/png", r, []string{"evmfs.xyz"})
	if rw {
		t.Errorf("expected no rewrite for binary content; got rewritten")
	}
	if string(out) != string(payload) {
		t.Errorf("binary content was modified")
	}
}

func TestRewriteURLs_JSONHttpsHostReplaced(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")

	in := []byte(`{"image":"https://evmfs.xyz/143/71117086/0x764b2270.../1.png","name":"SKRUMP #1"}`)
	want := `{"image":"https://newgateway.com/143/71117086/0x764b2270.../1.png","name":"SKRUMP #1"}`
	out, rw := rewriteURLs(in, "application/json", r, []string{"evmfs.xyz"})
	if !rw {
		t.Fatalf("expected rewrite to occur")
	}
	if string(out) != want {
		t.Errorf("rewrite mismatch:\n  got:  %s\n  want: %s", out, want)
	}
}

func TestRewriteURLs_HTTPSchemeAlsoHandled(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")

	in := []byte(`{"image":"http://evmfs.xyz/143/X/Y/1.png"}`)
	want := `{"image":"https://newgateway.com/143/X/Y/1.png"}`
	out, rw := rewriteURLs(in, "application/json", r, []string{"evmfs.xyz"})
	if !rw {
		t.Fatalf("expected rewrite to occur")
	}
	if string(out) != want {
		t.Errorf("got %q want %q", out, want)
	}
}

func TestRewriteURLs_ProtocolRelativeHandled(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")

	in := []byte(`<link rel="stylesheet" href="//evmfs.xyz/143/X/Y/style.css">`)
	want := `<link rel="stylesheet" href="//newgateway.com/143/X/Y/style.css">`
	out, rw := rewriteURLs(in, "text/html", r, []string{"evmfs.xyz"})
	if !rw {
		t.Fatalf("expected rewrite to occur")
	}
	if string(out) != want {
		t.Errorf("got %q want %q", out, want)
	}
}

func TestRewriteURLs_MultipleHosts(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")

	in := []byte(`{"a":"https://evmfs.xyz/x","b":"https://www.evmfs.xyz/y","c":"https://other.com/z"}`)
	want := `{"a":"https://newgateway.com/x","b":"https://newgateway.com/y","c":"https://other.com/z"}`
	out, rw := rewriteURLs(in, "application/json", r, []string{"evmfs.xyz", "www.evmfs.xyz"})
	if !rw {
		t.Fatalf("expected rewrite to occur")
	}
	if string(out) != want {
		t.Errorf("got %q want %q", out, want)
	}
}

func TestRewriteURLs_NoMatchReturnsOriginal(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"

	in := []byte(`{"image":"https://example.com/foo.png"}`)
	out, rw := rewriteURLs(in, "application/json", r, []string{"evmfs.xyz"})
	if rw {
		t.Errorf("expected no rewrite")
	}
	if string(out) != string(in) {
		t.Errorf("content modified despite no matching hosts")
	}
}

func TestRewriteURLs_EmptyHostsListIsNoOp(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	in := []byte(`{"image":"https://evmfs.xyz/1.png"}`)
	out, rw := rewriteURLs(in, "application/json", r, nil)
	if rw {
		t.Errorf("expected no rewrite with empty hosts list")
	}
	if string(out) != string(in) {
		t.Errorf("content modified")
	}
}

func TestRewriteURLs_PreservesUnrelatedJsonStructure(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")

	in := []byte(`{"name":"SKRUMP #1","description":"see https://evmfs.xyz for more","image":"https://evmfs.xyz/143/X/Y/1.png","attributes":[{"trait_type":"color","value":"red"}]}`)
	out, _ := rewriteURLs(in, "application/json", r, []string{"evmfs.xyz"})
	// Both occurrences (description and image) should be rewritten.
	if strings.Contains(string(out), "evmfs.xyz") {
		t.Errorf("rewrite missed an occurrence: %s", out)
	}
	if !strings.Contains(string(out), `"trait_type":"color"`) {
		t.Errorf("rewrite damaged unrelated structure")
	}
}

func TestCurrentBase_FromTLS(t *testing.T) {
	r := httptest.NewRequest("GET", "https://newgateway.com/foo", nil)
	r.TLS = &tls.ConnectionState{}
	r.Host = "newgateway.com"
	got := currentBase(r)
	if got != "https://newgateway.com" {
		t.Errorf("got %q want %q", got, "https://newgateway.com")
	}
}

func TestCurrentBase_FromForwardedProto(t *testing.T) {
	r := httptest.NewRequest("GET", "/foo", nil)
	r.Host = "newgateway.com"
	r.Header.Set("X-Forwarded-Proto", "https")
	got := currentBase(r)
	if got != "https://newgateway.com" {
		t.Errorf("got %q want %q", got, "https://newgateway.com")
	}
}

func TestCurrentBase_PlainHTTPFallback(t *testing.T) {
	r := httptest.NewRequest("GET", "/foo", nil)
	r.Host = "localhost:8080"
	got := currentBase(r)
	if got != "http://localhost:8080" {
		t.Errorf("got %q want %q", got, "http://localhost:8080")
	}
}

