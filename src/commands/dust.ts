import { Command } from "commander";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  createBurnInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import bs58 from "bs58";
import * as readline from "readline";

const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=40067999-16c1-4b5a-95a3-fa46f6dcdc21";
const HELIUS_API_KEY = "40067999-16c1-4b5a-95a3-fa46f6dcdc21";
const RENT_EXEMPT_LAMPORTS = 2039280; // ~0.00203928 SOL per account

// Format number with proper thousands separator and decimals
function formatNumber(num: number, decimals: number = 6): string {
  if (num === 0) return "0";

  // For very small numbers, use scientific notation
  if (num > 0 && num < 0.000001) {
    return num.toExponential(2);
  }

  // For small numbers, show up to 6 decimals
  if (num < 1) {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals
    });
  }

  // For numbers >= 1, use commas and 2-4 decimals
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
}

// Known spam/scam token patterns
const SPAM_INDICATORS = [
  "airdrop", "free", "claim", "reward", "bonus", "gift",
  "winner", "congratulation", "lucky", "prize"
];

interface TokenMetadata {
  name: string;
  symbol: string;
  logoURI?: string;
}

interface TokenAccount {
  pubkey: PublicKey;
  mint: string;
  balance: bigint;
  decimals: number;
  isCloseable: boolean;
  metadata?: TokenMetadata;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  riskReason?: string;
}

export const dustCommand = new Command("dust")
  .description("Dust token management commands")
  .addCommand(
    new Command("scan")
      .description("Scan wallet for dust tokens")
      .argument("<wallet>", "Wallet address to scan")
      .option("--show-all", "Show all tokens, not just dust")
      .action(scanDust)
  )
  .addCommand(
    new Command("clean")
      .description("Close empty token accounts and recover SOL")
      .argument("<wallet>", "Wallet address to clean")
      .option("-k, --keypair <path>", "Path to keypair file (JSON or base58)")
      .option("-y, --yes", "Skip confirmation prompt (close all)")
      .option("-i, --interactive", "Interactive mode - confirm each token")
      .option("--dry-run", "Show what would be done without executing")
      .option("--burn", "Burn tokens with small balances before closing")
      .action(cleanDust)
  );

// Fetch token metadata from Helius
async function fetchTokenMetadata(mints: string[]): Promise<Map<string, TokenMetadata>> {
  const metadataMap = new Map<string, TokenMetadata>();

  if (mints.length === 0) return metadataMap;

  try {
    const response = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mintAccounts: mints.slice(0, 100) }), // Limit to 100
    });

    if (response.ok) {
      const data = await response.json() as Array<{
        account: string;
        onChainMetadata?: {
          metadata?: {
            data?: {
              name?: string;
              symbol?: string;
            };
          };
        };
        legacyMetadata?: {
          name?: string;
          symbol?: string;
          logoURI?: string;
        };
      }>;

      for (const item of data) {
        const name = item.onChainMetadata?.metadata?.data?.name ||
                     item.legacyMetadata?.name ||
                     "Unknown Token";
        const symbol = item.onChainMetadata?.metadata?.data?.symbol ||
                       item.legacyMetadata?.symbol ||
                       "???";

        metadataMap.set(item.account, {
          name: name.replace(/\0/g, "").trim(),
          symbol: symbol.replace(/\0/g, "").trim(),
          logoURI: item.legacyMetadata?.logoURI,
        });
      }
    }
  } catch (error) {
    // Silently fail, we'll show "Unknown" for tokens without metadata
  }

  return metadataMap;
}

