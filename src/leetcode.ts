import { config } from "./config";

const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";

interface RecentSubmission {
  id: string;
  title: string;
  titleSlug: string;
  timestamp: string; // unix seconds, as a string
}

interface RecentAcSubmissionResponse {
  data?: {
    recentAcSubmissionList: RecentSubmission[] | null;
  };
  errors?: Array<{ message: string }>;
}

const QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
    }
  }
`;

/**
 * Returns the accepted submissions from LeetCode's public recent-AC feed.
 * This endpoint only returns the most recent ~20 accepted submissions total
 * (not per day), so a high limit is used and we filter by date ourselves.
 */
async function fetchRecentAcSubmissions(username: string): Promise<RecentSubmission[]> {
  const res = await fetch(LEETCODE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // LeetCode's GraphQL endpoint is picky about having a referer/origin
      // that looks like a browser request from leetcode.com.
      Referer: `https://leetcode.com/${username}/`,
      Origin: "https://leetcode.com",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { username, limit: 20 },
    }),
  });

  if (!res.ok) {
    throw new Error(`LeetCode API request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as RecentAcSubmissionResponse;

  if (json.errors?.length) {
    throw new Error(`LeetCode API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  return json.data?.recentAcSubmissionList ?? [];
}

/** Returns the current date as YYYY-MM-DD in the configured timezone. */
export function todayInTimezone(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.timezone });
}

function timestampDateInTimezone(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-CA", {
    timeZone: config.timezone,
  });
}

/**
 * Checks whether the given LeetCode user has at least one accepted
 * submission today (in the configured timezone).
 */
export async function hasSolvedToday(username: string): Promise<boolean> {
  const submissions = await fetchRecentAcSubmissions(username);
  const today = todayInTimezone();

  return submissions.some((s) => timestampDateInTimezone(Number(s.timestamp)) === today);
}
