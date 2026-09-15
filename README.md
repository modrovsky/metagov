# Metagov

Hey everybody — this is a reusable version of the metagovernance automation I built for the League of Lils.

It is intended to be cloned or forked by other Nounish DAOs that participate in Nouns DAO governance. The bot mirrors new Nouns DAO proposals into your community's Snapshot space, lets your token holders decide how your DAO should vote, and then submits the result onchain through your Safe.

The whole loop is automated:

1. A proposal appears on Nouns DAO.
2. The bot creates a matching Snapshot proposal for your community.
3. Your community votes For, Against, or Abstain.
4. When the Snapshot vote closes, the bot submits the winning choice through your Safe.

The goal is simple: communities can participate consistently without relying on someone to manually create every Snapshot proposal or remember to cast the final vote before the Nouns voting window closes.

## Before you run it

You will need:

- Node.js 18 or newer
- A Snapshot space for your community
- A Safe on Ethereum mainnet that holds delegated Nouns voting power
- A dedicated bot wallet added as an owner of that Safe
- A Safe threshold of 1, so the bot can execute the community's decision
- Some ETH in the bot wallet to pay transaction gas

That last part is important: this setup gives the bot wallet the ability to execute transactions from a threshold-1 Safe. Use a dedicated Safe and bot wallet, and understand that trust assumption before deploying it.

## Set it up

Clone the repository and install the dependencies:

```bash
git clone <your-repo-url>
cd metagov
npm install
cp .env.example .env
```

Open `.env` and fill in these three values:

```env
BOT_PRIVATE_KEY=your_private_key
SAFE_ADDRESS=0xYourSafeAddress
SNAPSHOT_SPACE_ID=yourdao.eth
```

The private key may include the `0x` prefix or omit it. Never commit `.env`.

Check the setup before starting the bot:

```bash
npm run doctor
```

The doctor checks the RPC connection, bot wallet, Safe ownership and threshold, Nouns indexer, Snapshot settings, and state directory.

Then run it in dry-run mode:

```bash
DRY_RUN=true npm run dev
```

Dry-run mode reads live data and prints what the bot would do without publishing proposals, writing bot state, or sending transactions.

When everything looks right:

```bash
npm run build
npm start
```

## Organization profiles

You can keep public organization settings in a small JSON profile instead of repeating them in deployment variables.

Copy `profiles/example.json` to something like `profiles/mydao.json`, edit it, and set:

```env
METAGOV_PROFILE=mydao
BOT_PRIVATE_KEY=your_private_key
```

Environment variables override profile values. Private keys and Safe API keys do not belong in profiles; keep those in your environment.

Profiles are optional. Using only `.env` is perfectly fine for a single deployment.

## Useful settings

Most deployments only need the three required values. A few settings you may care about are:

```env
# Use a different Ethereum RPC or Nouns indexer
ETHEREUM_RPC_URL=https://eth.llamarpc.com
NOUNS_GRAPHQL_ENDPOINT=

# Register a client ID at vote.wtf/clients if desired
CLIENT_ID=0

# Ignore older Nouns proposals when starting a new deployment
MIN_PROPOSAL_ID=0

# Abstain or skip when nobody votes on Snapshot
NO_VOTES_ACTION=abstain

# Avoid submitting during unusually expensive gas conditions
MAX_GAS_PRICE_GWEI=100

# Store persistent bot state somewhere else
DATA_DIR=data
```

Proposal timing follows your Snapshot space settings. If necessary, you can override it with `SNAPSHOT_VOTING_DELAY_SECONDS` and `VOTING_DURATION_DAYS`. The full list of available settings and comments lives in `.env.example`.

## Deploying it

The bot needs to run continuously, and its `data` directory must survive restarts. That directory records which proposals were posted and which votes were executed.

On Railway, deploy the repository, add your environment variables, and mount a persistent volume at `/app/data`.

With Docker:

```bash
docker build -t metagov .
docker run --env-file .env -v metagov-data:/app/data metagov
```

With PM2:

```bash
npm run build
pm2 start dist/index.js --name metagov
```

## A few operational notes

- The bot checks both local state and Snapshot before creating proposals, helping prevent duplicates across restarts.
- If a Nouns proposal is cancelled or vetoed, the matching active Snapshot proposal is cancelled too.
- The onchain vote reason includes the Snapshot totals, voter names, and any reasons voters supplied.
- The bot wallet pays for the outer Safe transaction. The Nouns DAO gas refund is paid to the Safe because the Safe is the address calling the Nouns DAO contract.
- `SAFE_API_KEY` is optional. It only records transactions with the Safe Transaction Service for visibility in the Safe interface.

This project came from a bot running for the League of Lils. Metagov is the generalized version so other Nounish communities can use the same workflow without rebuilding it from scratch.