// Classify token risk level
function classifyTokenRisk(
  account: { mint: string; balance: bigint; decimals: number },
  metadata?: TokenMetadata
): { level: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; reason?: string } {
  const name = metadata?.name?.toLowerCase() || "";
  const symbol = metadata?.symbol?.toLowerCase() || "";

  // Check for spam indicators in name/symbol
  for (const indicator of SPAM_INDICATORS) {
    if (name.includes(indicator) || symbol.includes(indicator)) {
      return { level: "HIGH", reason: "Suspicious name (potential scam/airdrop)" };
    }
  }

  // Very small balance (dust)
  const balance = Number(account.balance) / Math.pow(10, account.decimals);
  if (balance > 0 && balance < 0.0001) {
    return { level: "HIGH", reason: "Micro balance (likely tracking dust)" };
  }

  // Zero balance - safe to close
  if (account.balance === 0n) {
    return { level: "LOW", reason: "Empty account - safe to close" };
  }

  // Small balance
  if (balance < 1) {
    return { level: "MEDIUM", reason: "Small balance - review before closing" };
  }

  return { level: "UNKNOWN", reason: "Unable to classify" };
}

function getRiskColor(level: string): (text: string) => string {
  switch (level) {
    case "HIGH": return chalk.red;
    case "MEDIUM": return chalk.yellow;
    case "LOW": return chalk.green;
    default: return chalk.gray;
  }
}

function getRiskEmoji(level: string): string {
  switch (level) {
    case "HIGH": return "🔴";
    case "MEDIUM": return "🟡";
    case "LOW": return "🟢";
    default: return "⚪";
  }
}

async function scanDust(walletAddress: string, options: { showAll?: boolean }) {
  const spinner = ora("Scanning wallet for dust tokens...").start();

  try {
    const connection = new Connection(HELIUS_RPC, "confirmed");
    const pubkey = new PublicKey(walletAddress);

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: TOKEN_PROGRAM_ID,
    });

    // Fetch metadata for all tokens
    const mints = tokenAccounts.value.map(
      (a) => a.account.data.parsed.info.mint
    );

    spinner.text = "Fetching token metadata...";
    const metadataMap = await fetchTokenMetadata(mints);

    spinner.stop();

    const accounts: TokenAccount[] = tokenAccounts.value.map((account) => {
      const info = account.account.data.parsed.info;
      const balance = BigInt(info.tokenAmount.amount);
      const decimals = info.tokenAmount.decimals;
      const metadata = metadataMap.get(info.mint);
      const risk = classifyTokenRisk({ mint: info.mint, balance, decimals }, metadata);

      return {
        pubkey: account.pubkey,
        mint: info.mint,
        balance,
        decimals,
        isCloseable: balance === 0n,
        metadata,
        riskLevel: risk.level,
        riskReason: risk.reason,
      };
    });

    // Sort by risk level (HIGH first)
    const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3 };
    accounts.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

    const closeable = accounts.filter((a) => a.isCloseable);
    const dustTokens = accounts.filter((a) => a.riskLevel === "HIGH" || a.riskLevel === "MEDIUM");
    const withBalance = accounts.filter((a) => !a.isCloseable);

    console.log(chalk.bold("\n  » Dust Scan Results\n"));
    console.log(chalk.gray("  Wallet: ") + chalk.cyan(walletAddress));
    console.log(chalk.gray("  Total token accounts: ") + chalk.white(accounts.length));
    console.log(chalk.gray("  Empty (closeable): ") + chalk.green(closeable.length));
    console.log(chalk.gray("  With balance: ") + chalk.yellow(withBalance.length));
    console.log(chalk.gray("  Potential dust/trackers: ") + chalk.red(dustTokens.length));

    if (closeable.length > 0) {
      const recoverable = (closeable.length * RENT_EXEMPT_LAMPORTS) / 1e9;
      console.log(
        chalk.gray("  Recoverable SOL: ") +
          chalk.green(`~${formatNumber(recoverable)} SOL ($${formatNumber(recoverable * 200, 2)})`)
      );
    }

    // Show dust tokens
    const tokensToShow = options.showAll ? accounts : dustTokens.concat(closeable);

    if (tokensToShow.length > 0) {
      console.log(chalk.bold("\n  Token Accounts:\n"));

      tokensToShow.forEach((account, i) => {
        const riskColor = getRiskColor(account.riskLevel);
        const emoji = getRiskEmoji(account.riskLevel);
        const name = account.metadata?.name || "Unknown Token";
        const symbol = account.metadata?.symbol || "???";
        const balance = Number(account.balance) / Math.pow(10, account.decimals);

        console.log(
          chalk.gray(`  ${i + 1}. `) +
            emoji + " " +
            chalk.white(name.slice(0, 30)) +
            chalk.gray(` (${symbol})`)
        );
        console.log(
          chalk.gray("     Balance: ") +
            (account.balance === 0n
              ? chalk.green("0 (closeable)")
              : chalk.yellow(formatNumber(balance)))
        );
        console.log(
          chalk.gray("     Risk: ") +
            riskColor(account.riskLevel) +
            chalk.gray(` - ${account.riskReason}`)
        );
        console.log(chalk.gray("     Mint: ") + chalk.cyan(account.mint.slice(0, 32) + "..."));
        console.log("");
      });
    }

    if (closeable.length > 0 || dustTokens.length > 0) {
      console.log(chalk.yellow("  › Run 'solprivacy dust clean " + walletAddress + " -i' for interactive cleaning\n"));
    } else {
      console.log(chalk.green("\n  ✓ Your wallet is clean!\n"));
    }
  } catch (error) {
    spinner.stop();
    console.error(chalk.red("\n  Error: ") + (error as Error).message);
    process.exit(1);
  }
}

