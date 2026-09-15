import fs from 'fs';
import path from 'path';

export interface OrganizationProfile {
  name?: string;
  safeAddress?: string;
  snapshotSpaceId?: string;
  clientId?: number;
  proposalLinkTemplate?: string;
  noVotesAction?: 'abstain' | 'skip';
}

const ALLOWED_KEYS = new Set<keyof OrganizationProfile>([
  'name',
  'safeAddress',
  'snapshotSpaceId',
  'clientId',
  'proposalLinkTemplate',
  'noVotesAction',
]);

export function loadOrganizationProfile(): {
  profile: OrganizationProfile;
  source?: string;
} {
  const selection = process.env.METAGOV_PROFILE;
  if (!selection) return { profile: {} };

  const profilePath = selection.endsWith('.json') || selection.includes(path.sep)
    ? path.resolve(process.cwd(), selection)
    : path.resolve(process.cwd(), 'profiles', `${selection}.json`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (error: any) {
    throw new Error(`Could not load METAGOV_PROFILE from ${profilePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Metagov profile ${profilePath} must contain a JSON object`);
  }

  const unknownKeys = Object.keys(parsed).filter(
    key => !ALLOWED_KEYS.has(key as keyof OrganizationProfile),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown key(s) in Metagov profile: ${unknownKeys.join(', ')}`);
  }

  const candidate = parsed as Record<string, unknown>;
  for (const key of ['name', 'safeAddress', 'snapshotSpaceId', 'proposalLinkTemplate'] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
      throw new Error(`Metagov profile field ${key} must be a string`);
    }
  }
  if (candidate.clientId !== undefined && !Number.isSafeInteger(candidate.clientId)) {
    throw new Error('Metagov profile field clientId must be an integer');
  }
  if (
    candidate.noVotesAction !== undefined &&
    candidate.noVotesAction !== 'abstain' &&
    candidate.noVotesAction !== 'skip'
  ) {
    throw new Error('Metagov profile field noVotesAction must be "abstain" or "skip"');
  }

  return { profile: candidate as OrganizationProfile, source: profilePath };
}
