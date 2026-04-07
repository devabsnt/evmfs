import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ethers } from "ethers";
import {
  FileEntry,
  packBatches,
  expandFilesToUnits,
  estimateTotalGas,
} from "./batch.js";
import {
  buildManifest,
  saveLocalManifest,
  loadUploadState,
  saveUploadState,
  ManifestEntry,
  ConfirmedChunk,
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

function chunkKey(fileIndex: number, chunkIndex: number): string {
  return `${fileIndex}:${chunkIndex}`;
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

  const allUnits = expandFilesToUnits(files);

  const chunkedFiles = files.filter((f) => {
    const units = allUnits.filter((u) => u.fileIndex === f.index);
    return units.length > 1;
  });
  if (chunkedFiles.length > 0) {
    console.log(
      `  ${chunkedFiles.length} file(s) exceed ~100KB compressed and will be chunked across multiple transactions.`
    );
    for (const f of chunkedFiles) {
      const units = allUnits.filter((u) => u.fileIndex === f.index);
      console.log(
        `    ${f.filename}: ${f.compressed.length.toLocaleString()} bytes → ${units.length} chunks`
      );
    }
  }

  let state: UploadState = loadUploadState(folder) ?? {
    folder,
    contractAddress,
    chainId: options.chainId,
    chunks: [],
  };

  const confirmedKeys = new Set(
    state.chunks.map((c) => chunkKey(c.fileIndex, c.chunkIndex))
  );

  const validConfirmed = state.chunks.filter((c) => {
    const units = allUnits.filter((u) => u.fileIndex === c.fileIndex);
    return units.some(
      (u) => u.chunkIndex === c.chunkIndex && u.totalChunks === c.totalChunks
    );
  });
  if (validConfirmed.length !== state.chunks.length) {
    console.log(
      `  Discarding ${state.chunks.length - validConfirmed.length} stale state entries (chunking changed).`
    );
    state.chunks = validConfirmed;
    confirmedKeys.clear();
    for (const c of state.chunks)
      confirmedKeys.add(chunkKey(c.fileIndex, c.chunkIndex));
  }

  const remainingUnits = allUnits.filter(
    (u) => !confirmedKeys.has(chunkKey(u.fileIndex, u.chunkIndex))
  );

  if (confirmedKeys.size > 0) {
    console.log(
      `Resuming: ${confirmedKeys.size} chunks already uploaded, ${remainingUnits.length} remaining`
    );
  }

  if (remainingUnits.length === 0 && state.manifestHash) {
    console.log("Upload already complete!");
    printResult(options, state);
    return;
  }

  const batches = packBatches(remainingUnits, gasLimit);
  const totalGas =
    remainingUnits.length > 0 ? estimateTotalGas(remainingUnits) : 0;

  console.log(`\nUpload plan:`);
  console.log(
    `  Chunks to upload: ${remainingUnits.length} (across ${allUnits.length} total)`
  );
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
      `\nBatch ${i + 1}/${batches.length}: ${batch.units.length} chunks, ${(batch.byteSize / 1024).toFixed(1)} KB (~${batch.estimatedGas.toLocaleString()} gas)`
    );

    const dataArrays = batch.units.map((u) => u.data);
    const hashToUnit = new Map(
      batch.units.map((u) => [ethers.keccak256(u.data), u])
    );

    try {
      let tx: ethers.ContractTransactionResponse;

      if (batch.units.length === 1) {
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
          const unit = hashToUnit.get(contentHash);
          if (unit) {
            state.chunks.push({
              fileIndex: unit.fileIndex,
              chunkIndex: unit.chunkIndex,
              totalChunks: unit.totalChunks,
              hash: contentHash,
              block: receipt.blockNumber,
            });
            console.log(
              `  ${unit.name} → ${contentHash.slice(0, 18)}...`
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

    const chunksByFile = new Map<number, ConfirmedChunk[]>();
    for (const c of state.chunks) {
      const list = chunksByFile.get(c.fileIndex) ?? [];
      list.push(c);
      chunksByFile.set(c.fileIndex, list);
    }

    const entries: ManifestEntry[] = [];
    let missing = 0;
    for (let i = 0; i < filenames.length; i++) {
      const fileChunks = (chunksByFile.get(i) ?? []).slice();
      fileChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const expected = allUnits.filter((u) => u.fileIndex === i).length;
      if (fileChunks.length !== expected) {
        console.error(
          `  ${filenames[i]}: missing chunks (${fileChunks.length}/${expected})`
        );
        missing++;
        continue;
      }
      entries.push({
        filename: filenames[i],
        chunks: fileChunks.map((c) => ({ hash: c.hash, block: c.block })),
      });
    }

    if (missing > 0) {
      console.error(`Error: ${missing} files missing chunks. Re-run to retry.`);
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

    saveLocalManifest(entries, folder);

    console.log(`  Manifest confirmed in block ${receipt.blockNumber}`);
  }

  printResult(options, state);
}

function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string, prefix: string): void {
    const entries = fs.readdirSync(current);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = path.join(current, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        results.push(relativePath);
      }
    }
  }
  walk(dir, "");
  return results.sort();
}

interface DeployOptions {
  folder: string;
  rpc: string;
  privateKey: string;
  chainId: string;
  contract?: string;
  gasLimit: string;
  gateway: string;
}

export async function deployCommand(options: DeployOptions): Promise<void> {
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

  const relativePaths = walkDirectory(folder);

  if (relativePaths.length === 0) {
    console.error("Error: No files found in folder");
    process.exit(1);
  }

  const hasIndex = relativePaths.some((p) => p === "index.html");
  if (!hasIndex) {
    console.warn("Warning: No index.html found. SPA fallback will not work.");
  }

  console.log(`Found ${relativePaths.length} files in ${folder}`);

  const files: FileEntry[] = relativePaths.map((relPath, index) => {
    const raw = fs.readFileSync(path.join(folder, relPath));
    const compressed = gzipSync(raw);
    return { index, filename: relPath, compressed: new Uint8Array(compressed) };
  });

  const allUnits = expandFilesToUnits(files);

  const chunkedFiles = files.filter((f) => {
    const units = allUnits.filter((u) => u.fileIndex === f.index);
    return units.length > 1;
  });
  if (chunkedFiles.length > 0) {
    console.log(
      `  ${chunkedFiles.length} file(s) exceed ~100KB compressed and will be chunked across multiple transactions.`
    );
    for (const f of chunkedFiles) {
      const units = allUnits.filter((u) => u.fileIndex === f.index);
      console.log(
        `    ${f.filename}: ${f.compressed.length.toLocaleString()} bytes → ${units.length} chunks`
      );
    }
  }

  const deployStatePath = path.join(folder, ".evmfs-deploy-state.json");
  let state: UploadState = fs.existsSync(deployStatePath)
    ? JSON.parse(fs.readFileSync(deployStatePath, "utf-8"))
    : { folder, contractAddress, chainId: options.chainId, chunks: [] };

  const confirmedKeys = new Set(
    state.chunks.map((c) => chunkKey(c.fileIndex, c.chunkIndex))
  );

  const validConfirmed = state.chunks.filter((c) => {
    const units = allUnits.filter((u) => u.fileIndex === c.fileIndex);
    return units.some(
      (u) => u.chunkIndex === c.chunkIndex && u.totalChunks === c.totalChunks
    );
  });
  if (validConfirmed.length !== state.chunks.length) {
    console.log(
      `  Discarding ${state.chunks.length - validConfirmed.length} stale state entries (chunking changed).`
    );
    state.chunks = validConfirmed;
    confirmedKeys.clear();
    for (const c of state.chunks)
      confirmedKeys.add(chunkKey(c.fileIndex, c.chunkIndex));
  }

  const remainingUnits = allUnits.filter(
    (u) => !confirmedKeys.has(chunkKey(u.fileIndex, u.chunkIndex))
  );

  if (confirmedKeys.size > 0) {
    console.log(
      `Resuming: ${confirmedKeys.size} chunks already uploaded, ${remainingUnits.length} remaining`
    );
  }

  if (remainingUnits.length === 0 && state.manifestHash) {
    console.log("Deploy already complete!");
    printDeployResult(options, state, relativePaths);
    return;
  }

  const batches = packBatches(remainingUnits, gasLimit);
  const totalGas =
    remainingUnits.length > 0 ? estimateTotalGas(remainingUnits) : 0;

  console.log(`\nDeploy plan:`);
  console.log(
    `  Chunks to upload: ${remainingUnits.length} (across ${allUnits.length} total)`
  );
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
    rl.question("Proceed with deploy? (y/N) ", resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Deploy cancelled.");
    return;
  }

  const saveDeployState = () => {
    fs.writeFileSync(deployStatePath, JSON.stringify(state, null, 2));
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      `\nBatch ${i + 1}/${batches.length}: ${batch.units.length} chunks, ${(batch.byteSize / 1024).toFixed(1)} KB (~${batch.estimatedGas.toLocaleString()} gas)`
    );

    const dataArrays = batch.units.map((u) => u.data);
    const hashToUnit = new Map(
      batch.units.map((u) => [ethers.keccak256(u.data), u])
    );

    try {
      let tx: ethers.ContractTransactionResponse;

      if (batch.units.length === 1) {
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
          const unit = hashToUnit.get(contentHash);
          if (unit) {
            state.chunks.push({
              fileIndex: unit.fileIndex,
              chunkIndex: unit.chunkIndex,
              totalChunks: unit.totalChunks,
              hash: contentHash,
              block: receipt.blockNumber,
            });
            console.log(
              `  ${unit.name} → ${contentHash.slice(0, 18)}...`
            );
          }
        }
      }

      saveDeployState();
    } catch (err) {
      console.error(`  Error in batch ${i + 1}:`, err);
      console.log("  Progress saved. Re-run to resume.");
      saveDeployState();
      process.exit(1);
    }
  }

  if (!state.manifestHash) {
    console.log("\nUploading manifest...");

    const chunksByFile = new Map<number, ConfirmedChunk[]>();
    for (const c of state.chunks) {
      const list = chunksByFile.get(c.fileIndex) ?? [];
      list.push(c);
      chunksByFile.set(c.fileIndex, list);
    }

    const entries: ManifestEntry[] = [];
    let missing = 0;
    for (let i = 0; i < relativePaths.length; i++) {
      const fileChunks = (chunksByFile.get(i) ?? []).slice();
      fileChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const expected = allUnits.filter((u) => u.fileIndex === i).length;
      if (fileChunks.length !== expected) {
        console.error(
          `  ${relativePaths[i]}: missing chunks (${fileChunks.length}/${expected})`
        );
        missing++;
        continue;
      }
      entries.push({
        filename: relativePaths[i],
        chunks: fileChunks.map((c) => ({ hash: c.hash, block: c.block })),
      });
    }

    if (missing > 0) {
      console.error(`Error: ${missing} files missing chunks. Re-run to retry.`);
      process.exit(1);
    }

    const { manifestGzipped } = buildManifest(entries, true);

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

    saveDeployState();

    saveLocalManifest(entries, folder);

    console.log(`  Manifest confirmed in block ${receipt.blockNumber}`);
  }

  printDeployResult(options, state, relativePaths);
}

