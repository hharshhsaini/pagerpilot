export type RollbackRecovery = {
  sandboxId: string;
  preP99Ms: number;
  preErrors: number;
  postP99Ms: number;
  postErrors: number;
  revertSha: string;
  remoteSha: string;
  testsPassed: boolean;
  sandboxStopped: boolean;
  githubUrl: string;
  linearUrl?: string;
  linearIdentifier?: string;
  slackPermalink?: string;
};

export type RollbackOutcome =
  | { status: 'pending' }
  | { status: 'failed'; message: string }
  | { status: 'verified'; recovery: RollbackRecovery };

type SessionEvent = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** Maps each tool call ID to the MCP server and tool it invoked. */
function toolCalls(
  events: SessionEvent[],
): Map<string, { server?: string; tool: string }> {
  const calls = new Map<string, { server?: string; tool: string }>();
  for (const event of events) {
    if (!Array.isArray(event.tool_calls)) continue;
    for (const raw of event.tool_calls) {
      const call = record(raw);
      const id = text(call?.id);
      const fn = record(call?.function);
      const name = text(fn?.name);
      if (!id || !name) continue;
      const args = parseJson(fn?.arguments);
      const server = text(args?.mcp_server);
      calls.set(id, {
        tool: text(args?.tool_name) ?? name,
        ...(server ? { server } : {}),
      });
    }
  }
  return calls;
}

function evidence(
  value: unknown,
): { p99Ms: number; errors: number } | undefined {
  const payload = record(value);
  return typeof payload?.p99_ms === 'number' &&
    typeof payload.errors === 'number'
    ? { p99Ms: payload.p99_ms, errors: payload.errors }
    : undefined;
}

function commitUrl(repositoryUrl: string, sha: string): string {
  return `${repositoryUrl.replace(/\.git$/, '')}/commit/${sha}`;
}

/**
 * Derives the rollback outcome from the authoritative session events: the
 * rollback_execute tool response, plus the Slack and Linear closeout responses
 * that follow it. Nothing is inferred when the tool has not responded.
 */
export function rollbackOutcome(events: SessionEvent[]): RollbackOutcome {
  const calls = toolCalls(events);
  const ordered = [...events].sort((left, right) =>
    (text(left.created_at) ?? '').localeCompare(text(right.created_at) ?? ''),
  );
  let recovery: RollbackRecovery | undefined;
  let linearUrl: string | undefined;
  let linearIdentifier: string | undefined;
  let slackPermalink: string | undefined;
  for (const event of ordered) {
    if (event.type !== 'tool.response') continue;
    const call = calls.get(text(event.tool_call_id) ?? '');
    if (!call) continue;
    const payload = parseJson(event.content);
    if (call.tool === 'rollback_execute') {
      const pre = evidence(payload?.pre_evidence);
      const post = evidence(payload?.post_evidence);
      const revertSha = text(payload?.revert_sha);
      const remoteSha = text(payload?.remote_sha);
      const repositoryUrl = text(payload?.repository_url);
      if (
        !payload ||
        !pre ||
        !post ||
        !revertSha ||
        !remoteSha ||
        !repositoryUrl
      ) {
        const reason =
          text(payload?.error) ?? text(event.content) ?? 'no result';
        return {
          status: 'failed',
          message: `rollback_execute did not return verified recovery: ${reason.slice(0, 300)}`,
        };
      }
      if (payload.tests_passed !== true || remoteSha !== revertSha) {
        return {
          status: 'failed',
          message: `Rollback verification failed: tests_passed=${String(payload.tests_passed)}, remote ${remoteSha} vs revert ${revertSha}`,
        };
      }
      recovery = {
        sandboxId: text(payload.sandbox_id) ?? 'daytona',
        preP99Ms: pre.p99Ms,
        preErrors: pre.errors,
        postP99Ms: post.p99Ms,
        postErrors: post.errors,
        revertSha,
        remoteSha,
        testsPassed: true,
        sandboxStopped: payload.sandbox_stopped === true,
        githubUrl: commitUrl(repositoryUrl, remoteSha),
      };
    } else if (recovery && call.server === 'linear' && payload) {
      linearUrl = text(payload.url) ?? linearUrl;
      linearIdentifier =
        text(payload.identifier) ?? text(payload.id) ?? linearIdentifier;
    } else if (
      recovery &&
      call.tool === 'slack_post_message' &&
      payload?.delivered === true
    ) {
      slackPermalink = text(payload.permalink) ?? slackPermalink;
    }
  }
  if (!recovery) return { status: 'pending' };
  return {
    status: 'verified',
    recovery: {
      ...recovery,
      ...(linearUrl ? { linearUrl } : {}),
      ...(linearIdentifier ? { linearIdentifier } : {}),
      ...(slackPermalink ? { slackPermalink } : {}),
    },
  };
}

/** True when the newest event closes the turn without a pending required action. */
export function turnFinished(events: SessionEvent[]): boolean {
  const newest = [...events].sort((left, right) =>
    (text(right.created_at) ?? '').localeCompare(text(left.created_at) ?? ''),
  )[0];
  if (newest?.type !== 'turn.done') return false;
  const state = record(newest.state);
  const required = Array.isArray(state?.required_actions)
    ? state.required_actions
    : [];
  return required.length === 0;
}
