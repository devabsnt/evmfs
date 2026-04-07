#!/usr/bin/env node
import { Command } from "commander";
import { uploadCommand, deployCommand } from "./upload.js";
import { registerCommand, updateNameCommand } from "./names.js";
import { verifyCommand } from "./verify.js";

const env = process.env;

const program = new Command();

program
  .name("evmfs")
  .description("Upload and manage files on EVMFS - permanent decentralized file storage")
  .version("1.0.0");

program
  .command("upload")
  .description("Upload a folder of files to EVMFS")
  .requiredOption("--folder <path>", "Path to folder of files to upload")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--private-key <key>", "Private key for signing transactions", env.EVMFS_PRIVATE_KEY)
  .option("--chain-id <id>", "Chain ID", env.EVMFS_CHAIN_ID ?? "1")
  .option("--contract <address>", "EVMFS contract address", env.EVMFS_CONTRACT)
  .option("--gas-limit <limit>", "Max gas per transaction", env.EVMFS_GAS_LIMIT ?? "25000000")
  .option("--gateway <url>", "Gateway base URL", env.EVMFS_GATEWAY ?? "https://evmfs.xyz")
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    if (!opts.privateKey) { console.error("Error: --private-key or EVMFS_PRIVATE_KEY is required"); process.exit(1); }
    return uploadCommand(opts);
  });

program
  .command("deploy")
  .description("Deploy a static site to EVMFS with named file paths")
  .requiredOption("--folder <path>", "Path to site folder (e.g. ./dist)")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--private-key <key>", "Private key for signing transactions", env.EVMFS_PRIVATE_KEY)
  .option("--chain-id <id>", "Chain ID", env.EVMFS_CHAIN_ID ?? "1")
  .option("--contract <address>", "EVMFS contract address", env.EVMFS_CONTRACT)
  .option("--gas-limit <limit>", "Max gas per transaction", env.EVMFS_GAS_LIMIT ?? "25000000")
  .option("--gateway <url>", "Gateway base URL", env.EVMFS_GATEWAY ?? "https://evmfs.xyz")
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    if (!opts.privateKey) { console.error("Error: --private-key or EVMFS_PRIVATE_KEY is required"); process.exit(1); }
    return deployCommand(opts);
  });

program
  .command("register")
  .description("Register a .evmfs.xyz subdomain for your deployed site")
  .requiredOption("--name <name>", "Subdomain name (e.g. mysite → mysite.evmfs.xyz)")
  .requiredOption("--manifest <hash>", "Manifest hash to point to")
  .requiredOption("--block <number>", "Block number of the manifest")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--private-key <key>", "Private key for signing transactions", env.EVMFS_PRIVATE_KEY)
  .option("--names-contract <address>", "EVMFSNames contract address", env.EVMFS_NAMES_CONTRACT)
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    if (!opts.privateKey) { console.error("Error: --private-key or EVMFS_PRIVATE_KEY is required"); process.exit(1); }
    if (!opts.namesContract) { console.error("Error: --names-contract or EVMFS_NAMES_CONTRACT is required"); process.exit(1); }
    return registerCommand(opts);
  });

program
  .command("update-name")
  .description("Update your .evmfs.xyz subdomain to point to a new manifest")
  .requiredOption("--name <name>", "Subdomain name to update")
  .requiredOption("--manifest <hash>", "New manifest hash")
  .requiredOption("--block <number>", "Block number of the new manifest")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--private-key <key>", "Private key for signing transactions", env.EVMFS_PRIVATE_KEY)
  .option("--names-contract <address>", "EVMFSNames contract address", env.EVMFS_NAMES_CONTRACT)
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    if (!opts.privateKey) { console.error("Error: --private-key or EVMFS_PRIVATE_KEY is required"); process.exit(1); }
    if (!opts.namesContract) { console.error("Error: --names-contract or EVMFS_NAMES_CONTRACT is required"); process.exit(1); }
    return updateNameCommand(opts);
  });

program
  .command("verify")
  .description("Verify a file stored on EVMFS")
  .requiredOption("--hash <contentHash>", "Content hash to verify")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--chain-id <id>", "Chain ID", env.EVMFS_CHAIN_ID ?? "1")
  .option("--contract <address>", "EVMFS contract address", env.EVMFS_CONTRACT)
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    return verifyCommand(opts);
  });

program
  .command("info")
  .description("Get metadata for a file stored on EVMFS")
  .requiredOption("--hash <contentHash>", "Content hash to look up")
  .option("--rpc <url>", "RPC URL", env.EVMFS_RPC)
  .option("--chain-id <id>", "Chain ID", env.EVMFS_CHAIN_ID ?? "1")
  .option("--contract <address>", "EVMFS contract address", env.EVMFS_CONTRACT)
  .action((opts) => {
    if (!opts.rpc) { console.error("Error: --rpc or EVMFS_RPC is required"); process.exit(1); }
    return verifyCommand(opts);
  });

program.parse();
