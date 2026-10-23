'use strict';
// SQL for the player, as the support asks it ("run this SELECT and paste the result"): the repack's own MySQL client
// with its own option file (mysql/admin-client.ini). Reading by default; a change needs the player to allow it.
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_ROWS = 500;
const READ = /^(select|show|describe|desc|explain|with)\b/i;

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

// Only reading statements (SELECT, SHOW, DESCRIBE, EXPLAIN), unless the player allowed changes.
function check(text, allowChanges) {
  const list = statements(String(text || ''));
  if (!list.length) throw new Error('Type a SQL query first.');
  if (list.length > 20) throw new Error('At most 20 statements at a time.');
  const writes = list.filter(item => !READ.test(item) || /\binto\s+(outfile|dumpfile)\b/i.test(item));
  if (writes.length && !allowChanges) throw new Error(`Only reading queries (SELECT, SHOW, DESCRIBE) run by default. Allow changes to run: ${writes[0].slice(0, 80)}`);
  return { list, writes: writes.length };
}

// mysql --batch output: one block per statement that returns rows, tab-separated, first line = column names.
function parse(output) {
  const lines = String(output).replace(/\r/g, '').split('\n');
  const unescape = value => (value === 'NULL' ? null : value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
  const rows = lines.filter(line => line !== '').map(line => line.split('\t').map(unescape));
  return rows;
}

function run(root, text, { allowChanges = false, timeout = 60000 } = {}) {
  const { list, writes } = check(text, allowChanges);
  const results = [];
  const exe = path.join(root, 'mysql', 'bin', 'mysql.exe');
  const args = [`--defaults-file=${path.join(root, 'mysql', 'admin-client.ini')}`, '--batch', '--default-character-set=utf8mb4'];
  // One statement at a time: each result block comes back with its own column names.
  return list.reduce((chain, statement) => chain.then(() => new Promise((resolve, reject) => {
    execFile(exe, [...args, '-e', statement], { windowsHide: true, timeout, maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().split(/\r?\n/).pop().replace(/^ERROR \d+ \(\w+\)( at line \d+)?: /, '')));
      const rows = parse(stdout);
      results.push({ statement, columns: rows[0] || [], rows: rows.slice(1, MAX_ROWS + 1), total: Math.max(0, rows.length - 1) });
      resolve();
    });
  })), Promise.resolve()).then(() => ({ results, writes }));
}

module.exports = { statements, check, parse, run, MAX_ROWS };
