import { useState, useEffect, useCallback } from "react";
import { fetchNativePrice } from "../lib/prices";
import { DEFAULT_RPC_URLS } from "../lib/wagmi";

interface GasEstimate {
  totalGas: number;
  gasPriceWei: bigint | null;
  ethPrice: number | null;
  costWei: bigint | null;
  costEth: string | null;
  costUsd: string | null;
  loading: boolean;
}

async function fetchGasPrice(chainId: number): Promise<bigint> {
  const url = DEFAULT_RPC_URLS[chainId];
  if (!url) throw new Error(`No RPC URL configured for chain ${chainId}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
  });
  const data = await res.json();
  if (!data.result) throw new Error(`eth_gasPrice failed on chain ${chainId}`);
  const price = BigInt(data.result);
  console.log(`[EVMFS] Gas price: ${Number(price) / 1e9} gwei (chain ${chainId})`);
  return price;
}

export function useGasEstimate(totalGas: number, chainId?: number): GasEstimate {
  const [gasPriceWei, setGasPriceWei] = useState<bigint | null>(null);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPrices = useCallback(async () => {
    const cid = chainId ?? 1;
    try {
      const [gas, eth] = await Promise.all([
        fetchGasPrice(cid),
        fetchNativePrice(cid),
      ]);
      setGasPriceWei(gas);
      setEthPrice(eth);
      console.log(`[EVMFS] Native price: $${eth}, Gas: ${Number(gas) / 1e9} gwei`);
    } catch (err) {
      console.error("[EVMFS] Price fetch error:", err);
      try { setGasPriceWei(await fetchGasPrice(cid)); } catch { /* empty */ }
      try { setEthPrice(await fetchNativePrice(cid)); } catch { /* empty */ }
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    loadPrices();
    const interval = setInterval(loadPrices, 30_000);
    return () => clearInterval(interval);
  }, [loadPrices]);

  let costWei: bigint | null = null;
  let costEth: string | null = null;
  let costUsd: string | null = null;

  if (gasPriceWei && totalGas > 0) {
    costWei = gasPriceWei * BigInt(totalGas);
    const ethAmount = Number(costWei) / 1e18;
    costEth = ethAmount < 0.0001 ? "< 0.0001" : ethAmount.toFixed(4);

    if (ethPrice) {
      const usdAmount = ethAmount * ethPrice;
      costUsd = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(usdAmount);
    }
  }

  return {
    totalGas,
    gasPriceWei,
    ethPrice,
    costWei,
    costEth,
    costUsd,
    loading,
  };
}
