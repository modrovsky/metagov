import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { MetaTransactionData } from '@safe-global/safe-core-sdk-types';
import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client/core';
import fetch from 'cross-fetch';
import { ethers } from 'ethers';
import { config } from '../config';
import { fetchProposalById } from '../listeners/nounsProposals';
import { getProvider } from '../utils/wallet';

const NOUNS_DAO_ABI = [
  'function castRefundableVoteWithReason(uint256 proposalId, uint8 support, string reason, uint32 clientId) returns (uint256)',
  'function getReceipt(uint256 proposalId, address voter) view returns (bool hasVoted, uint8 support, uint96 votes)',
];

const SUPPORT_VALUES = {
  FOR: 1,
  AGAINST: 0,
  ABSTAIN: 2,
} as const;

type VoteChoice = 'FOR' | 'AGAINST' | 'ABSTAIN';

async function isProposalVoteable(proposalId: string): Promise<{ voteable: boolean; status: string }> {
  const proposal = await fetchProposalById(proposalId);
  if (!proposal) {
    return { voteable: false, status: 'NOT_FOUND' };
  }

  if (proposal.status === 'CANCELLED' || proposal.status === 'EXECUTED' || proposal.status === 'VETOED') {
    return { voteable: false, status: proposal.status };
  }

  const provider = getProvider();
  const currentBlock = await provider.getBlockNumber();
  const startBlock = parseInt(proposal.startBlock);
  const endBlock = parseInt(proposal.endBlock);
  const voteable = currentBlock >= startBlock && currentBlock <= endBlock;
  const status = voteable ? 'ACTIVE' : (currentBlock < startBlock ? 'PENDING' : 'ENDED');
  return { voteable, status };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ExecutionResult {
  safeTxHash: string;
  executionTxHash: string;
  blockNumber: number;
  gasUsed: string;
}

export type VoteExecutionOutcome =
  | { status: 'executed'; execution: ExecutionResult }
  | { status: 'deferred'; reason: string }
  | { status: 'already-voted'; reason: string }
  | { status: 'failed'; reason: string; retryable: boolean };

type ExecutionAttemptOutcome =
  | { status: 'executed'; execution: ExecutionResult }
  | { status: 'failed'; reason: string; retryable: boolean };

export async function hasAlreadyVoted(proposalId: string): Promise<boolean> {
  try {
    const provider = getProvider();
    const nounsDao = new ethers.Contract(config.nounsDaoAddress, NOUNS_DAO_ABI, provider);
    const receipt = await nounsDao.getReceipt(proposalId, config.safeAddress);
    return receipt.hasVoted || receipt[0];
  } catch {
    return false;
  }
}

export async function executeVoteThroughSafe(
  proposalId: string,
  voteChoice: VoteChoice,
  formattedReason: string,
): Promise<VoteExecutionOutcome> {
  // Defense in depth: callers must never be able to execute in dry-run mode.
  if (config.dryRun) {
    console.log(`[DRY RUN] Would vote ${voteChoice} on Nouns #${proposalId} through the Safe`);
    return { status: 'deferred', reason: 'dry-run mode' };
  }

  const { voteable, status } = await isProposalVoteable(proposalId);
  if (!voteable) {
    console.log(`Cannot vote: Nouns proposal #${proposalId} is ${status}`);
    const retryable = status === 'NOT_FOUND' || status === 'PENDING';
    return retryable
      ? { status: 'deferred', reason: `proposal is ${status}` }
      : { status: 'failed', reason: `proposal is ${status}`, retryable: false };
  }

  if (await hasAlreadyVoted(proposalId)) {
    console.log(`Safe has already voted on Nouns proposal #${proposalId}, skipping`);
    return { status: 'already-voted', reason: 'Safe has already voted on-chain' };
  }

  const provider = getProvider();
  const feeData = await provider.getFeeData();
  if (feeData.maxFeePerGas && feeData.maxFeePerGas > BigInt(config.maxGasPriceGwei) * 10n ** 9n) {
    console.warn(`Gas price too high (${ethers.formatUnits(feeData.maxFeePerGas, 'gwei')} gwei), deferring vote`);
    return { status: 'deferred', reason: 'gas price exceeds configured maximum' };
  }

  const retryDelays = [0, 30_000, 120_000];
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    if (retryDelays[attempt] > 0) {
      console.log(`  Retrying in ${retryDelays[attempt] / 1000}s (attempt ${attempt + 1}/${config.maxRetries})...`);
      await sleep(retryDelays[attempt]);
    }

    const bufferPercent = attempt === config.maxRetries - 1
      ? Math.max(config.gasBufferPercent, 50)
      : config.gasBufferPercent;

    const outcome = await attemptExecution(proposalId, voteChoice, formattedReason, bufferPercent);
    if (outcome.status === 'executed') return outcome;

    if (!outcome.retryable) {
      console.error(`  Terminal execution failure: ${outcome.reason}`);
      return outcome;
    }

    if (attempt < config.maxRetries - 1) {
      const recheck = await isProposalVoteable(proposalId);
      if (!recheck.voteable) {
        console.log(`  Proposal #${proposalId} is no longer voteable (${recheck.status}), stopping retries`);
        return { status: 'failed', reason: `proposal is ${recheck.status}`, retryable: false };
      }
    }
  }

  console.error(`  All ${config.maxRetries} attempts failed for proposal #${proposalId}`);
  return { status: 'failed', reason: 'retry limit reached', retryable: true };
}

