export async function fetchEthPrice(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
  );
  const data = await res.json();
  return data.ethereum.usd;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth < 0.0001) return "< 0.0001 ETH";
  return `${eth.toFixed(4)} ETH`;
}

export function formatGwei(wei: bigint): string {
  const gwei = Number(wei) / 1e9;
  return `${gwei.toFixed(3)} gwei`;
}
