export const FEE_PER_BYTE = 500_000_000n;

export const FEE_RECIPIENT = "0xc9be9069F1fD43b82145Fa8709050D52d803E81a" as const;

export function calculateFee(totalCompressedBytes: number): bigint {
  return FEE_PER_BYTE * BigInt(totalCompressedBytes);
}

export function formatFeeEth(feeWei: bigint): string {
  const eth = Number(feeWei) / 1e18;
  if (eth < 0.000001) return "< 0.000001";
  if (eth < 0.001) return eth.toFixed(6);
  return eth.toFixed(4);
}