async function attemptExecution(
  proposalId: string,
  voteChoice: VoteChoice,
  formattedReason: string,
  bufferPercent: number,
): Promise<ExecutionAttemptOutcome> {
  try {
    const protocolKit = await Safe.init({
      provider: config.ethereumRpcUrl,
      signer: config.botPrivateKey,
      safeAddress: config.safeAddress,
    });

    const nounsDao = new ethers.Interface(NOUNS_DAO_ABI);
    const support = SUPPORT_VALUES[voteChoice];
    const data = nounsDao.encodeFunctionData('castRefundableVoteWithReason', [
      proposalId,
      support,
      formattedReason,
      config.clientId,
    ]);

    const safeTxData: MetaTransactionData = {
      to: config.nounsDaoAddress,
      value: '0',
      data,
    };

    const safeTx = await protocolKit.createTransaction({ transactions: [safeTxData] });
    const signedTx = await protocolKit.signTransaction(safeTx);
    const safeTxHash = await protocolKit.getTransactionHash(signedTx);

    // Record in Safe Transaction Service for UI visibility (optional, non-fatal)
    if (config.safeApiKey) {
      try {
        const apiKit = new SafeApiKit({
          chainId: BigInt(config.chainId),
          apiKey: config.safeApiKey,
        });
        const senderAddress = await protocolKit.getSafeProvider().getSignerAddress();
        await apiKit.proposeTransaction({
          safeAddress: config.safeAddress,
          safeTransactionData: signedTx.data,
          safeTxHash,
          senderAddress: senderAddress!,
          senderSignature: Array.from(signedTx.signatures.values())[0].data,
        });
      } catch (err: any) {
        console.warn(`  Could not record tx in Safe Transaction Service: ${err.message}`);
      }
    }

    // Estimate gas and apply buffer
    const provider = getProvider();
    const senderWallet = new ethers.Wallet(config.botPrivateKey, provider);
    const safeContract = new ethers.Contract(
      config.safeAddress,
      ['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)'],
      senderWallet,
    );
    const execData = safeContract.interface.encodeFunctionData('execTransaction', [
      signedTx.data.to,
      signedTx.data.value,
      signedTx.data.data,
      signedTx.data.operation,
      signedTx.data.safeTxGas,
      signedTx.data.baseGas,
      signedTx.data.gasPrice,
      signedTx.data.gasToken,
      signedTx.data.refundReceiver,
      await signedTx.encodedSignatures(),
    ]);
    const estimatedGas = await provider.estimateGas({
      to: config.safeAddress,
      data: execData,
      from: senderWallet.address,
    });
    const gasLimit = (estimatedGas * BigInt(100 + bufferPercent)) / 100n;
    console.log(`  Executing vote through Safe (estimated: ${estimatedGas}, limit: ${gasLimit}, buffer: ${bufferPercent}%)...`);

    const executionResult = await protocolKit.executeTransaction(signedTx, {
      gasLimit: gasLimit.toString(),
    });

    const receipt = await (executionResult.transactionResponse as any)?.wait(1);
    const txHash = executionResult.hash || receipt?.hash;

    if (!receipt || receipt.status === 0) {
      console.error(`  Tx reverted onchain: ${txHash}`);
      return { status: 'failed', reason: `transaction ${txHash} reverted on-chain`, retryable: false };
    }

    console.log(`Vote executed for Nouns #${proposalId}: ${voteChoice}`);
    console.log(`  Tx: ${config.blockExplorerTxUrl}${txHash}`);

    return {
      status: 'executed',
      execution: {
        safeTxHash,
        executionTxHash: txHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
      },
    };
  } catch (error: any) {
    const reason = error.message || String(error);
    const revertedOnchain = error.receipt?.status === 0;
    console.error(`  Execution attempt failed: ${reason}`);
    return { status: 'failed', reason, retryable: !revertedOnchain };
  }
}

const snapshotClient = new ApolloClient({
  link: new HttpLink({ uri: config.snapshotGraphql, fetch }),
  cache: new InMemoryCache(),
});