async function cleanDust(
  walletAddress: string,
  options: {
    keypair?: string;
    yes?: boolean;
    dryRun?: boolean;
    interactive?: boolean;
    burn?: boolean;
  }
) {
  const spinner = ora("Scanning wallet...").start();

  try {
    const connection = new Connection(HELIUS_RPC, "confirmed");
    const walletPubkey = new PublicKey(walletAddress);

    // Get all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: TOKEN_PROGRAM_ID }
    );

    // Fetch metadata
    const mints = tokenAccounts.value.map((a) => a.account.data.parsed.info.mint);
    spinner.text = "Fetching token metadata...";
    const metadataMap = await fetchTokenMetadata(mints);

    spinner.stop();

    // Build account list with metadata
    const accounts: TokenAccount[] = tokenAccounts.value.map((account) => {
      const info = account.account.data.parsed.info;
      const balance = BigInt(info.tokenAmount.amount);
      const decimals = info.tokenAmount.decimals;
      const metadata = metadataMap.get(info.mint);
      const risk = classifyTokenRisk({ mint: info.mint, balance, decimals }, metadata);

      return {
        pubkey: account.pubkey,
        mint: info.mint,
        balance,
        decimals,
        isCloseable: balance === 0n,
        metadata,
        riskLevel: risk.level,
        riskReason: risk.reason,
      };
    });

    // Filter to closeable or burnable
    const closeable = accounts.filter((a) => a.isCloseable);
    const burnable = options.burn
      ? accounts.filter((a) => !a.isCloseable && (a.riskLevel === "HIGH" || a.riskLevel === "MEDIUM"))
      : [];

    const toProcess = [...closeable, ...burnable];

    if (toProcess.length === 0) {
      console.log(chalk.green("\n  ✓ No dust tokens to clean.\n"));
      return;
    }

    const recoverableFromClose = (closeable.length * RENT_EXEMPT_LAMPORTS) / 1e9;
    const recoverableFromBurn = (burnable.length * RENT_EXEMPT_LAMPORTS) / 1e9;
    const totalRecoverable = recoverableFromClose + recoverableFromBurn;

    console.log(chalk.bold("\n  » Dust Clean Summary\n"));
    console.log(chalk.gray("  Empty accounts to close: ") + chalk.green(closeable.length));
    if (burnable.length > 0) {
      console.log(chalk.gray("  Dust tokens to burn+close: ") + chalk.yellow(burnable.length));
    }
    console.log(chalk.gray("  Total SOL recoverable: ") + chalk.green(`~${formatNumber(totalRecoverable)} SOL`));

    if (options.dryRun) {
      console.log(chalk.yellow("\n  [DRY RUN] No transactions will be sent.\n"));
      console.log(chalk.bold("  Accounts that would be processed:\n"));
      toProcess.forEach((account, i) => {
        const name = account.metadata?.name || "Unknown";
        const action = account.isCloseable ? chalk.green("CLOSE") : chalk.yellow("BURN+CLOSE");
        console.log(
          chalk.gray(`  ${i + 1}. `) +
            action + " " +
            chalk.white(name.slice(0, 25)) +
            chalk.gray(` (${account.mint.slice(0, 12)}...)`)
        );
      });
      return;
    }

    // Load keypair
    if (!options.keypair) {
      console.log(chalk.red("\n  ✗ Error: ") + "Keypair required. Use --keypair <path>\n");
      console.log(chalk.gray("  Example: solprivacy dust clean " + walletAddress + " --keypair ~/.config/solana/id.json\n"));
      process.exit(1);
    }

    const keypair = loadKeypair(options.keypair);

    // Verify keypair matches wallet
    if (keypair.publicKey.toString() !== walletAddress) {
      console.log(
        chalk.red("\n  ✗ Error: ") +
          "Keypair public key does not match wallet address\n"
      );
      console.log(chalk.gray("  Keypair: ") + chalk.white(keypair.publicKey.toString()));
      console.log(chalk.gray("  Wallet:  ") + chalk.white(walletAddress));
      process.exit(1);
    }

    // Interactive mode
    if (options.interactive) {
      await interactiveClean(connection, keypair, toProcess);
      return;
    }

    // Batch mode with confirmation
    if (!options.yes) {
      console.log(chalk.yellow("\n  ! This will process " + toProcess.length + " token accounts."));
      console.log(chalk.gray("  Use --interactive (-i) for one-by-one confirmation."));
      console.log(chalk.gray("  Use --yes (-y) to skip this prompt.\n"));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.white("  Proceed with all? (y/N): "), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log(chalk.yellow("\n  Aborted.\n"));
        return;
      }
    }

    // Process in batches
    await batchProcess(connection, keypair, toProcess);

  } catch (error) {
    spinner.stop();
    console.error(chalk.red("\n  Error: ") + (error as Error).message);
    process.exit(1);
  }
}

