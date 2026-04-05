import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ethers } from "ethers";
import { FileEntry, packBatches, estimateTotalGas } from "./batch.js";
import {
  buildManifest,
  saveLocalManifest,
  loadUploadState,
  saveUploadState,
  ManifestEntry,
  UploadState,
} from "./manifest.js";

const EVMFS_ABI = [
  "function store(bytes calldata data) external returns (bytes32)",
  "function storeBatch(bytes[] calldata data) external returns (bytes32[])",
  "function storeManifest(bytes calldata data) external returns (bytes32)",
  "event Store(bytes32 indexed contentHash, bytes data)",
];

interface UploadOptions {
  folder: string;
  rpc: string;
  privateKey: string;
  chainId: string;
  contract?: string;
  gasLimit: string;
  gateway: string;
}

export async function uploadCommand(options: UploadOptions): Promise<void> {
  const folder = path.resolve(options.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Error: ${folder} is not a valid directory`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const contractAddress =
    options.contract ?? "0x0000000000000000000000000000000000000000";

  if (contractAddress === "0x0000000000000000000000000000000000000000") {
    console.error(
      "Error: No contract address specified. Use --contract <address>"
    );
    process.exit(1);
  }

  const contract = new ethers.Contract(contractAddress, EVMFS_ABI, wallet);
  const gasLimit = parseInt(options.gasLimit, 10);

  const filenames = fs
    .readdirSync(folder)
    .filter((f) => {
      const fullPath = path.join(folder, f);
      return fs.statSync(fullPath).isFile() && !f.startsWith(".");
    })
    .sort();

  if (filenames.length === 0) {
    console.error("Error: No files found in folder");
    process.exit(1);
  }

  console.log(`Found ${filenames.length} files in ${folder}`);

  const files: FileEntry[] = filenames.map((filename, index) => {
    const raw = fs.readFileSync(path.join(folder, filename));
    const compressed = gzipSync(raw);
    return { index, filename, compressed: new Uint8Array(compressed) };
  });

  let state: UploadState = loadUploadState(folder) ?? {
    folder,
    contractAddress,
    chainId: options.chainId,
    uploaded: {},
  };

  const alreadyUploaded = new Set(
    Object.keys(state.uploaded).map((k) => parseInt(k, 10))
  );
  const remaining = files.filter((f) => !alreadyUploaded.has(f.index));

  if (alreadyUploaded.size > 0) {
    console.log(
      `Resuming: ${alreadyUploaded.size} files already uploaded, ${remaining.length} remaining`
    );
  }

  if (remaining.length === 0 && state.manifestHash) {
    console.log("Upload already complete!");
    printResult(options, state);
    return;
  }

  const batches = packBatches(remaining, gasLimit);
  const totalGas = batches.reduce((sum, b) => sum + b.estimatedGas, 0);

  console.log(`\nUpload plan:`);
  console.log(`  Files to upload: ${remaining.length}`);
  console.log(`  Transactions needed: ${batches.length}`);
  console.log(`  Estimated total gas: ${totalGas.toLocaleString()}`);

  const feeData = await provider.getFeeData();
  if (feeData.gasPrice) {
    const costWei = feeData.gasPrice * BigInt(totalGas);
    const costEth = ethers.formatEther(costWei);
    console.log(
      `  Estimated cost: ${costEth} ETH (at ${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei)`
    );
  }

  const manifestGasEstimate = 200_000;
  console.log(
    `  + ~${manifestGasEstimate.toLocaleString()} gas for manifest upload\n`
  );

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Proceed with upload? (y/N) ", resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Upload cancelled.");
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      `\nBatch ${i + 1}/${batches.length}: ${batch.files.length} files (~${batch.estimatedGas.toLocaleString()} gas)`
    );

    const dataArrays = batch.files.map((f) => f.compressed);

    try {
      let tx: ethers.ContractTransactionResponse;

      if (batch.files.length === 1) {
        tx = await contract.store(dataArrays[0]);
      } else {
        tx = await contract.storeBatch(dataArrays);
      }

      console.log(`  TX: ${tx.hash}`);
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("Transaction failed - no receipt");
      }

      console.log(
        `  Confirmed in block ${receipt.blockNumber} (gas used: ${receipt.gasUsed.toLocaleString()})`
      );

      for (const log of receipt.logs) {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed && parsed.name === "Store") {
          const contentHash = parsed.args[0] as string;
          const matchingFile = batch.files.find(
            (f) =>
              ethers.keccak256(f.compressed) === contentHash
          );
          if (matchingFile) {
            state.uploaded[matchingFile.index] = contentHash;
            console.log(
              `  ${matchingFile.filename} → ${contentHash.slice(0, 18)}...`
            );
          }
        }
      }

      saveUploadState(folder, state);
    } catch (err) {
      console.error(`  Error in batch ${i + 1}:`, err);
      console.log("  Progress saved. Re-run to resume.");
      saveUploadState(folder, state);
      process.exit(1);
    }
  }

  if (!state.manifestHash) {
    console.log("\nUploading manifest...");

    const entries: ManifestEntry[] = filenames.map((filename, index) => ({
      filename,
      contentHash: state.uploaded[index],
    }));

    const missing = entries.filter((e) => !e.contentHash);
    if (missing.length > 0) {
      console.error(
        `Error: ${missing.length} files missing hashes. Re-run to retry.`
      );
      process.exit(1);
    }

    const { manifestGzipped } = buildManifest(entries);

    const tx = await contract.storeManifest(manifestGzipped);
    console.log(`  Manifest TX: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Manifest transaction failed");
    }

    for (const log of receipt.logs) {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && parsed.name === "Store") {
        state.manifestHash = parsed.args[0] as string;
      }
    }

    saveUploadState(folder, state);

    saveLocalManifest(
      entries,
      folder
    );

    console.log(`  Manifest confirmed in block ${receipt.blockNumber}`);
  }

  printResult(options, state);
}

function printResult(options: UploadOptions, state: UploadState): void {
  const uploadedCount = Object.keys(state.uploaded).length;
  console.log(`\n✓ Upload complete!`);
  console.log(`  Files: ${uploadedCount}`);
  console.log(`  Manifest hash: ${state.manifestHash}`);
  console.log(
    `  Base URI: ${options.gateway}/${options.chainId}/${state.manifestHash}/`
  );
  console.log(`\n  Token 0: ${options.gateway}/${options.chainId}/${state.manifestHash}/0`);
  console.log(`  Token 1: ${options.gateway}/${options.chainId}/${state.manifestHash}/1`);
  console.log(`  ...`);
}
