import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rabbyWallet, phantomWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, sepolia, monad } from "wagmi/chains";
import { type Hex } from "viem";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [metaMaskWallet, rabbyWallet, phantomWallet],
    },
  ],
  {
    appName: "EVMFS",
    projectId: "YOUR_WALLETCONNECT_PROJECT_ID",
  }
);

export const EVMFS_CONTRACT: Hex = "0x140cbDFf649929D003091a5B8B3be34588753aBA";

export const SUPPORTED_CHAIN_IDS = [1, 11155111, 143] as const;

export const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  143: "https://rpc.monad.xyz",
};

export const NATIVE_CURRENCY: Record<number, string> = {
  1: "ETH",
  11155111: "ETH",
  143: "MON",
};

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  143: "Monad",
};

export function chainNameFor(chainId: number | undefined): string {
  if (chainId == null) return "the blockchain";
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export const COINGECKO_ID: Record<number, string> = {
  1: "ethereum",
  11155111: "ethereum",
  143: "monad",
};

export const config = createConfig({
  connectors,
  chains: [mainnet, sepolia, monad],
  transports: {
    [mainnet.id]: http(DEFAULT_RPC_URLS[mainnet.id]),
    [sepolia.id]: http(DEFAULT_RPC_URLS[sepolia.id]),
    [monad.id]: http(DEFAULT_RPC_URLS[monad.id]),
  },
});