async function interactiveClean(
  connection: Connection,
  keypair: Keypair,
  accounts: TokenAccount[]
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log(chalk.bold("\n  🔄 Interactive Mode\n"));
  console.log(chalk.gray("  Commands: [y]es, [n]o, [a]ll remaining, [q]uit\n"));

  let totalClosed = 0;
  let totalRecovered = 0;
  let skipRemaining = false;
  let processAll = false;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const name = account.metadata?.name || "Unknown Token";
    const symbol = account.metadata?.symbol || "???";
    const emoji = getRiskEmoji(account.riskLevel);
    const riskColor = getRiskColor(account.riskLevel);
    const action = account.isCloseable ? "Close" : "Burn & Close";
    const balance = Number(account.balance) / Math.pow(10, account.decimals);

    console.log(chalk.gray("  ─".repeat(30)));
    console.log(
      chalk.bold(`  ${i + 1}/${accounts.length}: `) +
        emoji + " " +
        chalk.white(name)
    );
    console.log(chalk.gray("  Symbol: ") + chalk.cyan(symbol));
    console.log(
      chalk.gray("  Balance: ") +
        (account.balance === 0n ? chalk.green("0") : chalk.yellow(formatNumber(balance)))
    );
    console.log(chalk.gray("  Risk: ") + riskColor(account.riskLevel) + chalk.gray(` - ${account.riskReason}`));
    console.log(chalk.gray("  Mint: ") + chalk.cyan(account.mint));
    console.log(chalk.gray("  Action: ") + chalk.white(action));
    console.log(chalk.gray("  Recoverable: ") + chalk.green(`~0.00204 SOL`));

    let shouldProcess = false;

    if (processAll) {
      shouldProcess = true;
      console.log(chalk.green("  → Auto-processing (all mode)"));
    } else if (!skipRemaining) {
      const answer = await question(chalk.white(`\n  ${action} this account? [y/n/a/q]: `));

      switch (answer.toLowerCase()) {
        case "y":
        case "yes":
          shouldProcess = true;
          break;
        case "a":
        case "all":
          shouldProcess = true;
          processAll = true;
          console.log(chalk.yellow("  → Processing all remaining accounts..."));
          break;
        case "q":
        case "quit":
          skipRemaining = true;
          console.log(chalk.yellow("  → Skipping remaining accounts..."));
          break;
        default:
          console.log(chalk.gray("  → Skipped"));
      }
    }

    if (shouldProcess) {
      const spinner = ora("  Processing...").start();

      try {
        const transaction = new Transaction();

        // If has balance, burn first
        if (account.balance > 0n) {
          transaction.add(
            createBurnInstruction(
              account.pubkey,
              new PublicKey(account.mint),
              keypair.publicKey,
              account.balance
            )
          );
        }

        // Then close
        transaction.add(
          createCloseAccountInstruction(
            account.pubkey,
            keypair.publicKey,
            keypair.publicKey
          )
        );

        const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);

        totalClosed++;
        totalRecovered += RENT_EXEMPT_LAMPORTS / 1e9;

        spinner.succeed(
          chalk.green("  ✓ Done! ") +
            chalk.gray(`TX: ${signature.slice(0, 20)}...`)
        );
      } catch (err) {
        spinner.fail(chalk.red(`  ✗ Failed: ${(err as Error).message}`));
      }
    }

    console.log("");
  }

  rl.close();

  console.log(chalk.bold("\n  » Summary\n"));
  console.log(chalk.gray("  Accounts processed: ") + chalk.green(totalClosed));
  console.log(chalk.gray("  SOL recovered: ") + chalk.green(`~${formatNumber(totalRecovered)} SOL`));
  console.log("");
}

