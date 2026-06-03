import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createUpdateController, UpdaterLike } from "./autoUpdate";

function makeFakeUpdater() {
  const emitter = new EventEmitter();
  const fake = {
    checkCalls: 0,
    quitCalls: 0,
    on(event: string, listener: (...args: any[]) => void) {
      emitter.on(event, listener);
      return fake;
    },
    emit(event: string, ...args: any[]) {
      return emitter.emit(event, ...args);
    },
    async checkForUpdates() {
      fake.checkCalls++;
    },
    quitAndInstall() {
      fake.quitCalls++;
    },
  };
  return fake;
}

test("no pending update initially", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  assert.equal(ctrl.getPendingUpdate(), null);
});

test("update-downloaded sets pending, notifies, and signals state change", () => {
  const fake = makeFakeUpdater();
  const notes: string[] = [];
  let stateChanges = 0;
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify: (b) => notes.push(b),
    onStateChange: () => {
      stateChanges++;
    },
  });
  ctrl.start();
  fake.emit("update-downloaded", { version: "0.3.0" });
  assert.deepEqual(ctrl.getPendingUpdate(), { version: "0.3.0" });
  assert.equal(stateChanges, 1);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /0\.3\.0/);
});

test("checkNow skips when a check is already in progress", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  ctrl.start();
  ctrl.checkNow();
  ctrl.checkNow();
  assert.equal(fake.checkCalls, 1);
});

test("a finished check (update-not-available) allows the next check", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  ctrl.start();
  ctrl.checkNow();
  fake.emit("update-not-available", {});
  ctrl.checkNow();
  assert.equal(fake.checkCalls, 2);
});

test("an error resets the in-progress guard", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  ctrl.start();
  ctrl.checkNow();
  fake.emit("error", new Error("network down"));
  ctrl.checkNow();
  assert.equal(fake.checkCalls, 2);
});

test("quitAndInstall delegates to the updater", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  ctrl.quitAndInstall();
  assert.equal(fake.quitCalls, 1);
});

test("a completed download (update-downloaded) allows the next check", () => {
  const fake = makeFakeUpdater();
  const ctrl = createUpdateController(fake as UpdaterLike, {
    notify() {},
    onStateChange() {},
  });
  ctrl.start();
  ctrl.checkNow();
  fake.emit("update-downloaded", { version: "0.3.0" });
  ctrl.checkNow();
  assert.equal(fake.checkCalls, 2);
});
