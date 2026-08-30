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
  teamName: string;
  labels: string[];
  assigneeId?: string;
  assigneeName?: string;
};

export type LinearIssueKind = 'feature' | 'improvement' | 'bug';

export type LinearIssueCreateResult = {
  issue: LinearIssue;
  created: boolean;
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
  team { key name }
  labels { nodes { name } }
  assignee { id name }
`;

type RawIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number | null;
  state: { name: string; type: string } | null;
  team: { key: string; name: string } | null;
  labels: { nodes: { name: string }[] } | null;
  assignee: { id: string; name: string } | null;
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
    teamName: issue.team?.name ?? '',
    labels: issue.labels?.nodes.map((label) => label.name) ?? [],
    assigneeId: issue.assignee?.id,
    assigneeName: issue.assignee?.name,
  };
}

function configuredTeamKey(teamKey?: string): string {
  const key = teamKey?.trim() || env('LINEAR_TEAM_KEY').trim();
  if (!key) throw new Error('LINEAR_TEAM_KEY is not set');
  return key;
}

async function teamContext(teamKey?: string): Promise<{
  id: string;
  key: string;
  name: string;
  labels: { id: string; name: string }[];
}> {
  const key = configuredTeamKey(teamKey);
  const data = await query<{
    teams: { nodes: { id: string; key: string; name: string; labels: { nodes: { id: string; name: string }[] } }[] };
  }>(
    `query Team($key: String!) {
      teams(filter: { key: { eq: $key } }, first: 5) {
        nodes { id key name labels(first: 100) { nodes { id name } } }
      }
    }`,
    { key },
  );
  const team = data.teams.nodes.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (!team) throw new Error(`Linear team ${key} was not found or is not accessible`);
  return { ...team, labels: team.labels.nodes };
}

/** Unstarted, unarchived issues — the pool the office can pick work from. */
export async function fetchOpenIssues(teamKey?: string, limit = 25, includeStarted = true): Promise<LinearIssue[]> {
  const filter: Record<string, unknown> = {
    state: { type: { in: includeStarted ? ['backlog', 'unstarted', 'started'] : ['backlog', 'unstarted'] } },
  };
  const resolvedTeamKey = teamKey?.trim() || env('LINEAR_TEAM_KEY').trim();
  if (resolvedTeamKey) filter.team = { key: { eq: resolvedTeamKey } };

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

/** Creates a real Linear issue, reusing an open exact-title match to avoid duplicates. */
export async function createLinearIssue(input: {
  title: string;
  description: string;
  kind: LinearIssueKind;
  teamKey?: string;
  priority?: number;
  createdByAgent: 'PRIYA' | 'TESS';
}): Promise<LinearIssueCreateResult> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new Error('A Linear issue needs a title');
  if (!description) throw new Error('A Linear issue needs a description');

  const team = await teamContext(input.teamKey);
  const existing = (await fetchOpenIssues(team.key, 50)).find(
    (issue) => issue.title.trim().toLowerCase() === title.toLowerCase(),
  );
  if (existing) return { issue: existing, created: false };

  const desiredLabel = input.kind === 'bug' ? 'Bug' : input.kind === 'feature' ? 'Feature' : 'Improvement';
  const label = team.labels.find((entry) => entry.name.toLowerCase() === desiredLabel.toLowerCase());
  const agentRole = input.createdByAgent === 'TESS' ? 'QA Engineer' : 'Product Owner';
  const body = [
    description,
    '',
    '---',
    `Created by **${input.createdByAgent} · ${agentRole}** via My Little Office.`,
  ].join('\n');
  const mutationInput: Record<string, unknown> = {
    title,
    description: body,
    teamId: team.id,
    priority: input.priority ?? (input.kind === 'bug' ? 2 : 3),
  };
  if (label) mutationInput.labelIds = [label.id];

  const data = await query<{ issueCreate: { success: boolean; issue: RawIssue | null } }>(
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
    }`,
    { input: mutationInput },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error('Linear did not create the issue');
  }
  return { issue: normalize(data.issueCreate.issue), created: true };
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
