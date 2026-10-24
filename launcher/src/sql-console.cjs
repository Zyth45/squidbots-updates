'use strict';
// SQL for the player, as the support asks it ("run this SELECT and paste the result"): the repack's own MySQL client
// with its own option file (mysql/admin-client.ini). Reading by default; a change needs the player to allow it.
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_ROWS = 500;
const READ = /^(select|show|describe|desc|explain|with)\b/i;
const CHANGES = /\b(insert|update|delete|replace|drop|alter|create|truncate|rename|grant|revoke|call|load|lock|handler)\b/i;
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;

// A whole command pasted from the support (mysql\bin\mysql.exe --defaults-file=… acore_world -e "…"):
// only the query is kept, and the database named before -e is used.
function unwrap(text) {
  const match = /^\s*\S*mysql(?:\.exe)?"?\s+([\s\S]*?)\s(?:-e|--execute)\s*=?\s*(["'])([\s\S]*)\2\s*;?\s*$/i.exec(String(text || ''));
  if (!match) return { text: String(text || ''), database: '' };
  const database = match[1].split(/\s+/).find(arg => arg && !arg.startsWith('-') && DATABASE.test(arg)) || '';
  return { text: match[3].replace(/\\"/g, '"'), database };
}

// The statements of a text, comments and strings taken into account (a ; inside quotes does not split).
function statements(text) {
  const out = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      current += c;
      if (c === '\\') { current += next ?? ''; i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '-' && next === '-') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (c === '#') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (c === '/' && next === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    if (c === ';') { if (current.trim()) out.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

// A statement that may change data: anything but SELECT/SHOW/DESCRIBE/EXPLAIN, and a WITH or EXPLAIN that hides
// a change (WITH x AS (…) DELETE …, EXPLAIN ANALYZE DELETE …). Reading statements also run in a read-only session.
function writes(statement) {
  if (!READ.test(statement) || /\binto\s+(outfile|dumpfile)\b/i.test(statement)) return true;
  const bare = statement.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`/g, "''");
  return /^(with|explain)\b/i.test(bare) && CHANGES.test(bare);
}

// Only reading statements (SELECT, SHOW, DESCRIBE, EXPLAIN), unless the player allowed changes.
function check(text, allowChanges) {
  const { text: query, database } = unwrap(text);
  const list = statements(query);
  if (!list.length) throw new Error('Type a SQL query first.');
  if (list.length > 20) throw new Error('At most 20 statements at a time.');
  const changing = list.filter(writes);
  if (changing.length && !allowChanges) throw new Error(`Only reading queries (SELECT, SHOW, DESCRIBE) run by default. Allow changes to run: ${changing[0].slice(0, 80)}`);
  return { list, writes: changing.length, database };
}

// mysql --batch output: one block per statement that returns rows, tab-separated, first line = column names.
function parse(output) {
  const lines = String(output).replace(/\r/g, '').split('\n');
  const unescape = value => (value === 'NULL' ? null : value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
  const rows = lines.filter(line => line !== '').map(line => line.split('\t').map(unescape));
  return rows;
}

function run(root, text, { allowChanges = false, timeout = 60000 } = {}) {
  const { list, writes: count, database } = check(text, allowChanges);
  const results = [];
  const exe = path.join(root, 'mysql', 'bin', 'mysql.exe');
  const args = [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`, '--batch', '--default-character-set=utf8mb4', ...(database ? [`--database=${database}`] : [])];
  // One statement at a time: each result block comes back with its own column names.
  return list.reduce((chain, statement) => chain.then(() => new Promise((resolve, reject) => {
    const change = writes(statement);
    // A change is followed by ROW_COUNT() in the same session: the player sees how many rows it touched.
    const own = change ? [...args, '-e', `${statement};\nSELECT ROW_COUNT() AS changed_rows`] : [...args, '--init-command=SET SESSION TRANSACTION READ ONLY', '-e', statement];
    execFile(exe, own, { windowsHide: true, timeout, killSignal: 'SIGKILL', maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
      if (error) {
        const message = String(stderr || error.message).trim().split(/\r?\n/).pop().replace(/^ERROR \d+ \(\w+\)( at line \d+)?: /, '');
        return reject(new Error(/READ ONLY transaction/i.test(message) ? 'This query changes data: allow changes to run it (a backup is made first).' : message));
      }
      let rows = parse(stdout);
      let changed = null;
      if (change) { changed = Number(rows.at(-1)?.[0]); rows = rows.slice(0, -2); if (!Number.isFinite(changed) || changed < 0) changed = null; }
      results.push({ statement, columns: rows[0] || [], rows: rows.slice(1, MAX_ROWS + 1), total: Math.max(0, rows.length - 1), changed });
      resolve();
    });
  })), Promise.resolve()).then(() => ({ results, writes: count, database }));
}

module.exports = { unwrap, statements, writes, check, parse, run, MAX_ROWS };
