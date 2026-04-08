import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rabbyWallet, phantomWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
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

export const config = createConfig({
  connectors,
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

export const EVMFS_CONTRACT: Hex = "0x140cbDFf649929D003091a5B8B3be34588753aBA";

export const SUPPORTED_CHAIN_IDS = [1, 11155111] as const;

export const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};
