import { createPublicClient, createWalletClient, custom, http, type PublicClient, type WalletClient, type EIP1193Provider } from "viem";
import { mainnet } from "viem/chains";

export const defaultPublicClient = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});

// EIP-6963: standard wallet discovery
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  provider: EIP1193Provider;
}

interface EIP6963AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: EIP1193Provider;
  };
}

export function discoverWallets(onWallet: (wallet: WalletInfo) => void): () => void {
  const handler = (event: Event) => {
    const e = event as EIP6963AnnounceEvent;
    onWallet({
      uuid: e.detail.info.uuid,
      name: e.detail.info.name,
      icon: e.detail.info.icon,
      provider: e.detail.provider,
    });
  };

  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return () => window.removeEventListener("eip6963:announceProvider", handler);
}

export async function connectWallet(provider: EIP1193Provider): Promise<{
  address: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
}> {
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No accounts");

  const chainId = await provider.request({ method: "eth_chainId" }) as string;
  if (chainId !== "0x1") {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }

  const walletClient = createWalletClient({
    account: accounts[0] as `0x${string}`,
    chain: mainnet,
    transport: custom(provider),
  });

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http("https://ethereum-rpc.publicnode.com"),
  });

  return { address: accounts[0], walletClient, publicClient };
}
