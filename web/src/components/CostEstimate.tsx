import { useGasEstimate } from "../hooks/useGasEstimate";
import { formatGwei } from "../lib/prices";
import { calculateFee, formatFeeEth } from "../lib/fee";

interface CostEstimateProps {
  totalGas: number;
  fileCount: number;
  batchCount: number;
  totalOriginalSize: number;
  chainId?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function CostEstimate({
  totalGas,
  fileCount,
  batchCount,
  totalOriginalSize,
  chainId,
}: CostEstimateProps) {
  const estimate = useGasEstimate(totalGas, chainId);

  return (
    <div style={{ padding: "24px 0" }}>
      <h3 style={{ color: "#e0e0e0", fontSize: 15, fontWeight: 600, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Upload Summary
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 32px" }}>
        <Stat label="Files" value={fileCount.toString()} />
        <Stat label="Transactions" value={batchCount.toString()} />
        <Stat label="Total size" value={formatBytes(totalOriginalSize)} />
        <Stat label="Total gas" value={totalGas.toLocaleString()} />
        <Stat
          label={`Gas price (${chainName(chainId)})`}
          value={estimate.gasPriceWei ? formatGwei(estimate.gasPriceWei) : "Fetching..."}
        />
        {estimate.ethPrice && (
          <Stat label="ETH price" value={`$${estimate.ethPrice.toLocaleString()}`} />
        )}
      </div>

      <div style={{
        marginTop: 20,
        padding: "16px 20px",
        background: "rgba(91, 125, 239, 0.08)",
        borderRadius: 8,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: "#9ca3af", fontSize: 13, fontWeight: 500 }}>Estimated cost</span>
          <div style={{ textAlign: "right" }}>
            {estimate.costEth ? (
              <>
                <span style={{ color: "#e0e0e0", fontSize: 20, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  {estimate.costEth} ETH
                </span>
                {estimate.costUsd && (
                  <span style={{ color: "#9ca3af", fontSize: 14, marginLeft: 8 }}>
                    ({estimate.costUsd})
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "#6b7280", fontSize: 14 }}>Calculating...</span>
            )}
          </div>
        </div>
        <p style={{ color: "#6b7280", fontSize: 12, margin: "8px 0 0" }}>
          Based on live gas prices for the connected chain. Actual cost may vary.
        </p>
      </div>

      {(() => {
        const fee = calculateFee(totalOriginalSize);
        if (fee <= 0n) return null;
        const feeEth = formatFeeEth(fee);
        const feeUsd = estimate.ethPrice
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              (Number(fee) / 1e18) * estimate.ethPrice
            )
          : null;
        return (
          <div style={{
            marginTop: 12,
            padding: "12px 16px",
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: 8,
            border: "1px solid #1e1e2e",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>Protocol fee</span>
              <div>
                <span style={{ color: "#d1d5db", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                  {feeEth} ETH
                </span>
                {feeUsd && (
                  <span style={{ color: "#6b7280", fontSize: 12, marginLeft: 6 }}>
                    ({feeUsd})
                  </span>
                )}
              </div>
            </div>
            <p style={{ color: "#4b5563", fontSize: 11, margin: "6px 0 0" }}>
              Supports EVMFS development. The underlying contract is free to use directly.
            </p>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#d1d5db", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function chainName(chainId?: number): string {
  const names: Record<number, string> = {
    1: "Ethereum",
    11155111: "Sepolia",
  };
  return chainId ? names[chainId] || `Chain ${chainId}` : "Unknown";
}
