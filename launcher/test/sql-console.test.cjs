'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sql = require('../src/sql-console.cjs');

test('statements are split on ; outside quotes and comments', () => {
  assert.deepEqual(sql.statements("SELECT 'a;b' FROM x; -- note ; here\nSHOW TABLES; /* c; */ DESCRIBE y"), ["SELECT 'a;b' FROM x", 'SHOW TABLES', 'DESCRIBE y']);
});

test('reading only by default; a change needs the player to allow it', () => {
  assert.equal(sql.check('SELECT 1; SHOW DATABASES', false).writes, 0);
  assert.throws(() => sql.check('SELECT 1; DELETE FROM acore_auth.account', false), /Only reading queries/);
  assert.throws(() => sql.check("SELECT 1 INTO OUTFILE 'x'", false), /Only reading queries/);
  assert.equal(sql.check('UPDATE acore_auth.realmlist SET flag = 0', true).writes, 1);
  assert.throws(() => sql.check('  -- nothing\n', false), /Type a SQL query/);
});

test('the batch output becomes columns and rows, NULL kept apart', () => {
  assert.deepEqual(sql.parse('guid\tid\n6901535\t20832\n6901536\tNULL\n'), [['guid', 'id'], ['6901535', '20832'], ['6901536', null]]);
});
