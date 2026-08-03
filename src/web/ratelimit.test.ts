/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 4711;
const PASSWORD = 'correct-horse';

async function get(auth: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/jobs`, {
    headers: { authorization: `Basic ${Buffer.from(`x:${auth}`).toString('base64')}` },
  });
  await res.arrayBuffer();
  return res.status;
}

test('auth: failed logins are throttled, valid ones are not', async (t) => {
  const child = spawn('npx', ['tsx', 'src/web/server.ts'], {
    env: { ...process.env, JT_PASSWORD: PASSWORD, PORT: String(PORT), JT_MAX_FAILURES: '3' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  // Wait for the listen banner before firing requests.
  for await (const chunk of child.stdout) if (String(chunk).includes('job-tracker')) break;

  assert.equal(await get('wrong'), 401);
  assert.equal(await get('wrong'), 401);
  assert.equal(await get('wrong'), 401);
  // Over the limit: further guesses are refused without checking the password.
  assert.equal(await get('wrong'), 429);

  // The real password still gets in, a single-user board must not lock out its owner.
  assert.equal(await get(PASSWORD), 200);
  // ...and that success clears the counter.
  assert.equal(await get('wrong'), 401);
});
