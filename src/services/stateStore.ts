import fs from 'fs';
import path from 'path';
import { config } from '../config';

const STATE_DIR = path.resolve(process.cwd(), config.dataDir);
const STATE_FILE = path.join(STATE_DIR, 'posted-proposals.json');

interface StateData {
  postedProposalIds: string[];
}

export interface ExecutedVote {
  nounsProposalId: string;
  snapshotId: string;
  choice: 'FOR' | 'AGAINST' | 'ABSTAIN';
  safeTxHash: string;
  executionTxHash: string;
  blockNumber: number;
  gasUsed: string;
  executedAt: string;
}

function ensureDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function loadPostedProposals(): Set<string> {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return new Set();
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const data: StateData = JSON.parse(raw);
    return new Set(data.postedProposalIds || []);
  } catch (error) {
    console.error('Error reading state file:', error);
    return new Set();
  }
}

export function savePostedProposals(ids: Set<string>): void {
  ensureDir();
  const data: StateData = {
    postedProposalIds: Array.from(ids),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

export function appendPostedProposal(id: string): void {
  const existing = loadPostedProposals();
  existing.add(id);
  savePostedProposals(existing);
}

const EXECUTED_VOTES_FILE = path.join(STATE_DIR, 'executed-votes.json');

export function loadExecutedVotes(): ExecutedVote[] {
  try {
    if (!fs.existsSync(EXECUTED_VOTES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(EXECUTED_VOTES_FILE, 'utf-8');
    return JSON.parse(raw) as ExecutedVote[];
  } catch (error) {
    console.error('Error reading executed votes file:', error);
    return [];
  }
}

export function appendExecutedVote(vote: ExecutedVote): void {
  ensureDir();
  const existing = loadExecutedVotes();
  existing.push(vote);
  fs.writeFileSync(EXECUTED_VOTES_FILE, JSON.stringify(existing, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
