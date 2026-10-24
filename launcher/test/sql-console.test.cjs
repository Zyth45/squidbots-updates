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

test('a WITH or EXPLAIN that hides a change counts as a change', () => {
  assert.throws(() => sql.check('WITH x AS (SELECT 1) DELETE FROM acore_auth.account', false), /Only reading queries/);
  assert.throws(() => sql.check('EXPLAIN ANALYZE DELETE FROM acore_auth.account', false), /Only reading queries/);
  assert.equal(sql.check("WITH x AS (SELECT 'delete' AS w) SELECT * FROM x", false).writes, 0);
});

test('a whole mysql.exe command pasted from the support keeps only its query and database', () => {
  const pasted = 'mysql\\bin\\mysql.exe --defaults-file=mysql\\admin-client.ini acore_world -e "INSERT INTO gameobject (guid) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM gameobject WHERE guid=1);"';
  const { text, database } = sql.unwrap(pasted);
  assert.equal(database, 'acore_world');
  assert.equal(text, 'INSERT INTO gameobject (guid) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM gameobject WHERE guid=1);');
  assert.equal(sql.check(pasted, true).writes, 1);
  assert.equal(sql.unwrap('SELECT 1').text, 'SELECT 1');
});
