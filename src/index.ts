import cron from 'node-cron';
import { config, validateConfig } from './config';
import { fetchNewProposals, fetchProposalById } from './listeners/nounsProposals';
import { createSnapshotProposal, getExistingProposalTitles, getActiveSnapshotProposals, getClosedSnapshotProposals, getSnapshotResults, cancelSnapshotProposal } from './services/snapshot';
import { executeVoteThroughSafe, formatVoteReason, hasAlreadyVoted } from './services/safeVoting';
import { getWalletAddress } from './utils/wallet';
import { loadPostedProposals, appendPostedProposal, appendExecutedVote, loadExecutedVotes } from './services/stateStore';

// State tracking
const processedProposals = new Set<string>();
let lastCheckedTimestamp = Math.floor(Date.now() / 1000) - (config.lookbackDays * 24 * 60 * 60);
let existingSnapshotProposals = new Set<string>();
let persistedProposals = new Set<string>();

const pendingVotes = new Map<string, string>();
const submittedVotes = new Set<string>();
let isExecutingVotes = false;

async function checkForNewProposals(): Promise<void> {
  const newProposals = await fetchNewProposals(lastCheckedTimestamp);

  const toProcess = newProposals.filter(p =>
    parseInt(p.id) >= config.minProposalId &&
    !processedProposals.has(p.id) &&
    !existingSnapshotProposals.has(p.id) &&
    !persistedProposals.has(p.id)
  );

  if (toProcess.length === 0) return;

  console.log(`[${new Date().toISOString()}] Found ${toProcess.length} new proposal(s) to post`);

  for (const proposal of toProcess) {
    console.log(`Processing Nouns proposal #${proposal.id}: ${proposal.title}`);

    if (proposal.status === 'CANCELLED' || proposal.status === 'VETOED') {
      console.log(`  Skipping — proposal is ${proposal.status}`);
      processedProposals.add(proposal.id);
      continue;
    }

    try {
      const receipt = await createSnapshotProposal(proposal);
      processedProposals.add(proposal.id);

      const proposalTs = parseInt(proposal.createdTimestamp);
      if (proposalTs > lastCheckedTimestamp) {
        lastCheckedTimestamp = proposalTs;
      }

      if (config.dryRun) {
        console.log(`[DRY RUN] Previewed Snapshot proposal for Nouns #${proposal.id}; state was not changed`);
        continue;
      }

      appendPostedProposal(proposal.id);
      pendingVotes.set(receipt.id, proposal.id);
      console.log(`Created Snapshot proposal for Nouns #${proposal.id} (${receipt.id})`);
    } catch (error) {
      console.error(`Error processing proposal ${proposal.id}:`, error);
    }
  }
}

async function checkForClosedVotes(): Promise<void> {
  if (pendingVotes.size === 0) return;
  if (isExecutingVotes) return;
  isExecutingVotes = true;

  try {
    for (const [snapshotId, nounsId] of pendingVotes) {
      if (submittedVotes.has(snapshotId)) continue;

      try {
        if (parseInt(nounsId) < config.minProposalId) {
          pendingVotes.delete(snapshotId);
          continue;
        }

        if (await hasAlreadyVoted(nounsId)) {
          console.log(`[${new Date().toISOString()}] Safe already voted on Nouns #${nounsId}, skipping`);
          submittedVotes.add(snapshotId);
          pendingVotes.delete(snapshotId);
          continue;
        }

        const result = await getSnapshotResults(snapshotId);
        if (!result) continue;

        console.log(`[${new Date().toISOString()}] Snapshot vote closed for Nouns #${nounsId}: ${result}`);

        let voteData: { choice: 'FOR' | 'AGAINST' | 'ABSTAIN'; reason: string };

        if (result === 'NO_VOTES') {
          if (config.noVotesAction === 'skip') {
            console.log(`  No votes cast, skipping (NO_VOTES_ACTION=skip)`);
            submittedVotes.add(snapshotId);
            pendingVotes.delete(snapshotId);
            continue;
          }
          voteData = {
            choice: 'ABSTAIN',
            reason: '**FOR 0 VOTES**\n\n**AGAINST 0 VOTES**\n\n**ABSTAIN 0 VOTES**',
          };
        } else {
          const formatted = await formatVoteReason(snapshotId);
          if (!formatted) {
            console.error(`  Could not format vote reason for ${snapshotId}`);
            continue;
          }
          voteData = formatted;
        }

        if (config.dryRun) {
          console.log(`[DRY RUN] Would vote ${voteData.choice} on Nouns #${nounsId} through the Safe`);
          submittedVotes.add(snapshotId);
          pendingVotes.delete(snapshotId);
          continue;
        }

        const outcome = await executeVoteThroughSafe(nounsId, voteData.choice, voteData.reason);

        if (outcome.status === 'executed') {
          const execution = outcome.execution;
          appendExecutedVote({
            nounsProposalId: nounsId,
            snapshotId,
            choice: voteData.choice,
            safeTxHash: execution.safeTxHash,
            executionTxHash: execution.executionTxHash,
            blockNumber: execution.blockNumber,
            gasUsed: execution.gasUsed,
            executedAt: new Date().toISOString(),
          });
          submittedVotes.add(snapshotId);
          pendingVotes.delete(snapshotId);
        } else if (outcome.status === 'already-voted') {
          submittedVotes.add(snapshotId);
          pendingVotes.delete(snapshotId);
        } else if (outcome.status === 'failed' && !outcome.retryable) {
          console.error(`  Vote execution stopped and requires manual review: ${outcome.reason}`);
          pendingVotes.delete(snapshotId);
        } else {
          console.log(`  Vote deferred: ${outcome.reason} (will retry next cycle)`);
        }
      } catch (error) {
        console.error(`Error checking vote for ${snapshotId}:`, error);
      }
    }
  } finally {
    isExecutingVotes = false;
  }
}

