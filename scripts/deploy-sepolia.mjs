import solc from "solc";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7";

const SALT = ethers.zeroPadValue("0x45564d4653", 32);

async function main() {
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY env var");
    process.exit(1);
  }

  console.log("Compiling EVMFS.sol...");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "contracts", "src", "EVMFS.sol"),
    "utf-8"
  );

  const input = {
    language: "Solidity",
    sources: { "EVMFS.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const errors = output.errors.filter((e) => e.severity === "error");
    if (errors.length > 0) {
      console.error("Compilation errors:", errors);
      process.exit(1);
    }
  }

  const contract = output.contracts["EVMFS.sol"]["EVMFS"];
  const bytecode = "0x" + contract.evm.bytecode.object;
  const abi = contract.abi;

  console.log(`Bytecode size: ${(bytecode.length - 2) / 2} bytes`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = wallet.address;

  console.log(`Deployer: ${address}`);

  const balance = await provider.getBalance(address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("No ETH balance. Get Sepolia ETH from a faucet.");
    process.exit(1);
  }

  const bytecodeHash = ethers.keccak256(bytecode);
  const create2Address = ethers.getCreate2Address(
    SAFE_SINGLETON_FACTORY,
    SALT,
    bytecodeHash
  );

  console.log(`\nExpected CREATE2 address: ${create2Address}`);

  const existingCode = await provider.getCode(create2Address);
  if (existingCode !== "0x") {
    console.log("Contract already deployed at this address!");
    console.log(`Address: ${create2Address}`);
    return create2Address;
  }

  const factoryCode = await provider.getCode(SAFE_SINGLETON_FACTORY);
  if (factoryCode === "0x") {
    console.log("\nSafe Singleton Factory not found. Deploying directly instead...");

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    console.log("Sending deployment transaction...");
    const deployed = await factory.deploy();
    await deployed.waitForDeployment();
    const addr = await deployed.getAddress();
    console.log(`\nEVMFS deployed at: ${addr}`);
    console.log("(Note: non-deterministic address, CREATE2 factory not available on this chain)");
    return addr;
  }

  console.log("Deploying via Safe Singleton Factory (CREATE2)...");
  const payload = ethers.concat([SALT, bytecode]);

  const tx = await wallet.sendTransaction({
    to: SAFE_SINGLETON_FACTORY,
    data: payload,
    gasLimit: 1_000_000,
  });

  console.log(`TX: ${tx.hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber} (gas used: ${receipt.gasUsed.toString()})`);

  const deployedCode = await provider.getCode(create2Address);
  if (deployedCode === "0x") {
    console.error("Deployment verification failed - no code at expected address");
    process.exit(1);
  }

  console.log(`\nEVMFS deployed successfully!`);
  console.log(`Address: ${create2Address}`);
  console.log(`Chain: Sepolia (11155111)`);
  console.log(`TX: ${tx.hash}`);
  console.log(`\nThis same address will work on any chain with the Safe Singleton Factory.`);

  return create2Address;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
