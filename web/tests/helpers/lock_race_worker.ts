import { acquireDaemonLock, LockCollisionError } from "../../lib/daemonLockManager";

process.on("message", (msg: any) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.cmd === "RACE") {
    try {
      const res = acquireDaemonLock({ throwOnCollision: true });
      if (res.acquired) {
        if (process.send) {
          process.send({ type: "ACQUIRED", pid: process.pid, uuid: res.instanceUuid });
        }
        // Hold lock for a moment so other racing processes definitely collide
        setTimeout(() => {
          process.exit(10); // Exit 10 = Acquired successfully
        }, 1200);
        return;
      }
      process.exit(30);
    } catch (err: any) {
      if (err instanceof LockCollisionError || err?.name === "LockCollisionError") {
        if (process.send) {
          process.send({ type: "COLLISION", pid: process.pid, collidingPid: err.pid });
        }
        process.exit(20); // Exit 20 = Collision error (expected for losers)
      }
      if (process.send) {
        process.send({ type: "ERROR", pid: process.pid, error: err?.message || String(err) });
      }
      process.exit(30); // Exit 30 = Unexpected failure
    }
  }

  if (msg.cmd === "LOCK_AND_FREEZE") {
    try {
      const res = acquireDaemonLock({ throwOnCollision: true });
      if (res.acquired) {
        if (process.send) {
          process.send({ type: "LOCKED", pid: process.pid, uuid: res.instanceUuid });
        }
        // Infinite block waiting for abrupt kill
        setInterval(() => {}, 60000);
      } else {
        process.exit(30);
      }
    } catch (err: any) {
      if (process.send) {
        process.send({ type: "ERROR", pid: process.pid, error: err?.message || String(err) });
      }
      process.exit(30);
    }
  }
});

// Signal process is ready to race
if (process.send) {
  process.send({ type: "READY", pid: process.pid });
}
