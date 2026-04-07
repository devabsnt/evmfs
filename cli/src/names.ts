import { ethers } from "ethers";

const NAMES_ABI = [
  "function register(string calldata siteName, uint64 blockNumber, bytes32 manifestHash) external payable",
  "function update(string calldata siteName, uint64 blockNumber, bytes32 manifestHash) external",
  "function lookup(string calldata siteName) external view returns (address owner, uint64 blockNumber, bytes32 manifestHash)",
];

const REGISTRATION_FEE = ethers.parseEther("0.001");

interface RegisterOptions {
  name: string;
  manifest: string;
  block: string;
  rpc: string;
  privateKey: string;
  namesContract: string;
}

interface UpdateOptions {
  name: string;
  manifest: string;
  block: string;
  rpc: string;
  privateKey: string;
  namesContract: string;
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

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const contract = new ethers.Contract(options.namesContract, NAMES_ABI, wallet);

  // Check if name is already taken
  try {
    const [owner] = await contract.lookup(name);
    if (owner !== ethers.ZeroAddress) {
      console.error(`Error: "${name}" is already registered`);
      process.exit(1);
    }
  } catch {
    // lookup failed — name is available
  }

  const block = parseInt(options.block, 10);

  console.log(`Registering ${name}.evmfs.xyz`);
  console.log(`  Manifest: ${options.manifest}`);
  console.log(`  Block: ${block}`);
  console.log(`  Fee: 0.001 ETH\n`);

  const tx = await contract.register(name, block, options.manifest, {
    value: REGISTRATION_FEE,
  });

  console.log(`  TX: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    console.error("Registration failed — transaction reverted");
    process.exit(1);
  }

  console.log(`  Confirmed in block ${receipt.blockNumber}\n`);
  console.log(`Registered! Your site is live at:`);
  console.log(`  https://${name}.evmfs.xyz`);
}

export async function updateNameCommand(options: UpdateOptions): Promise<void> {
  const name = options.name.toLowerCase();

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const contract = new ethers.Contract(options.namesContract, NAMES_ABI, wallet);

  const block = parseInt(options.block, 10);

  console.log(`Updating ${name}.evmfs.xyz`);
  console.log(`  New manifest: ${options.manifest}`);
  console.log(`  Block: ${block}\n`);

  const tx = await contract.update(name, block, options.manifest);

  console.log(`  TX: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    console.error("Update failed — transaction reverted");
    process.exit(1);
  }

  console.log(`  Confirmed in block ${receipt.blockNumber}\n`);
  console.log(`Updated! ${name}.evmfs.xyz now points to the new manifest.`);
}
