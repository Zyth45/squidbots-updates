'use strict';
// MySQL lent to a realm task (switch on, new bots, switch off) on a stopped server: started for the task and stopped
// again when the last such task ends, success or failure, so the home page never shows a server half started that
// the player did not start. Kept running when it already ran, or when a world, the authserver or a realm runs.
function mysqlLender({ status, start, stopAll, realmRunning }) {
  let tasks = 0;
  let stopAfter = false;
  return async function withMysql(work) {
    if (tasks === 0) stopAfter = !(await status()).some(service => service.id === 'mysql' && service.state === 'running');
    tasks++;
    try {
      await start('mysql');
      return await work();
    } finally {
      tasks--;
      if (tasks === 0 && stopAfter) {
        const others = (await status()).some(service => service.id !== 'mysql' && ['running', 'starting'].includes(service.state));
        if (!others && !(await realmRunning().catch(() => false))) await stopAll().catch(() => {});
      }
    }
  };
}

module.exports = { mysqlLender };