function printDeployResult(options: DeployOptions, state: UploadState, files: string[]): void {
  const blockNum = state.chunks.length > 0 ? state.chunks[0].block : 0;
  const siteUrl = `${options.gateway}/${options.chainId}/${blockNum}/${state.manifestHash}/`;

  console.log(`\n✓ Site deployed!`);
  console.log(`  Files: ${files.length}`);
  console.log(`  Chunks stored: ${state.chunks.length}`);
  console.log(`  Manifest hash: ${state.manifestHash}`);
  console.log(`  Block number: ${blockNum}`);
  console.log(`  Site URL: ${siteUrl}`);
  console.log(`\nTo update your site, redeploy and update your DNS/ENS to point to the new manifest.`);
  console.log(`Each deploy produces a new immutable manifest — content on-chain never changes.`);
}

function printResult(options: UploadOptions, state: UploadState): void {
  const fileCount = new Set(state.chunks.map((c) => c.fileIndex)).size;
  const blockNum = state.chunks.length > 0 ? state.chunks[0].block : 0;
  console.log(`\n✓ Upload complete!`);
  console.log(`  Files: ${fileCount}`);
  console.log(`  Chunks stored: ${state.chunks.length}`);
  console.log(`  Manifest hash: ${state.manifestHash}`);
  console.log(`  Block number: ${blockNum}`);
  console.log(
    `  Base URI: ${options.gateway}/${options.chainId}/${blockNum}/${state.manifestHash}/`
  );
  console.log(
    `\n  Token 0: ${options.gateway}/${options.chainId}/${state.manifestHash}/0`
  );
  console.log(
    `  Token 1: ${options.gateway}/${options.chainId}/${state.manifestHash}/1`
  );
  console.log(`  ...`);
}
