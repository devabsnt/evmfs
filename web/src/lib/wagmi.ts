import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { type Hex } from "viem";

export const config = getDefaultConfig({
  appName: "EVMFS",
  projectId: "YOUR_WALLETCONNECT_PROJECT_ID",
  chains: [mainnet, sepolia],
});

export const EVMFS_CONTRACT: Hex = "0x140cbDFf649929D003091a5B8B3be34588753aBA";

export const SUPPORTED_CHAIN_IDS = [1, 11155111] as const;

export const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};
