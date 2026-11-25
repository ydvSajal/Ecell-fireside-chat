import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import questions from './questions.json';

const initial = () => ({ questions, guests: [], rounds: [], current: null, sessions: {}, attempts: {} });
const table = 'action_lab_event';
const runtime = globalThis.__actionLabStore ??= {};

function storage() {
  if (runtime.store) return runtime.store;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const init = async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id integer PRIMARY KEY, state jsonb NOT NULL)`);
      await pool.query(`INSERT INTO ${table} VALUES (1, $1) ON CONFLICT DO NOTHING`, [JSON.stringify(initial())]);
    };
    let ready;
    const prepare = () => ready ??= init().catch(error => { ready = undefined; throw error; });
    runtime.store = {
      async read() {
        await prepare();
        return (await pool.query(`SELECT state FROM ${table} WHERE id = 1`)).rows[0].state;
      },
      async change(update) {
        await prepare();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const state = (await client.query(`SELECT state FROM ${table} WHERE id = 1 FOR UPDATE`)).rows[0].state;
          const result = update(state);
          await client.query(`UPDATE ${table} SET state = $1 WHERE id = 1`, [JSON.stringify(state)]);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (process.env.RENDER) throw new Error('DATABASE_URL is required on Render.');
    const directory = process.env.ACTION_LAB_DATA_DIR || '.action-labs';
    mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(`${directory}/event.sqlite`);
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS ${table} (id integer PRIMARY KEY, state text NOT NULL);`);
    db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (1, ?)`).run(JSON.stringify(initial()));
    const get = db.prepare(`SELECT state FROM ${table} WHERE id = 1`);
    const put = db.prepare(`UPDATE ${table} SET state = ? WHERE id = 1`);
    const read = () => JSON.parse(get.get().state);
    runtime.store = {
      read,
      change(update) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const state = read();
          const result = update(state);
          put.run(JSON.stringify(state));
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }
  return runtime.store;
}

export const readState = () => storage().read();
export const changeState = update => storage().change(update);
