import dotenv from 'dotenv';
dotenv.config();

// Strip 0x prefix if someone pastes it
function cleanPrivateKey(key: string): string {
  return key.startsWith('0x') ? key.slice(2) : key;
}

export const config = {
  // RPC & Chain
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  chainId: 1,

  // Bot Wallet
  botPrivateKey: cleanPrivateKey(process.env.BOT_PRIVATE_KEY || ''),

  // Safe
  safeAddress: process.env.SAFE_ADDRESS || '',
  safeApiKey: process.env.SAFE_API_KEY || '',

  // GraphQL Endpoints
  nounsGraphqlEndpoint: process.env.NOUNS_GRAPHQL_ENDPOINT || 'https://api.goldsky.com/api/public/project_clnbcoajmebxn33wdbt98f439/subgraphs/nouns-mainnet/1.0.0/gn',
  snapshotHub: 'https://hub.snapshot.org',
  snapshotGraphql: 'https://hub.snapshot.org/graphql',

  // Snapshot Space
  snapshotSpaceId: process.env.SNAPSHOT_SPACE_ID || '',

  // Contract Addresses
  nounsDaoAddress: process.env.NOUNS_DAO_ADDRESS || '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',

  // Nouns client incentives ID
  clientId: parseInt(process.env.CLIENT_ID || '0'),

  // Snapshot voting duration (seconds)
  votingDurationDays: parseInt(process.env.VOTING_DURATION_DAYS || '5'),
  get snapshotVotingDuration(): number {
    return this.votingDurationDays * 24 * 60 * 60;
  },

  // URL template for proposal links ({id} is replaced with Nouns proposal ID)
  proposalLinkTemplate: process.env.PROPOSAL_LINK_TEMPLATE || 'https://nouns.wtf/vote/{id}',

  // Block explorer URL for tx links in logs
  blockExplorerTxUrl: 'https://etherscan.io/tx/',

  // What to do when no Snapshot votes are cast: "abstain" or "skip"
  noVotesAction: (process.env.NO_VOTES_ACTION || 'abstain').toLowerCase() as 'abstain' | 'skip',

  // Polling intervals (minutes)
  proposalPollMinutes: parseInt(process.env.PROPOSAL_POLL_MINUTES || '1'),
  votePollMinutes: parseInt(process.env.VOTE_POLL_MINUTES || '5'),

  // How many days back to look on startup
  lookbackDays: parseInt(process.env.LOOKBACK_DAYS || '7'),

  // Directory for persistent state files
  dataDir: process.env.DATA_DIR || 'data',

  // Gas settings
  maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || '100'),
  gasBufferPercent: 30,
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),

  // Minimum Nouns proposal ID to consider
  minProposalId: parseInt(process.env.MIN_PROPOSAL_ID || '0'),

  // Dry run mode
  dryRun: process.env.DRY_RUN === 'true',
};

export function validateConfig(): void {
  const required: (keyof typeof config)[] = [
    'botPrivateKey',
    'safeAddress',
    'snapshotSpaceId',
  ];

  for (const key of required) {
    if (!config[key]) {
      throw new Error(`Missing required config: ${key} (set via env var)`);
    }
  }

  // Validate Safe address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.safeAddress)) {
    throw new Error(`Invalid SAFE_ADDRESS: ${config.safeAddress}`);
  }
}