async function batchProcess(
  connection: Connection,
  keypair: Keypair,
  accounts: TokenAccount[]
) {
  const batchSize = 5; // Smaller batches for reliability
  let totalClosed = 0;
  let totalRecovered = 0;

  console.log(chalk.bold("\n  Processing...\n"));

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const batchSpinner = ora(
      `  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(accounts.length / batchSize)}: Processing ${batch.length} accounts...`
    ).start();

    try {
      const transaction = new Transaction();

      for (const account of batch) {
        // If has balance, burn first
        if (account.balance > 0n) {
          transaction.add(
            createBurnInstruction(
              account.pubkey,
              new PublicKey(account.mint),
              keypair.publicKey,
              account.balance
            )
          );
        }

        // Close account
        transaction.add(
          createCloseAccountInstruction(
            account.pubkey,
            keypair.publicKey,
            keypair.publicKey
          )
        );
      }

      const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);

      totalClosed += batch.length;
      totalRecovered += (batch.length * RENT_EXEMPT_LAMPORTS) / 1e9;

      batchSpinner.succeed(
        chalk.green(`  ✓ Closed ${batch.length} accounts. `) +
          chalk.gray(`TX: ${signature.slice(0, 20)}...`)
      );
    } catch (err) {
      batchSpinner.fail(chalk.red(`  ✗ Batch failed: ${(err as Error).message}`));
    }
  }

  console.log(chalk.bold("\n  » Summary\n"));
  console.log(chalk.gray("  Accounts closed: ") + chalk.green(totalClosed));
  console.log(chalk.gray("  SOL recovered: ") + chalk.green(`~${formatNumber(totalRecovered)} SOL`));
  console.log("");
}

function loadKeypair(keypairPath: string): Keypair {
  const resolvedPath = keypairPath.startsWith("~")
    ? path.join(process.env.HOME || "", keypairPath.slice(1))
    : path.resolve(keypairPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keypair file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8").trim();

  // Try JSON array format (Solana CLI default)
  try {
    const secretKey = new Uint8Array(JSON.parse(content));
    return Keypair.fromSecretKey(secretKey);
  } catch {
    // Try base58 format
    try {
      const secretKey = bs58.decode(content);
      return Keypair.fromSecretKey(secretKey);
    } catch {
      throw new Error(
        "Invalid keypair format. Expected JSON array or base58 string."
      );
    }
  }
}
