import snapshot from '@snapshot-labs/snapshot.js';
import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client/core';
import fetch from 'cross-fetch';
import { Wallet } from '@ethersproject/wallet';
import { config } from '../config';
import { getBlockNumber } from '../utils/wallet';
import { NounsProposal } from '../listeners/nounsProposals';

const hub = config.snapshotHub;
const client = new snapshot.Client712(hub);

function getSnapshotWallet(): Wallet {
  return new Wallet(config.botPrivateKey);
}

const graphqlClient = new ApolloClient({
  link: new HttpLink({ uri: config.snapshotGraphql, fetch }),
  cache: new InMemoryCache(),
});

export interface SnapshotProposalReceipt {
  id: string;
  ipfs: string;
}

export type VoteResult = 'FOR' | 'AGAINST' | 'ABSTAIN' | 'NO_VOTES' | null;

const GET_SPACE_VOTING_SETTINGS = gql`
  query SpaceVotingSettings($id: String!) {
    space(id: $id) {
      voting {
        delay
        period
      }
    }
  }
`;

export async function getSnapshotSpaceVotingSettings(): Promise<{ delay: number; period: number }> {
  const { data } = await graphqlClient.query<any>({
    query: GET_SPACE_VOTING_SETTINGS,
    variables: { id: config.snapshotSpaceId },
    fetchPolicy: 'network-only',
  });

  const spaceVoting = data.space?.voting;
  const delay = spaceVoting?.delay;
  const period = spaceVoting?.period;

  if (!Number.isSafeInteger(delay) || delay < 0) {
    throw new Error(`Snapshot space ${config.snapshotSpaceId} has no valid voting delay`);
  }

  if (!Number.isSafeInteger(period) || period <= 0) {
    throw new Error(`Snapshot space ${config.snapshotSpaceId} has no valid voting period`);
  }

  return { delay, period };
}

async function getProposalTiming(): Promise<{ delay: number; period: number }> {
  const spaceVoting = await getSnapshotSpaceVotingSettings();
  const delay = config.snapshotVotingDelaySeconds ?? spaceVoting?.delay;
  const period = config.votingDurationDays !== undefined
    ? config.votingDurationDays * 24 * 60 * 60
    : spaceVoting?.period;

  if (!Number.isSafeInteger(delay) || delay < 0) {
    throw new Error(
      `Snapshot space ${config.snapshotSpaceId} has no valid voting delay; ` +
      'configure it in Snapshot or set SNAPSHOT_VOTING_DELAY_SECONDS'
    );
  }

  if (!Number.isSafeInteger(period) || period <= 0) {
    throw new Error(
      `Snapshot space ${config.snapshotSpaceId} has no valid voting period; ` +
      'configure it in Snapshot or set VOTING_DURATION_DAYS'
    );
  }

  return { delay, period };
}

