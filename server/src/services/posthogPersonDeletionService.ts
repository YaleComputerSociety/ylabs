import { normalizeProductAnalyticsId } from './productAnalyticsIdentityService';

export const POSTHOG_PRIVATE_API_ORIGIN = 'https://us.posthog.com';
export const POSTHOG_PERSON_DELETION_TIMEOUT_MS = 10_000;

const POSTHOG_PERSONAL_API_KEY = /^phx_[A-Za-z0-9_-]{20,128}$/;
const POSTHOG_PROJECT_ID = /^[0-9]{1,12}$/;

export type PostHogPersonDeletionOutcome =
  'requested' | 'skipped_not_configured' | 'skipped_no_analytics_id';

export class PostHogPersonDeletionError extends Error {
  constructor(readonly status: number | null) {
    super(
      status === null
        ? 'PostHog person deletion did not complete'
        : `PostHog person deletion answered ${status}`,
    );
    this.name = 'PostHogPersonDeletionError';
  }
}

interface PostHogDeletionConfig {
  apiKey: string;
  projectId: string;
}

const trimmed = (value: string | undefined) => String(value || '').trim();

export const isPostHogPersonalApiKey = (value: string | undefined): boolean =>
  POSTHOG_PERSONAL_API_KEY.test(trimmed(value));

export const isPostHogProjectId = (value: string | undefined): boolean =>
  POSTHOG_PROJECT_ID.test(trimmed(value));

export const postHogPersonDeletionConfig = (
  env: NodeJS.ProcessEnv = process.env,
): PostHogDeletionConfig | null => {
  if (!isPostHogPersonalApiKey(env.POSTHOG_PERSONAL_API_KEY)) return null;
  if (!isPostHogProjectId(env.POSTHOG_PROJECT_ID)) return null;
  return {
    apiKey: trimmed(env.POSTHOG_PERSONAL_API_KEY),
    projectId: trimmed(env.POSTHOG_PROJECT_ID),
  };
};

export const postHogPersonBulkDeleteUrl = (projectId: string): string =>
  `${POSTHOG_PRIVATE_API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/persons/bulk_delete/`;

/**
 * Asks PostHog to delete the person known by this random id, with their events and
 * recordings. PostHog queues the work and answers 202, so success means accepted, not
 * finished. The browser identifies a signed-in student only by `productAnalyticsId`
 * (#5538), so that id is the only key PostHog holds for them.
 */
export const deletePostHogPerson = async (
  productAnalyticsId: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PostHogPersonDeletionOutcome> => {
  const config = postHogPersonDeletionConfig(env);
  if (!config) return 'skipped_not_configured';
  const distinctId = normalizeProductAnalyticsId(productAnalyticsId);
  if (!distinctId) return 'skipped_no_analytics_id';

  let response: Response;
  try {
    response = await fetch(postHogPersonBulkDeleteUrl(config.projectId), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(POSTHOG_PERSON_DELETION_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        distinct_ids: [distinctId],
        delete_events: true,
        delete_recordings: true,
      }),
    });
  } catch {
    throw new PostHogPersonDeletionError(null);
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 200 && response.status !== 202) {
    throw new PostHogPersonDeletionError(response.status);
  }
  return 'requested';
};
