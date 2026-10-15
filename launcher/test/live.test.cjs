'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseInfo } = require('../src/live.cjs');

test('server info: players, characters, tick and its mean', () => {
  const info = parseInfo('AzerothCore rev. abc\nConnected players: 1. Characters in world: 21.\nConnection peak: 2.\nServer uptime: 5 minute(s) 3 second(s)\nUpdate time diff: 52ms. Last 500 diffs summary:\n|- Mean: 48ms\n|- Median: 47ms');
  assert.deepEqual({ players: info.players, characters: info.characters, tick: info.tick, tickMean: info.tickMean }, { players: 1, characters: 21, tick: 52, tickMean: 48 });
  assert.equal(parseInfo('nothing here').players, null);
});
