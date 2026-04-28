import { COINGECKO_ID, NATIVE_CURRENCY } from "./wagmi";

export async function fetchNativePrice(chainId: number): Promise<number> {
  const id = COINGECKO_ID[chainId] ?? "ethereum";
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );
  const data = await res.json();
  return data[id]?.usd ?? 0;
}

export async function fetchEthPrice(): Promise<number> {
  return fetchNativePrice(1);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNative(wei: bigint, chainId: number): string {
  const symbol = NATIVE_CURRENCY[chainId] ?? "ETH";
  const value = Number(wei) / 1e18;
  if (value < 0.0001) return `< 0.0001 ${symbol}`;
  return `${value.toFixed(4)} ${symbol}`;
}

export function formatEth(wei: bigint): string {
  return formatNative(wei, 1);
}

export function formatGwei(wei: bigint): string {
  const gwei = Number(wei) / 1e9;
  return `${gwei.toFixed(3)} gwei`;
}