export async function createSnapshotProposal(
  nounsProposal: NounsProposal
): Promise<SnapshotProposalReceipt> {
  const wallet = getSnapshotWallet();
  const [blockNumber, timing] = await Promise.all([
    getBlockNumber(),
    getProposalTiming(),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const start = now + timing.delay;

  const proposalData = {
    space: config.snapshotSpaceId,
    type: 'single-choice' as const,
    title: `${nounsProposal.id}: ${nounsProposal.title}`,
    body: formatProposalBody(nounsProposal),
    choices: ['For', 'Against', 'Abstain'],
    start,
    end: start + timing.period,
    snapshot: blockNumber,
    plugins: JSON.stringify({}),
    discussion: config.proposalLinkTemplate.replace('{id}', nounsProposal.id),
  };

  if (config.dryRun) {
    console.log('\n--- SNAPSHOT PROPOSAL PREVIEW ---');
    console.log(`Title: ${proposalData.title}`);
    console.log(`Body: ${proposalData.body}`);
    console.log(`Choices: ${proposalData.choices.join(' / ')}`);
    console.log(`Duration: ${timing.period / 86400} days`);
    console.log(`Voting delay: ${timing.delay / 3600} hours`);
    console.log(`Space: ${proposalData.space}`);
    console.log('--- END PREVIEW ---\n');
    return { id: `dry-run-${nounsProposal.id}`, ipfs: '' };
  }

  const receipt = await client.proposal(wallet, wallet.address, proposalData);

  console.log(`Created Snapshot proposal for Nouns #${nounsProposal.id}:`, receipt);
  return receipt as SnapshotProposalReceipt;
}

function formatProposalBody(proposal: NounsProposal): string {
  const link = config.proposalLinkTemplate.replace('{id}', proposal.id);
  return `**View proposal:** ${link}`;
}

const GET_PROPOSAL = gql`
  query Proposal($id: String!) {
    proposal(id: $id) {
      id
      state
      scores
      scores_total
      choices
      end
    }
  }
`;

const GET_SPACE_PROPOSALS = gql`
  query SpaceProposals($space: String!) {
    proposals(where: { space: $space }, first: 100, orderBy: "created", orderDirection: desc) {
      id
      title
    }
  }
`;

const GET_ACTIVE_PROPOSALS = gql`
  query ActiveProposals($space: String!) {
    proposals(where: { space: $space, state: "active" }, first: 50, orderBy: "end", orderDirection: asc) {
      id
      title
      state
      end
    }
  }
`;

export interface ActiveSnapshotProposal {
  snapshotId: string;
  nounsId: string;
  title: string;
  endsAt: number;
}

export async function getActiveSnapshotProposals(): Promise<ActiveSnapshotProposal[]> {
  try {
    const { data } = await graphqlClient.query<any>({
      query: GET_ACTIVE_PROPOSALS,
      variables: { space: config.snapshotSpaceId },
      fetchPolicy: 'network-only',
    });

    const activeProposals: ActiveSnapshotProposal[] = [];
    for (const proposal of data.proposals || []) {
      const match = proposal.title.match(/^(\d+):/);
      if (match) {
        activeProposals.push({
          snapshotId: proposal.id,
          nounsId: match[1],
          title: proposal.title,
          endsAt: proposal.end,
        });
      }
    }
    return activeProposals;
  } catch (error) {
    console.error('Error fetching active Snapshot proposals:', error);
    return [];
  }
}

const GET_CLOSED_PROPOSALS = gql`
  query ClosedProposals($space: String!) {
    proposals(where: { space: $space, state: "closed" }, first: 20, orderBy: "end", orderDirection: desc) {
      id
      title
      state
      end
    }
  }
`;

export async function getClosedSnapshotProposals(): Promise<ActiveSnapshotProposal[]> {
  try {
    const { data } = await graphqlClient.query<any>({
      query: GET_CLOSED_PROPOSALS,
      variables: { space: config.snapshotSpaceId },
      fetchPolicy: 'network-only',
    });

    const closedProposals: ActiveSnapshotProposal[] = [];
    for (const proposal of data.proposals || []) {
      const match = proposal.title.match(/^(\d+):/);
      if (match) {
        closedProposals.push({
          snapshotId: proposal.id,
          nounsId: match[1],
          title: proposal.title,
          endsAt: proposal.end,
        });
      }
    }
    return closedProposals;
  } catch (error) {
    console.error('Error fetching closed Snapshot proposals:', error);
    return [];
  }
}

export async function getExistingProposalTitles(): Promise<Set<string>> {
  try {
    const { data } = await graphqlClient.query<any>({
      query: GET_SPACE_PROPOSALS,
      variables: { space: config.snapshotSpaceId },
      fetchPolicy: 'network-only',
    });

    const titles = new Set<string>();
    for (const proposal of data.proposals || []) {
      const match = proposal.title.match(/^(\d+):/);
      if (match) {
        titles.add(match[1]);
      }
    }
    return titles;
  } catch (error) {
    console.error('Error fetching existing Snapshot proposals:', error);
    return new Set();
  }
}

export async function getSnapshotResults(proposalId: string): Promise<VoteResult> {
  try {
    const { data } = await graphqlClient.query<any>({
      query: GET_PROPOSAL,
      variables: { id: proposalId },
      fetchPolicy: 'network-only',
    });

    const proposal = data.proposal;
    if (!proposal) {
      console.error(`Snapshot proposal ${proposalId} not found`);
      return null;
    }

    if (proposal.state !== 'closed') {
      return null;
    }

    const [forVotes, againstVotes, abstainVotes] = proposal.scores as number[];
    const maxVotes = Math.max(forVotes, againstVotes, abstainVotes);

    if (maxVotes === 0) {
      console.log(`No votes cast on Snapshot proposal ${proposalId}`);
      return 'NO_VOTES';
    }

    if (maxVotes === forVotes) return 'FOR';
    if (maxVotes === againstVotes) return 'AGAINST';
    return 'ABSTAIN';
  } catch (error) {
    console.error('Error fetching Snapshot results:', error);
    return null;
  }
}

export async function cancelSnapshotProposal(snapshotProposalId: string): Promise<boolean> {
  try {
    const wallet = getSnapshotWallet();

    if (config.dryRun) {
      console.log(`[DRY RUN] Would cancel Snapshot proposal ${snapshotProposalId}`);
      return true;
    }

    await client.cancelProposal(wallet, wallet.address, {
      space: config.snapshotSpaceId,
      proposal: snapshotProposalId,
    });

    console.log(`Cancelled Snapshot proposal ${snapshotProposalId}`);
    return true;
  } catch (error) {
    console.error(`Error cancelling Snapshot proposal ${snapshotProposalId}:`, error);
    return false;
  }
}
