import { useState, useEffect, useCallback } from "react";
import { fetchEthPrice } from "../lib/prices";
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
  const urls: string[] = [];

  if (DEFAULT_RPC_URLS[chainId]) {
    urls.push(DEFAULT_RPC_URLS[chainId]);
  }
  urls.push("https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com");

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
      });
      const data = await res.json();
      if (data.result) {
        const price = BigInt(data.result);
        console.log(`[EVMFS] Gas price: ${Number(price) / 1e9} gwei (chain ${chainId}, from ${url})`);
        return price;
      }
    } catch {
      continue;
    }
  }
  throw new Error("All RPC endpoints failed");
}

export function useGasEstimate(totalGas: number, chainId?: number): GasEstimate {
  const [gasPriceWei, setGasPriceWei] = useState<bigint | null>(null);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPrices = useCallback(async () => {
    try {
      const [gas, eth] = await Promise.all([
        fetchGasPrice(chainId ?? 1),
        fetchEthPrice(),
      ]);
      setGasPriceWei(gas);
      setEthPrice(eth);
      console.log(`[EVMFS] ETH price: $${eth}, Gas: ${Number(gas) / 1e9} gwei`);
    } catch (err) {
      console.error("[EVMFS] Price fetch error:", err);
      try { setGasPriceWei(await fetchGasPrice(chainId ?? 1)); } catch {}
      try { setEthPrice(await fetchEthPrice()); } catch {}
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
