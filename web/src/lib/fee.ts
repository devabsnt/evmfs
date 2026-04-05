export const FEE_PER_BYTE = 1_000_000_000n;

export const FEE_RECIPIENT = "0x0000000000000000000000000000000000000000" as const;

export function calculateFee(totalCompressedBytes: number): bigint {
  return FEE_PER_BYTE * BigInt(totalCompressedBytes);
}

export function formatFeeEth(feeWei: bigint): string {
  const eth = Number(feeWei) / 1e18;
  if (eth < 0.000001) return "< 0.000001";
  if (eth < 0.001) return eth.toFixed(6);
  return eth.toFixed(4);
}
