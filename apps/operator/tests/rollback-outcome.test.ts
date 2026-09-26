import { describe, expect, it } from 'vitest';
import { rollbackOutcome, turnFinished } from '../rollback-outcome';

const revertSha = 'ba8c853fa901e3829e01f1a295a57b797149d50f';

function call(id: string, server: string, tool: string, at: string) {
  return {
    type: 'model.message',
    created_at: at,
    tool_calls: [
      {
        id,
        function: {
          name: 'call_tool',
          arguments: JSON.stringify({
            mcp_server: server,
            tool_name: tool,
            input: {},
          }),
        },
      },
    ],
  };
}

function result(id: string, content: unknown, at: string) {
  return {
    type: 'tool.response',
    created_at: at,
    tool_call_id: id,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  };
}

const rollbackPayload = {
  repository_url: 'https://github.com/hharshhsaini/pagerpilot-demo.git',
  sandbox_id: 'sandbox-1',
  pre_evidence: { requests: 25, errors: 3, p99_ms: 6813.7 },
  post_evidence: { requests: 25, errors: 0, p99_ms: 122.4 },
  revert_sha: revertSha,
  remote_sha: revertSha,
  tests_passed: true,
  sandbox_stopped: true,
};

describe('rollbackOutcome', () => {
  it('stays pending until rollback_execute responds', () => {
    expect(
      rollbackOutcome([
        call('r1', 'checkout-svc-sim', 'rollback_execute', '1'),
      ]),
    ).toEqual({ status: 'pending' });
  });

  it('builds verified recovery and links only from responses after the rollback', () => {
    const outcome = rollbackOutcome([
      call('s0', 'checkout-svc-sim', 'slack_post_message', '1'),
      result(
        's0',
        { delivered: true, permalink: 'https://slack.test/rca-choice' },
        '2',
      ),
      call('r1', 'checkout-svc-sim', 'rollback_execute', '3'),
      result('r1', rollbackPayload, '4'),
      call('s1', 'checkout-svc-sim', 'slack_post_message', '5'),
      result(
        's1',
        { delivered: true, permalink: 'https://slack.test/final' },
        '6',
      ),
      call('l1', 'linear', 'save_issue', '7'),
      result(
        'l1',
        {
          identifier: 'PAG-1',
          url: 'https://linear.app/pagerpilot/issue/PAG-1',
        },
        '8',
      ),
    ]);

    expect(outcome).toEqual({
      status: 'verified',
      recovery: {
        sandboxId: 'sandbox-1',
        preP99Ms: 6813.7,
        preErrors: 3,
        postP99Ms: 122.4,
        postErrors: 0,
        revertSha,
        remoteSha: revertSha,
        testsPassed: true,
        sandboxStopped: true,
        githubUrl: `https://github.com/hharshhsaini/pagerpilot-demo/commit/${revertSha}`,
        linearUrl: 'https://linear.app/pagerpilot/issue/PAG-1',
        linearIdentifier: 'PAG-1',
        slackPermalink: 'https://slack.test/final',
      },
    });
  });

  it('fails visibly when the rollback tool returns an error', () => {
    const outcome = rollbackOutcome([
      call('r1', 'checkout-svc-sim', 'rollback_execute', '1'),
      result('r1', 'MCP error: GITHUB_DEMO_TOKEN is not configured', '2'),
    ]);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.message).toContain(
      'GITHUB_DEMO_TOKEN is not configured',
    );
  });

  it('fails when the pushed commit does not match the tested revert', () => {
    const outcome = rollbackOutcome([
      call('r1', 'checkout-svc-sim', 'rollback_execute', '1'),
      result('r1', { ...rollbackPayload, remote_sha: 'f'.repeat(40) }, '2'),
    ]);
    expect(outcome.status).toBe('failed');
  });
});

describe('turnFinished', () => {
  it('requires the newest event to close the turn without required actions', () => {
    expect(
      turnFinished([
        { type: 'model.message', created_at: '1' },
        { type: 'turn.done', created_at: '2', state: { required_actions: [] } },
      ]),
    ).toBe(true);
    expect(
      turnFinished([
        {
          type: 'turn.done',
          created_at: '2',
          state: { required_actions: [{ type: 'tool.approval_required' }] },
        },
      ]),
    ).toBe(false);
    expect(
      turnFinished([
        { type: 'turn.done', created_at: '1', state: {} },
        { type: 'model.message', created_at: '2' },
      ]),
    ).toBe(false);
  });
});
