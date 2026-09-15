import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { config, validateConfig } from '../config';
import { fetchNewProposals } from '../listeners/nounsProposals';
import { getSnapshotSpaceVotingSettings } from '../services/snapshot';
import { getProvider, getWallet } from '../utils/wallet';

interface CheckResult {
  name: string;
  detail: string;
}

async function check(name: string, operation: () => Promise<string> | string): Promise<CheckResult> {
  const detail = await operation();
  console.log(`✓ ${name}: ${detail}`);
  return { name, detail };
}

async function main(): Promise<void> {
  console.log('Metagov deployment doctor\n');

  validateConfig();
  console.log('✓ Configuration: valid');
  if (config.profileSource) console.log(`✓ Profile: ${config.organizationName} (${config.profileSource})`);

  const provider = getProvider();
  const wallet = getWallet();

  await check('Ethereum RPC', async () => {
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(config.chainId)) {
      throw new Error(`expected chain ${config.chainId}, received ${network.chainId}`);
    }
    return `connected to chain ${network.chainId}`;
  });

  await check('Bot wallet', async () => {
    const balance = await provider.getBalance(wallet.address);
    return `${wallet.address} (${ethers.formatEther(balance)} ETH)`;
  });

  await check('Safe', async () => {
    const code = await provider.getCode(config.safeAddress);
    if (code === '0x') throw new Error('address has no deployed contract');

    const safe = new ethers.Contract(
      config.safeAddress,
      [
        'function getOwners() view returns (address[])',
        'function getThreshold() view returns (uint256)',
      ],
      provider,
    );
    const [owners, threshold] = await Promise.all([
      safe.getOwners() as Promise<string[]>,
      safe.getThreshold() as Promise<bigint>,
    ]);
    const isOwner = owners.some(owner => owner.toLowerCase() === wallet.address.toLowerCase());
    if (!isOwner) throw new Error(`bot wallet ${wallet.address} is not an owner`);
    if (threshold !== 1n) throw new Error(`threshold is ${threshold}; automated execution requires 1`);
    return `${owners.length} owner(s), threshold 1, bot is an owner`;
  });

  await check('Nouns indexer', async () => {
    const since = Math.floor(Date.now() / 1000) - 60 * 60;
    const proposals = await fetchNewProposals(since);
    if (proposals === null) throw new Error('query failed');
    return `query succeeded (${proposals.length} recent proposal(s))`;
  });

  await check('Snapshot space', async () => {
    const voting = await getSnapshotSpaceVotingSettings();
    return `delay ${voting.delay}s, period ${voting.period}s`;
  });

  await check('State directory', () => {
    const stateDir = path.resolve(process.cwd(), config.dataDir);
    fs.mkdirSync(stateDir, { recursive: true });
    const probe = path.join(stateDir, `.metagov-write-check-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return `${stateDir} is writable`;
  });

  console.log('\nAll checks passed. This deployment is ready to run.');
}

main().catch((error) => {
  console.error(`\n✗ Doctor failed: ${error.message || error}`);
  process.exitCode = 1;
});
