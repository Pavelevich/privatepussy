<p align="center">
  <img src="https://raw.githubusercontent.com/Pavelevich/privatepussy/main/assets/logo.png" alt="Private Pussy" width="120" />
</p>

<h1 align="center">PRIVATE PUSSY</h1>

<p align="center">
  <strong>ZK Privacy Tools for Solana</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/privatepussy"><img src="https://img.shields.io/npm/v/privatepussy.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/privatepussy"><img src="https://img.shields.io/npm/dm/privatepussy.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/Pavelevich/privatepussy/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license" /></a>
  <a href="https://solprivacy.xyz"><img src="https://img.shields.io/badge/web-solprivacy.xyz-cyan?style=flat-square" alt="website" /></a>
</p>

<p align="center">
  Shield your SOL with ZK compression. Break the chain. Stay private.
</p>

---

## Features

- **Privacy Migration** - Shield SOL using Light Protocol ZK compression
- **Wallet Scanner** - Analyze any wallet for dust attacks & privacy risks
- **Encrypted Wallets** - AES-256-GCM encrypted keypair storage
- **QR Code Funding** - Easy wallet funding via QR code

## Quick Start

```bash
npx privatepussy
```

Or install globally:

```bash
npm install -g privatepussy
privatepussy
```

## How It Works

### 1. Privacy Migration (Shield/Unshield)

Uses [Light Protocol](https://lightprotocol.com) ZK compression to break the on-chain link between your wallets:

```
Your Wallet ──► Shield (compress) ──► Private Account ──► Unshield ──► New Wallet
                     │                                         │
                     └─── No on-chain link between wallets ────┘
```

**The Flow:**
1. Create a new wallet in the CLI
2. Send SOL from your existing wallet (Phantom, etc.)
3. Shield the SOL (compress into private account)
4. Unshield to a completely new wallet
5. No traceable connection between source and destination

### 2. Wallet Scanner

Analyze any Solana wallet for privacy risks:

- Dust attack detection
- Tracking token identification
- Token categorization (empty, dust, legitimate)
- SOL rent recovery estimation

```bash
# Just enter any public address - no private key needed
privatepussy
> Scan Wallet
> Enter wallet address: <any-solana-address>
```

## Menu Options

```
┌─────────────────────────────────────────────────┐
│           PRIVATE PUSSY - Main Menu             │
├─────────────────────────────────────────────────┤
│  ★ Privacy Migration  (Shield/Unshield - ZK)   │
│  › Scan Wallet        (Dust & privacy analysis)│
│  › Settings           (Network/Wallets/RPC)    │
│  › Clear                                        │
│  › Exit                                         │
└─────────────────────────────────────────────────┘
```

## Network Support

| Network | Privacy Migration | Wallet Scan |
|---------|-------------------|-------------|
| Devnet  | ✅ Full support   | ✅ Available |
| Mainnet | ❌ Coming soon*   | ✅ Available |

*Light Protocol state trees for native SOL compression are currently only active on Devnet.

## Security

- **Keys stay local** - Your private keys never leave your machine
- **Encrypted storage** - Wallets encrypted with AES-256-GCM + PBKDF2
- **Open source** - Audit the code yourself
- **No tracking** - We don't collect any data

## Privacy Migration vs Other Solutions

| Feature | Private Pussy | Mixers | CEX |
|---------|--------------|--------|-----|
| No KYC | ✅ | ✅ | ❌ |
| No anonymity set dependency | ✅ | ❌ | ✅ |
| Trustless | ✅ | ❌ | ❌ |
| On-chain privacy | ✅ | ✅ | ❌ |
| Instant | ✅ | ❌ | ❌ |

## Tech Stack

- [Light Protocol](https://lightprotocol.com) - ZK compression
- [Helius](https://helius.dev) - RPC infrastructure
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/) - Blockchain interaction

## Related

- **Web App**: [solprivacy.xyz](https://solprivacy.xyz) - Full privacy analysis dashboard
- **API**: `solprivacy.xyz/api/v3/analyze/{wallet}` - Privacy analysis API

## Development

```bash
# Clone
git clone https://github.com/Pavelevich/privatepussy.git
cd privatepussy

# Install
npm install

# Dev mode
npm run dev

# Build
npm run build

# Run
npm start
```

## License

MIT - Do whatever you want with it.

---

<p align="center">
  Built for the <a href="https://www.colosseum.org/">Solana Privacy Hackathon</a> 2026
</p>

<p align="center">
  <sub>Stay private. Stay safe. 🐱</sub>
</p>
