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

function writeJsonAtomically(filePath: string, value: unknown): void {
  ensureDir();
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(
    value,
    (_, item) => typeof item === 'bigint' ? item.toString() : item,
    2,
  );

  try {
    fs.writeFileSync(temporaryPath, json);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function isStateData(value: unknown): value is StateData {
  if (!value || typeof value !== 'object') return false;
  const ids = (value as StateData).postedProposalIds;
  return Array.isArray(ids) && ids.every(id => typeof id === 'string');
}

function isExecutedVote(value: unknown): value is ExecutedVote {
  if (!value || typeof value !== 'object') return false;
  const vote = value as ExecutedVote;
  return (
    typeof vote.nounsProposalId === 'string' &&
    typeof vote.snapshotId === 'string' &&
    ['FOR', 'AGAINST', 'ABSTAIN'].includes(vote.choice) &&
    typeof vote.safeTxHash === 'string' &&
    typeof vote.executionTxHash === 'string' &&
    Number.isSafeInteger(vote.blockNumber) &&
    typeof vote.gasUsed === 'string' &&
    typeof vote.executedAt === 'string'
  );
}

export function loadPostedProposals(): Set<string> {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return new Set();
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (!isStateData(data)) {
      throw new Error('posted-proposals.json has an invalid structure');
    }
    return new Set(data.postedProposalIds);
  } catch (error) {
    console.error('Error reading state file:', error);
    throw error;
  }
}

export function savePostedProposals(ids: Set<string>): void {
  const data: StateData = {
    postedProposalIds: Array.from(ids),
  };
  writeJsonAtomically(STATE_FILE, data);
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
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every(isExecutedVote)) {
      throw new Error('executed-votes.json has an invalid structure');
    }
    return data;
  } catch (error) {
    console.error('Error reading executed votes file:', error);
    throw error;
  }
}

export function appendExecutedVote(vote: ExecutedVote): void {
  const existing = loadExecutedVotes();
  existing.push(vote);
  writeJsonAtomically(EXECUTED_VOTES_FILE, existing);
}
