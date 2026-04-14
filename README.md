# Metagov

Metagovernance automation bot for Nouns DAO. Mirrors Nouns proposals to a Snapshot space so your community can vote, then automatically executes the winning vote on-chain through a Safe multisig.

## How it works

1. **Polls** for new Nouns DAO proposals via a GraphQL subgraph
2. **Creates** a corresponding Snapshot proposal in your space (For / Against / Abstain)
3. **Waits** for the Snapshot vote to close
4. **Executes** the winning vote on-chain through your Safe wallet

## Prerequisites

- **Node.js 18+**
- **A Safe multisig** on Ethereum mainnet
  - The Safe must hold Nouns voting power (be a delegate)
  - Threshold must be 1
- **A bot wallet (EOA)** added as a signer on the Safe
  - Funded with ~0.1 ETH for gas
- **A Snapshot space** configured for your organization

## Quick start

```bash
git clone <your-repo-url>
cd metagov
npm install
cp .env.example .env
```

Edit `.env` -- you only need to fill in 3 values:

```env
BOT_PRIVATE_KEY=your_private_key_here
SAFE_ADDRESS=0xYourSafeAddress
SNAPSHOT_SPACE_ID=yourdao.eth
```

Test it first:
```bash
DRY_RUN=true npm run dev
```

Run for real:
```bash
npm run build
npm start
```

## Configuration

Everything is controlled via `.env`. Only 3 values are required -- everything else has sensible defaults.

### Required

| Variable | Description |
|----------|-------------|
| `BOT_PRIVATE_KEY` | Bot wallet private key (with or without `0x` prefix) |
| `SAFE_ADDRESS` | Your Safe multisig address |
| `SNAPSHOT_SPACE_ID` | Your Snapshot space (e.g. `mydao.eth`) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ETHEREUM_RPC_URL` | Public LlamaRPC | Any Ethereum mainnet RPC |
| `NOUNS_GRAPHQL_ENDPOINT` | Public Goldsky subgraph | Nouns subgraph URL. Ask your indexer provider for a URL if needed |
| `NOUNS_DAO_ADDRESS` | Nouns DAO mainnet | Nouns DAO contract |
| `SAFE_API_KEY` | _(none)_ | Safe Transaction Service JWT. Optional -- only shows txs in Safe web UI |
| `CLIENT_ID` | `0` | Nouns client incentives ID (register at vote.wtf/clients) |
| `VOTING_DURATION_DAYS` | `5` | How long Snapshot votes stay open |
| `NO_VOTES_ACTION` | `abstain` | What to do if nobody votes: `abstain` or `skip` |
| `MIN_PROPOSAL_ID` | `0` | Ignore proposals before this ID |
| `LOOKBACK_DAYS` | `7` | How far back to scan on startup |
| `PROPOSAL_LINK_TEMPLATE` | `https://nouns.wtf/vote/{id}` | Link in Snapshot proposal body + discussion |
| `PROPOSAL_POLL_MINUTES` | `1` | How often to check for new proposals |
| `VOTE_POLL_MINUTES` | `5` | How often to check for closed votes |
| `DATA_DIR` | `data` | Where to store state files (useful for Docker volumes) |
| `MAX_GAS_PRICE_GWEI` | `100` | Max gas price before deferring a vote |
| `MAX_RETRIES` | `3` | Retry attempts for failed vote execution |
| `DRY_RUN` | `false` | Log actions without executing |

See `.env.example` for the full list with comments.

## Deployment

The bot must run continuously. State is persisted to `DATA_DIR` (default: `data/`) -- make sure this survives restarts.

### Railway (recommended)

1. Push this repo to GitHub
2. Go to [railway.com](https://railway.app) and create a new project
3. Select "Deploy from GitHub repo" and connect this repo
4. Go to **Variables** and add your 3 required env vars: `BOT_PRIVATE_KEY`, `SAFE_ADDRESS`, `SNAPSHOT_SPACE_ID`
5. Add a **Volume** mounted at `/app/data` (this persists state across deploys)
6. Railway auto-detects Node.js, runs `npm run build` and `npm start`
7. Set `DRY_RUN=true` first to verify everything works, then remove it

Railway usage for this bot is very light -- expect under $2/month.

### Docker

```bash
docker build -t metagov .
docker run --env-file .env -v metagov-data:/app/data metagov
```

### PM2

```bash
npm run build
pm2 start dist/index.js --name metagov
```

## Architecture

```
src/
  index.ts                    # Main loop + cron scheduling
  config.ts                   # Environment-based configuration
  listeners/
    nounsProposals.ts         # Polls Nouns subgraph for new proposals
  services/
    snapshot.ts               # Create/cancel Snapshot proposals, read results
    safeVoting.ts             # Execute votes through Safe + format vote reasons
    stateStore.ts             # Local JSON file persistence
  utils/
    wallet.ts                 # Ethers provider + wallet setup
```

## Vote formatting

When the bot executes a vote on-chain, it includes a detailed reason showing how your community voted on Snapshot. The on-chain vote reason looks like this:

```
**FOR 12 VOTES**

**toady.eth** | *"Great proposal, fully support this"*
**nounslover.eth**
**0xABCD...1234**

**AGAINST 3 VOTES**

**someguy.eth** | *"Too expensive"*

**ABSTAIN 0 VOTES**
```

Voter names are resolved in order: Snapshot profile name > ENS name > truncated address. Reasons are included when voters leave them on Snapshot.

## Notes

- **Gas refunds**: Gas is paid by the bot wallet and Nouns DAO refunds it back to the bot.
- **Safe API key**: Purely optional. It only records transactions in Safe's web UI for visibility. All execution uses the bot's private key directly.
- **Deduplication**: The bot has triple-layer deduplication (memory + Snapshot API + local state file) to prevent re-posting proposals across restarts.
- **Private key format**: Works with or without the `0x` prefix -- paste it however you have it.
