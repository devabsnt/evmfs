import { useState } from "react";

interface PrivateKeyInputProps {
  onSubmit: (privateKey: string) => void;
  disabled?: boolean;
}

export function PrivateKeyInput({ onSubmit, disabled }: PrivateKeyInputProps) {
  const [privateKey, setPrivateKey] = useState("");
  const [visible, setVisible] = useState(false);

  const isValid = /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey);

  return (
    <div>
      <div style={{
        padding: "14px 16px",
        background: "rgba(234, 179, 8, 0.08)",
        borderRadius: 8,
        border: "1px solid rgba(234, 179, 8, 0.2)",
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
        color: "#d1d5db",
      }}>
        <strong style={{ color: "#eab308" }}>Security note:</strong> Your private key stays in your
        browser and is never sent to any server. It's only used locally to sign transactions, and is
        discarded when you close or refresh this page. Even so — for safety, create a new wallet
        specifically for uploading. Transfer only the ETH needed for the upload, then discard the key.
        Never use a wallet that holds significant funds.
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", color: "#9ca3af", fontSize: 13, marginBottom: 6 }}>
          Private key
        </label>
        <div style={{ position: "relative" }}>
          <input
            type={visible ? "text" : "password"}
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="0x..."
            disabled={disabled}
            style={{
              width: "100%",
              padding: "10px 40px 10px 12px",
              background: "#1a1a2e",
              border: "1px solid #2a2a3a",
              borderRadius: 8,
              color: "#e0e0e0",
              fontSize: 14,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#6b7280",
              padding: 4,
            }}
          >
            {visible ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <button
        onClick={() => isValid && onSubmit(privateKey)}
        disabled={!isValid || disabled}
        style={{
          width: "100%",
          padding: "10px 16px",
          background: isValid && !disabled ? "#5b7def" : "#2a2a3a",
          color: isValid && !disabled ? "#fff" : "#6b7280",
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          cursor: isValid && !disabled ? "pointer" : "not-allowed",
          transition: "all 0.2s ease",
        }}
      >
        Use private key for automatic signing
      </button>
    </div>
  );
}
