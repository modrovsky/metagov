import dotenv from 'dotenv';
import { loadOrganizationProfile } from './profile';
dotenv.config();

const { profile, source: profileSource } = loadOrganizationProfile();

// Strip 0x prefix if someone pastes it
function cleanPrivateKey(key: string): string {
  return key.startsWith('0x') ? key.slice(2) : key;
}

export const config = {
  // Organization profile (public settings only; environment variables win)
  organizationName: process.env.ORGANIZATION_NAME || profile.name || 'Metagov',
  profileSource,

  // RPC & Chain
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  chainId: 1,

  // Bot Wallet
  botPrivateKey: cleanPrivateKey(process.env.BOT_PRIVATE_KEY || ''),

  // Safe
  safeAddress: process.env.SAFE_ADDRESS || profile.safeAddress || '',
  safeApiKey: process.env.SAFE_API_KEY || '',

  // GraphQL Endpoints
  nounsGraphqlEndpoint: process.env.NOUNS_GRAPHQL_ENDPOINT || 'https://api.goldsky.com/api/public/project_clnbcoajmebxn33wdbt98f439/subgraphs/nouns-mainnet/1.0.0/gn',
  snapshotHub: 'https://hub.snapshot.org',
  snapshotGraphql: 'https://hub.snapshot.org/graphql',

  // Snapshot Space
  snapshotSpaceId: process.env.SNAPSHOT_SPACE_ID || profile.snapshotSpaceId || '',

  // Contract Addresses
  nounsDaoAddress: process.env.NOUNS_DAO_ADDRESS || '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',

  // Nouns client incentives ID
  clientId: process.env.CLIENT_ID !== undefined
    ? parseInt(process.env.CLIENT_ID)
    : profile.clientId ?? 0,

  // Optional Snapshot timing overrides. By default, use the space settings.
  snapshotVotingDelaySeconds: process.env.SNAPSHOT_VOTING_DELAY_SECONDS
    ? parseInt(process.env.SNAPSHOT_VOTING_DELAY_SECONDS)
    : undefined,
  votingDurationDays: process.env.VOTING_DURATION_DAYS
    ? parseFloat(process.env.VOTING_DURATION_DAYS)
    : undefined,

  // URL template for proposal links ({id} is replaced with Nouns proposal ID)
  proposalLinkTemplate: process.env.PROPOSAL_LINK_TEMPLATE || profile.proposalLinkTemplate || 'https://nouns.wtf/vote/{id}',

  // Block explorer URL for tx links in logs
  blockExplorerTxUrl: 'https://etherscan.io/tx/',

  // What to do when no Snapshot votes are cast: "abstain" or "skip"
  noVotesAction: (process.env.NO_VOTES_ACTION || profile.noVotesAction || 'abstain').toLowerCase() as 'abstain' | 'skip',

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
      throw new Error(`Missing required config: ${key} (set it via environment variable or profile)`);
    }
  }

  // Validate Safe address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.safeAddress)) {
    throw new Error(`Invalid SAFE_ADDRESS: ${config.safeAddress}`);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(config.botPrivateKey)) {
    throw new Error('BOT_PRIVATE_KEY must be a 32-byte hexadecimal private key');
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(config.nounsDaoAddress)) {
    throw new Error(`Invalid NOUNS_DAO_ADDRESS: ${config.nounsDaoAddress}`);
  }

  for (const [name, value] of [
    ['ETHEREUM_RPC_URL', config.ethereumRpcUrl],
    ['NOUNS_GRAPHQL_ENDPOINT', config.nounsGraphqlEndpoint],
    ['SNAPSHOT_HUB', config.snapshotHub],
    ['SNAPSHOT_GRAPHQL_ENDPOINT', config.snapshotGraphql],
  ]) {
    try {
      new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL`);
    }
  }

  if (!Number.isSafeInteger(config.clientId) || config.clientId < 0 || config.clientId > 0xffffffff) {
    throw new Error('CLIENT_ID must be an integer between 0 and 4294967295');
  }

  if (
    config.snapshotVotingDelaySeconds !== undefined &&
    (!Number.isSafeInteger(config.snapshotVotingDelaySeconds) || config.snapshotVotingDelaySeconds < 0)
  ) {
    throw new Error('SNAPSHOT_VOTING_DELAY_SECONDS must be a non-negative integer');
  }

  if (
    config.votingDurationDays !== undefined &&
    (!Number.isFinite(config.votingDurationDays) || config.votingDurationDays <= 0)
  ) {
    throw new Error('VOTING_DURATION_DAYS must be greater than zero');
  }

  if (!['abstain', 'skip'].includes(config.noVotesAction)) {
    throw new Error('NO_VOTES_ACTION must be either "abstain" or "skip"');
  }

  for (const [name, value] of [
    ['PROPOSAL_POLL_MINUTES', config.proposalPollMinutes],
    ['VOTE_POLL_MINUTES', config.votePollMinutes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 59) {
      throw new Error(`${name} must be an integer between 1 and 59`);
    }
  }

  for (const [name, value] of [
    ['LOOKBACK_DAYS', config.lookbackDays],
    ['MIN_PROPOSAL_ID', config.minProposalId],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }

  if (!Number.isFinite(config.maxGasPriceGwei) || config.maxGasPriceGwei <= 0) {
    throw new Error('MAX_GAS_PRICE_GWEI must be greater than zero');
  }

  if (!Number.isSafeInteger(config.maxRetries) || config.maxRetries < 1 || config.maxRetries > 3) {
    throw new Error('MAX_RETRIES must be an integer between 1 and 3');
  }

  if (!config.dataDir.trim()) {
    throw new Error('DATA_DIR cannot be empty');
  }

  if (!config.proposalLinkTemplate.includes('{id}')) {
    throw new Error('PROPOSAL_LINK_TEMPLATE must contain the {id} placeholder');
  }

  if (!config.organizationName.trim()) {
    throw new Error('ORGANIZATION_NAME or profile name cannot be empty');
  }
}
