import { ethers } from "ethers";

// EVMFSNamesV2: register/update take no block arg (V2 reads it from EVMFSV2 storage).
// V1: register/update take (name, block, manifest).
const NAMES_V2_ABI = [
  "function register(string calldata siteName, bytes32 manifestHash) external payable",
  "function update(string calldata siteName, bytes32 manifestHash) external",
  "function lookup(string calldata siteName) external view returns (address owner, uint64 blockNumber, bytes32 manifestHash)",
];

const NAMES_V1_ABI = [
  "function register(string calldata siteName, uint64 blockNumber, bytes32 manifestHash) external payable",
  "function update(string calldata siteName, uint64 blockNumber, bytes32 manifestHash) external",
  "function lookup(string calldata siteName) external view returns (address owner, uint64 blockNumber, bytes32 manifestHash)",
];

export const NAMES_V2_ADDRESS = "0x86342282EdF4A1C50249f16f4CB11c5921455730";
const NAMES_V1_ADDRESS = "0x36043906ba7c191c9511a60a8b28e3a602ed1477";

const REGISTRATION_FEE = ethers.parseEther("0.001");

interface RegisterOptions {
  name: string;
  manifest: string;
  block?: string;
  rpc: string;
  privateKey: string;
  namesContract: string;
}

interface UpdateOptions {
  name: string;
  manifest: string;
  block?: string;
  rpc: string;
  privateKey: string;
  namesContract: string;
}

function isV2Names(addr: string): boolean {
  return addr.toLowerCase() === NAMES_V2_ADDRESS.toLowerCase();
}

function isV1Names(addr: string): boolean {
  return addr.toLowerCase() === NAMES_V1_ADDRESS.toLowerCase();
}

export async function registerCommand(options: RegisterOptions): Promise<void> {
  const name = options.name.toLowerCase();

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    console.error("Error: Name must be lowercase alphanumeric with optional hyphens (not at start/end)");
    process.exit(1);
  }

  if (name.length > 32) {
    console.error("Error: Name must be 32 characters or less");
    process.exit(1);
  }

  const v2 = isV2Names(options.namesContract);

  if (!v2 && !options.block) {
    console.error("Error: --block is required when registering against the V1 names contract");
    process.exit(1);
  }

  if (v2 && options.block) {
    console.log("Note: --block ignored (V2 reads block from EVMFSV2 storage)\n");
  }

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const abi = v2 ? NAMES_V2_ABI : NAMES_V1_ABI;
  const contract = new ethers.Contract(options.namesContract, abi, wallet);

  try {
    const [owner] = await contract.lookup(name);
    if (owner !== ethers.ZeroAddress) {
      console.error(`Error: "${name}" is already registered`);
      process.exit(1);
    }
  } catch {
    // lookup failed - name is available
  }

  console.log(`Registering ${name}.evmfs.xyz (${v2 ? "V2" : "V1"})`);
  console.log(`  Manifest: ${options.manifest}`);
  if (!v2) console.log(`  Block: ${options.block}`);
  console.log(`  Fee: 0.001 ETH\n`);

  const tx = v2
    ? await contract.register(name, options.manifest, { value: REGISTRATION_FEE })
    : await contract.register(name, parseInt(options.block!, 10), options.manifest, {
        value: REGISTRATION_FEE,
      });

  console.log(`  TX: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    console.error("Registration failed - transaction reverted");
    process.exit(1);
  }

  console.log(`  Confirmed in block ${receipt.blockNumber}\n`);
  console.log(`Registered! Your site is live at:`);
  console.log(`  https://${name}.evmfs.xyz`);
}

export async function updateNameCommand(options: UpdateOptions): Promise<void> {
  const name = options.name.toLowerCase();
  const v2 = isV2Names(options.namesContract);

  if (!v2 && !options.block) {
    console.error("Error: --block is required when updating on the V1 names contract");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const abi = v2 ? NAMES_V2_ABI : NAMES_V1_ABI;
  const contract = new ethers.Contract(options.namesContract, abi, wallet);

  console.log(`Updating ${name}.evmfs.xyz (${v2 ? "V2" : "V1"})`);
  console.log(`  New manifest: ${options.manifest}`);
  if (!v2) console.log(`  Block: ${options.block}`);
  console.log("");

  const tx = v2
    ? await contract.update(name, options.manifest)
    : await contract.update(name, parseInt(options.block!, 10), options.manifest);

  console.log(`  TX: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    console.error("Update failed - transaction reverted");
    process.exit(1);
  }

  console.log(`  Confirmed in block ${receipt.blockNumber}\n`);
  console.log(`Updated! ${name}.evmfs.xyz now points to the new manifest.`);
}