const GET_PROPOSAL_VOTES = gql`
  query ProposalVotes($id: String!) {
    proposal(id: $id) {
      id
      title
      state
      choices
      scores
    }
    votes(where: { proposal: $id }, first: 1000, orderBy: "vp", orderDirection: desc) {
      voter
      choice
      vp
      reason
    }
  }
`;

interface Vote {
  voter: string;
  choice: number;
  vp: number;
  reason: string;
}

async function fetchSnapshotProfiles(addresses: string[]): Promise<Map<string, string>> {
  const profileMap = new Map<string, string>();

  try {
    const query = `query Users($ids: [String!]!) {
      users(where: { id_in: $ids }) {
        id
        name
      }
    }`;

    const res = await fetch(config.snapshotGraphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { ids: addresses },
      }),
    });

    const data = await res.json();
    for (const user of data.data?.users || []) {
      if (user.name) {
        profileMap.set(user.id.toLowerCase(), user.name);
      }
    }
  } catch (error) {
    console.error('Error fetching Snapshot profiles:', error);
  }

  return profileMap;
}

async function resolveEnsNames(addresses: string[], skipAddresses: Set<string>): Promise<Map<string, string>> {
  const provider = new ethers.JsonRpcProvider(config.ethereumRpcUrl);
  const nameMap = new Map<string, string>();

  const toResolve = addresses.filter((addr) => !skipAddresses.has(addr.toLowerCase()));

  const results = await Promise.allSettled(
    toResolve.map(async (address) => {
      const ensName = await provider.lookupAddress(address);
      return { address, ensName };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.ensName) {
      nameMap.set(result.value.address.toLowerCase(), result.value.ensName);
    }
  }

  return nameMap;
}

async function resolveVoterNames(addresses: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();

  const snapshotNames = await fetchSnapshotProfiles(addresses);
  for (const [addr, name] of snapshotNames) {
    nameMap.set(addr, name);
  }

  const ensNames = await resolveEnsNames(addresses, new Set(snapshotNames.keys()));
  for (const [addr, name] of ensNames) {
    nameMap.set(addr, name);
  }

  return nameMap;
}

function formatVoterName(address: string, nameMap: Map<string, string>): string {
  const name = nameMap.get(address.toLowerCase());
  if (name) {
    return name;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function formatVoteReason(
  snapshotProposalId: string
): Promise<{ choice: VoteChoice; reason: string } | null> {
  try {
    const { data } = await snapshotClient.query<any>({
      query: GET_PROPOSAL_VOTES,
      variables: { id: snapshotProposalId },
      fetchPolicy: 'network-only',
    });

    const proposal = data.proposal;
    const votes = data.votes as Vote[];

    if (!proposal || proposal.state !== 'closed') {
      return null;
    }

    const allAddresses = votes.map((v) => v.voter);
    const nameMap = await resolveVoterNames(allAddresses);

    const scores = proposal.scores as number[];
    const [forScore, againstScore, abstainScore] = scores;

    const maxScore = Math.max(forScore, againstScore, abstainScore);
    let choice: VoteChoice;
    if (maxScore === forScore) choice = 'FOR';
    else if (maxScore === againstScore) choice = 'AGAINST';
    else choice = 'ABSTAIN';

    const votesByChoice: { [key: number]: Vote[] } = { 1: [], 2: [], 3: [] };
    for (const vote of votes) {
      if (votesByChoice[vote.choice]) {
        votesByChoice[vote.choice].push(vote);
      }
    }

    let reason = '';

    reason += `**FOR ${Math.round(forScore)} VOTES**\n\n`;
    for (const vote of votesByChoice[1]) {
      const voterName = formatVoterName(vote.voter, nameMap);
      if (vote.reason?.trim()) {
        reason += `**${voterName}** | *"${vote.reason.trim()}"*\n\n`;
      } else {
        reason += `**${voterName}**\n\n`;
      }
    }

    reason += `**AGAINST ${Math.round(againstScore)} VOTES**\n\n`;
    for (const vote of votesByChoice[2]) {
      const voterName = formatVoterName(vote.voter, nameMap);
      if (vote.reason?.trim()) {
        reason += `**${voterName}** | *"${vote.reason.trim()}"*\n\n`;
      } else {
        reason += `**${voterName}**\n\n`;
      }
    }

    reason += `**ABSTAIN ${Math.round(abstainScore)} VOTES**\n\n`;
    for (const vote of votesByChoice[3]) {
      const voterName = formatVoterName(vote.voter, nameMap);
      if (vote.reason?.trim()) {
        reason += `**${voterName}** | *"${vote.reason.trim()}"*\n\n`;
      } else {
        reason += `**${voterName}**\n\n`;
      }
    }

    return { choice, reason: reason.trim() };
  } catch (error) {
    console.error('Error formatting vote reason:', error);
    return null;
  }
}
