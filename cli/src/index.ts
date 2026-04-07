#!/usr/bin/env node
import { Command } from "commander";
import { uploadCommand, deployCommand } from "./upload.js";
import { verifyCommand } from "./verify.js";

const program = new Command();

program
  .name("evmfs")
  .description("Upload and manage files on EVMFS - permanent decentralized file storage")
  .version("1.0.0");

program
  .command("upload")
  .description("Upload a folder of files to EVMFS")
  .requiredOption("--folder <path>", "Path to folder of files to upload")
  .requiredOption("--rpc <url>", "RPC URL")
  .requiredOption("--private-key <key>", "Private key for signing transactions")
  .option("--chain-id <id>", "Chain ID", "1")
  .option("--contract <address>", "EVMFS contract address")
  .option("--gas-limit <limit>", "Max gas per transaction", "25000000")
  .option("--gateway <url>", "Gateway base URL", "https://evmfs.xyz")
  .action(uploadCommand);

program
  .command("deploy")
  .description("Deploy a static site to EVMFS with named file paths")
  .requiredOption("--folder <path>", "Path to site folder (e.g. ./dist)")
  .requiredOption("--rpc <url>", "RPC URL")
  .requiredOption("--private-key <key>", "Private key for signing transactions")
  .option("--chain-id <id>", "Chain ID", "1")
  .option("--contract <address>", "EVMFS contract address")
  .option("--gas-limit <limit>", "Max gas per transaction", "25000000")
  .option("--gateway <url>", "Gateway base URL", "https://evmfs.xyz")
  .action(deployCommand);

program
  .command("verify")
  .description("Verify a file stored on EVMFS")
  .requiredOption("--hash <contentHash>", "Content hash to verify")
  .requiredOption("--rpc <url>", "RPC URL")
  .option("--chain-id <id>", "Chain ID", "1")
  .option("--contract <address>", "EVMFS contract address")
  .action(verifyCommand);

program
  .command("info")
  .description("Get metadata for a file stored on EVMFS")
  .requiredOption("--hash <contentHash>", "Content hash to look up")
  .requiredOption("--rpc <url>", "RPC URL")
  .option("--chain-id <id>", "Chain ID", "1")
  .option("--contract <address>", "EVMFS contract address")
  .action(verifyCommand);

program.parse();
