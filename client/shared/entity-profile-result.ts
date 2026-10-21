export type EntityProfileResult<Profile> = {
  profile: Profile | null;
  revision: number;
  cachedRevision: number | null;
};

// A detail lookup must not restore data removed or superseded by live sync.
export function selectEntityProfile<Profile>(
  cached: Profile | null,
  cachedRevision: number | null,
  result: EntityProfileResult<Profile> | null,
): Profile | null {
  if (
    !result ||
    (cachedRevision === null && result.cachedRevision !== null) ||
    result.revision < (cachedRevision ?? 0)
  )
    return cached;
  return result.profile;
}
