import { execFile } from 'node:child_process';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptUrl = new URL('../../../demo/trigger-alert.sh', import.meta.url);
const scriptPath = decodeURIComponent(scriptUrl.pathname);
const servers: ReturnType<typeof createServer>[] = [];

async function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let contents = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      contents += chunk;
    });
    request.once('error', reject);
    request.once('end', () => {
      try {
        resolve(JSON.parse(contents) as unknown);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('trigger-alert.sh', () => {
  it('validates the incident before triggering the operator control endpoint', async () => {
    const script = await readFile(scriptUrl, 'utf8');

    expect(script).toContain('PAGERPILOT_OPERATOR_URL');
    expect(script).toContain('/demo/trigger');
    expect(script).toContain('--fail-with-body');
    expect(script).toContain('^INC-[0-9]+$');
    expect(script.indexOf('^INC-[0-9]+$')).toBeLessThan(
      script.indexOf('/demo/trigger'),
    );
  });

  it('JSON-encodes the incident and prints the durable session link', async () => {
    const requests: Array<{ method?: string; url?: string; body: unknown }> =
      [];
    const operatorUrl = await startServer((request, response) => {
      void body(request).then(payload => {
        requests.push({
          method: request.method,
          url: request.url,
          body: payload,
        });
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            incidentId: 'INC-4821',
            sessionId: 'session-1',
            slackStatus: 'delivered',
            slackPermalink: 'https://slack.test/archives/C1/p1',
          }),
        );
      });
    });

    const result = await execFileAsync(scriptPath, ['INC-4821'], {
      env: { ...process.env, PAGERPILOT_OPERATOR_URL: operatorUrl },
    });

    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/demo/trigger',
        body: { incident_id: 'INC-4821' },
      },
    ]);
    expect(result.stdout).toContain('Incident detected: INC-4821');
    expect(result.stdout).toContain(
      'Slack investigation notification: delivered',
    );
    expect(result.stdout).toContain(
      `PagerPilot: ${operatorUrl}/sessions/session-1`,
    );
    expect(result.stdout).toContain('Slack: https://slack.test/archives/C1/p1');
  });

  it('rejects a malformed incident ID before contacting the operator', async () => {
    const requests: string[] = [];
    const operatorUrl = await startServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.writeHead(500);
      response.end();
    });

    await expect(
      execFileAsync(scriptPath, ['INC-48x1'], {
        env: { ...process.env, PAGERPILOT_OPERATOR_URL: operatorUrl },
      }),
    ).rejects.toMatchObject({ code: 2 });
    expect(requests).toEqual([]);
  });

  it('fails visibly when the operator rejects the trigger', async () => {
    const operatorUrl = await startServer((request, response) => {
      void body(request).then(() => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":"trigger failed"}');
      });
    });

    await expect(
      execFileAsync(scriptPath, ['INC-4821'], {
        env: { ...process.env, PAGERPILOT_OPERATOR_URL: operatorUrl },
      }),
    ).rejects.toMatchObject({ code: 22 });
  });

  it('refuses a trigger response without a session ID', async () => {
    const operatorUrl = await startServer((request, response) => {
      void body(request).then(() => {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end('{"incidentId":"INC-4821"}');
      });
    });

    await expect(
      execFileAsync(scriptPath, ['INC-4821'], {
        env: { ...process.env, PAGERPILOT_OPERATOR_URL: operatorUrl },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('missing sessionId') as unknown,
    });
  });
});
