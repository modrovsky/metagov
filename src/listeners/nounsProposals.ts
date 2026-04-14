import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client/core';
import fetch from 'cross-fetch';
import { config } from '../config';

export interface NounsProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  startBlock: string;
  endBlock: string;
  createdTimestamp: string;
  status: string;
}

const client = new ApolloClient({
  link: new HttpLink({ uri: config.nounsGraphqlEndpoint, fetch }),
  cache: new InMemoryCache(),
});

// Goldsky / The Graph subgraph format
const GET_RECENT_PROPOSALS = gql`
  query GetRecentProposals($since: BigInt!) {
    proposals(
      where: { createdTimestamp_gt: $since }
      orderBy: createdTimestamp
      orderDirection: asc
    ) {
      id
      title
      description
      proposer { id }
      startBlock
      endBlock
      createdTimestamp
      status
    }
  }
`;

const GET_PROPOSAL_BY_ID = gql`
  query GetProposal($id: ID!) {
    proposal(id: $id) {
      id
      title
      description
      proposer { id }
      startBlock
      endBlock
      createdTimestamp
      status
    }
  }
`;

function normalizeProposal(raw: any): NounsProposal {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    proposer: typeof raw.proposer === 'string' ? raw.proposer : raw.proposer?.id ?? '',
    startBlock: raw.startBlock,
    endBlock: raw.endBlock,
    createdTimestamp: raw.createdTimestamp,
    status: raw.status,
  };
}

export async function fetchNewProposals(sinceTimestamp: number): Promise<NounsProposal[]> {
  try {
    const { data } = await client.query<any>({
      query: GET_RECENT_PROPOSALS,
      variables: { since: sinceTimestamp.toString() },
      fetchPolicy: 'network-only',
    });

    const raw = data.proposals?.items || data.proposals || [];
    return raw.map(normalizeProposal);
  } catch (error) {
    console.error('Error fetching proposals:', error);
    return [];
  }
}

export async function fetchProposalById(id: string): Promise<NounsProposal | null> {
  try {
    const { data } = await client.query<any>({
      query: GET_PROPOSAL_BY_ID,
      variables: { id },
      fetchPolicy: 'network-only',
    });

    return data.proposal ? normalizeProposal(data.proposal) : null;
  } catch (error) {
    console.error('Error fetching proposal:', error);
    return null;
  }
}
