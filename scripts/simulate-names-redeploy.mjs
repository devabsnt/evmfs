import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  expandFilesToUnits,
  packBatches,
  estimateTotalGas,
  MAX_BATCH_BYTES,
} from "../cli/dist/batch.js";

const PKEY = "0x9006f2ecb5d52b06dd228e2a6bf957944eea33d6342c37004c58eb107d033337";
const RPC = "https://ethereum-rpc.publicnode.com";
const EVMFS_V2 = "0xb61cdCDC81d97c32122E668AE782b2327d0a623C";
const NAMES_V2  = "0x86342282EdF4A1C50249f16f4CB11c5921455730";
const FOLDER = path.resolve("C:/Users/mwalk/Desktop/evmfs/names-ui/dist");
const GAS_LIMIT = 25_000_000;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PKEY, provider);

console.log("wallet:", wallet.address);
const bal = await provider.getBalance(wallet.address);
console.log("balance:", ethers.formatEther(bal), "ETH");

const feeData = await provider.getFeeData();
const gp = feeData.gasPrice ?? 0n;
const maxFee = feeData.maxFeePerGas ?? gp;
console.log("gas price:", ethers.formatUnits(gp, "gwei"), "gwei");
console.log("max fee:  ", ethers.formatUnits(maxFee, "gwei"), "gwei");

function walk(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir)) {
    if (e.startsWith(".")) continue;
    const fp = path.join(dir, e);
    const rp = prefix ? `${prefix}/${e}` : e;
    if (fs.statSync(fp).isDirectory()) out.push(...walk(fp, rp));
    else out.push(rp);
  }
  return out.sort();
}

const relPaths = walk(FOLDER);
console.log("files:", relPaths.length);

const files = relPaths.map((rp, i) => ({
  index: i,
  filename: rp,
  compressed: new Uint8Array(gzipSync(fs.readFileSync(path.join(FOLDER, rp)))),
}));

for (const f of files) {
  console.log(`  ${f.filename}: ${(f.compressed.length/1024).toFixed(1)} KB gz`);
}

const units = expandFilesToUnits(files);
const batches = packBatches(units, GAS_LIMIT);
const dataGas = estimateTotalGas(units);
const manifestGas = 250_000;

console.log("\nchunks:", units.length);
console.log("batches (txs):", batches.length, "+ 1 manifest =", batches.length + 1);
console.log("data gas (cli formula):", dataGas.toLocaleString());
console.log("manifest gas (est):", manifestGas.toLocaleString());

const totalGas = BigInt(dataGas + manifestGas);
console.log("total gas:", totalGas.toString());

// Effective fee per gas the wallet will pay. With EIP-1559 the actual fee is
// usually closer to gasPrice (the basefee+priority floor reported), but max
// upper-bound is maxFeePerGas. Show both.
const costAtGasPrice = totalGas * gp;
const costAtMaxFee   = totalGas * maxFee;
console.log("\nexpected cost:", ethers.formatEther(costAtGasPrice), "ETH");
console.log("worst-case:   ", ethers.formatEther(costAtMaxFee), "ETH (if maxFeePerGas charged in full)");

console.log("\nbalance vs expected:", bal >= costAtGasPrice ? "OK" : "INSUFFICIENT",
  `(have ${ethers.formatEther(bal)}, need ${ethers.formatEther(costAtGasPrice)})`);
console.log("balance vs worst:   ", bal >= costAtMaxFee ? "OK" : "INSUFFICIENT",
  `(have ${ethers.formatEther(bal)}, need ${ethers.formatEther(costAtMaxFee)})`);

// Also check current names ownership/manifest
const NAMES_V2_ABI = [
  "function lookup(string calldata siteName) external view returns (address owner, uint64 blockNumber, bytes32 manifestHash)",
];
const namesC = new ethers.Contract(NAMES_V2, NAMES_V2_ABI, provider);
const [owner, blockNumber, manifestHash] = await namesC.lookup("names");
console.log("\ncurrent V2 names.evmfs.xyz registration:");
console.log("  owner:   ", owner);
console.log("  block:   ", blockNumber.toString());
console.log("  manifest:", manifestHash);
console.log("  caller is owner?", owner.toLowerCase() === wallet.address.toLowerCase());

// Update gas is ~50k typically — cheap. Include it for completeness.
const updateGasEstimate = 60_000n;
const updateCost = updateGasEstimate * gp;
console.log("\nnames update tx cost (est):", ethers.formatEther(updateCost), "ETH (~60k gas)");

const grandTotalExpected = costAtGasPrice + updateCost;
console.log("grand total expected:", ethers.formatEther(grandTotalExpected), "ETH");
console.log("balance vs grand:   ", bal >= grandTotalExpected ? "OK" : "INSUFFICIENT");
