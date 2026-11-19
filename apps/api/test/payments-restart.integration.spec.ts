import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { Pool } from 'pg';
import { assertTestDatabase } from './test-database.js';

assertTestDatabase();

describe('durable creation replay after API process restart', () => {
  const origin = 'http://127.0.0.1:3102';
  let child: ChildProcess | undefined;
  let output = '';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    child = undefined;
  }
  async function start() {
    child = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, API_PORT: '3102' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error('Restart fixture API exited before readiness.');
      try {
        const result = await fetch(origin + '/api/v1/health/ready', {
          signal: AbortSignal.timeout(300),
        });
        if (result.ok) return;
      } catch {
        /* Wait for the child process to bind its port. */
      }
      await setTimeout(50);
    }
    throw new Error('Restart fixture API did not become ready.');
  }
  afterAll(async () => {
    await stop();
    await pool.query(
      'TRUNCATE idempotency_records, payment_events, payments RESTART IDENTITY',
    );
    await pool.end();
  });

  it('replays the same 201 bytes and current GET state in a new process', async () => {
    const key = randomUUID();
    const create = () =>
      fetch(origin + '/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: '{"amount":2500,"currency":"USD"}',
      });
    await start();
    const original = await create();
    expect(original.status).toBe(201);
    const bytes = await original.text();
    const payment = JSON.parse(bytes) as { id: string };
    // The API's helper is verified separately; this committed fixture represents
    // a later validated observation before the process stops.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE payments SET status='SUCCEEDED',status_version=2,updated_at=clock_timestamp() WHERE id=$1",
        [payment.id],
      );
      await client.query(
        "INSERT INTO payment_events (payment_id,type,from_status,to_status,status_version,details) VALUES ($1,'PAYMENT_STATUS_CHANGED','CREATED','SUCCEEDED',2,'{\"source\":\"test\"}')",
        [payment.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const firstPid = child!.pid;
    await stop();
    await start();
    expect(child!.pid).not.toBe(firstPid);
    const replayed = await create();
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get('idempotency-replayed')).toBe('true');
    expect(await replayed.text()).toBe(bytes);
    const details = await fetch(origin + `/api/v1/payments/${payment.id}`);
    expect(await details.json()).toMatchObject({
      id: payment.id,
      status: 'SUCCEEDED',
      statusVersion: 2,
    });
    const counts = await pool.query(
      'SELECT (SELECT count(*) FROM payments) AS payments,(SELECT count(*) FROM idempotency_records) AS keys,(SELECT count(*) FROM payment_events) AS events',
    );
    expect(counts.rows[0]).toEqual({ payments: '1', keys: '1', events: '2' });
    expect(output).not.toContain(key);
    expect(output).not.toContain(process.env.DATABASE_URL!);
  }, 15000);
});
