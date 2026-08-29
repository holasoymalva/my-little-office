import { env } from '../env.ts';

const ENDPOINT = 'https://api.linear.app/graphql';

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  stateName: string;
  stateType: string;
  priority: number;
  teamKey: string;
  labels: string[];
};

export function linearConfigured(): boolean {
  return Boolean(env('LINEAR_API_KEY'));
}

async function query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = env('LINEAR_API_KEY');
  if (!key) throw new Error('LINEAR_API_KEY is not set');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: key },
    body: JSON.stringify({ query: document, variables }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Linear API ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) {
    throw new Error(`Linear API: ${payload.errors.map((error) => error.message).join('; ')}`);
  }
  return payload.data as T;
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  state { name type }
  team { key }
  labels { nodes { name } }
`;

type RawIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number | null;
  state: { name: string; type: string } | null;
  team: { key: string } | null;
  labels: { nodes: { name: string }[] } | null;
};

function normalize(issue: RawIssue): LinearIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    url: issue.url,
    priority: issue.priority ?? 0,
    stateName: issue.state?.name ?? 'Unknown',
    stateType: issue.state?.type ?? 'unknown',
    teamKey: issue.team?.key ?? '',
    labels: issue.labels?.nodes.map((label) => label.name) ?? [],
  };
}

/** Unstarted, unarchived issues — the pool the office can pick work from. */
export async function fetchOpenIssues(teamKey?: string, limit = 25): Promise<LinearIssue[]> {
  const filter: Record<string, unknown> = {
    state: { type: { in: ['backlog', 'unstarted', 'started'] } },
  };
  if (teamKey) filter.team = { key: { eq: teamKey } };

  const data = await query<{ issues: { nodes: RawIssue[] } }>(
    `query Issues($filter: IssueFilter, $first: Int!) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }`,
    { filter, first: limit },
  );

  return data.issues.nodes.map(normalize);
}

export async function fetchIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
  const [teamKey, rawNumber] = identifier.split('-');
  const number = Number(rawNumber);
  if (!teamKey || !Number.isFinite(number)) return null;

  const data = await query<{ issues: { nodes: RawIssue[] } }>(
    `query Issue($number: Float!, $teamKey: String!) {
      issues(filter: { number: { eq: $number }, team: { key: { eq: $teamKey } } }, first: 5) {
        nodes { ${ISSUE_FIELDS} }
      }
    }`,
    { number, teamKey },
  );

  const match = data.issues.nodes.find((issue) => issue.identifier === identifier);
  return match ? normalize(match) : null;
}

export async function commentOnIssue(issueId: string, body: string): Promise<void> {
  await query(
    `mutation Comment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } },
  );
}

/** Moves an issue to the first workflow state matching `stateName` on its team. */
export async function moveIssueToState(
  issueId: string,
  teamKey: string,
  stateName: string,
): Promise<boolean> {
  const data = await query<{ workflowStates: { nodes: { id: string; name: string }[] } }>(
    `query States($teamKey: String!) {
      workflowStates(filter: { team: { key: { eq: $teamKey } } }, first: 50) {
        nodes { id name }
      }
    }`,
    { teamKey },
  );

  const state = data.workflowStates.nodes.find(
    (node) => node.name.toLowerCase() === stateName.toLowerCase(),
  );
  if (!state) return false;

  await query(
    `mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issueId, input: { stateId: state.id } },
  );
  return true;
}