async function checkForCancelledProposals(): Promise<void> {
  const activeProposals = await getActiveSnapshotProposals();

  for (const { snapshotId, nounsId, title } of activeProposals) {
    try {
      const onchainProposal = await fetchProposalById(nounsId);
      if (!onchainProposal) continue;

      if (onchainProposal.status === 'CANCELLED' || onchainProposal.status === 'VETOED') {
        console.log(`[${new Date().toISOString()}] Nouns #${nounsId} is ${onchainProposal.status}, cancelling Snapshot proposal "${title}"`);
        const success = await cancelSnapshotProposal(snapshotId);
        if (success) {
          pendingVotes.delete(snapshotId);
        }
      }
    } catch (error) {
      console.error(`Error checking cancellation for Nouns #${nounsId}:`, error);
    }
  }
}

function logStatus(): void {
  console.log(`[${new Date().toISOString()}] Status: ${processedProposals.size} processed, ${pendingVotes.size} pending, ${submittedVotes.size} submitted`);
}

async function main(): Promise<void> {
  console.log('Metagov Bot starting...\n');

  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  const walletAddress = await getWalletAddress();
  console.log(`Wallet:   ${walletAddress}`);
  console.log(`Safe:     ${config.safeAddress}`);
  console.log(`Space:    ${config.snapshotSpaceId}`);
  console.log(`Dry Run:  ${config.dryRun}`);
  console.log('');

  // Load persisted state
  persistedProposals = loadPostedProposals();
  console.log(`Loaded ${persistedProposals.size} proposals from local state`);

  existingSnapshotProposals = await getExistingProposalTitles();
  console.log(`Found ${existingSnapshotProposals.size} existing proposals on Snapshot`);

  if (existingSnapshotProposals.size === 0 && persistedProposals.size === 0) {
    console.warn('WARNING: No proposals found from Snapshot API or local state.');
    console.warn('If this is a fresh deployment, this is expected.');
  }

  const executedVotes = loadExecutedVotes();
  const executedSnapshotIds = new Set(executedVotes.map(v => v.snapshotId));
  console.log(`Loaded ${executedVotes.length} previously executed votes`);

  const activeProposals = await getActiveSnapshotProposals();
  for (const p of activeProposals) {
    if (!executedSnapshotIds.has(p.snapshotId)) {
      pendingVotes.set(p.snapshotId, p.nounsId);
    }
  }

  const closedProposals = await getClosedSnapshotProposals();
  let recoveredCount = 0;
  for (const p of closedProposals) {
    if (parseInt(p.nounsId) < config.minProposalId) continue;
    if (!executedSnapshotIds.has(p.snapshotId) && !pendingVotes.has(p.snapshotId)) {
      pendingVotes.set(p.snapshotId, p.nounsId);
      recoveredCount++;
    }
  }
  if (recoveredCount > 0) {
    console.log(`Recovered ${recoveredCount} closed-but-unexecuted proposal(s)`);
  }

  for (const snapshotId of executedSnapshotIds) {
    submittedVotes.add(snapshotId);
  }

  console.log(`Tracking ${pendingVotes.size} proposals for vote submission\n`);

  // Initial checks
  await checkForNewProposals();
  await checkForClosedVotes();
  await checkForCancelledProposals();
  logStatus();

  // Poll for new proposals
  cron.schedule(`*/${config.proposalPollMinutes} * * * *`, async () => {
    try {
      await checkForNewProposals();
    } catch (error) {
      console.error('Error in proposal check:', error);
    }
  });

  // Check closed votes and cancellations
  cron.schedule(`*/${config.votePollMinutes} * * * *`, async () => {
    try {
      await checkForClosedVotes();
    } catch (error) {
      console.error('Error checking closed votes:', error);
    }
    try {
      await checkForCancelledProposals();
    } catch (error) {
      console.error('Error checking cancelled proposals:', error);
    }
    logStatus();
  });

  console.log('Bot running. Listening for new Nouns proposals...\n');
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  logStatus();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  logStatus();
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
