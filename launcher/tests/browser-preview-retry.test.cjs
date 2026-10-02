const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost } = require("../electron/browser-host.cjs");

function fixture() {
  const original = {
    id: "preview", surfaceId: "preview-surface", traceId: "trace-fixture",
    helperPid: process.pid, status: "running", interactionMode: "automatic",
    conversationKey: "e".repeat(64), connectorIdentity: "Fixture Connector", connectorBound: false,
    view: { webContents: { isDestroyed: () => false, setBackgroundThrottling() {} } },
  };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map([[original.id, original]]), closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    manualOperation: null, selectedTabId: original.id, syncPowerSaveBlocker() {}, syncViewVisibility() {},
    showWindow() {}, show() {}, publishState() {}, writeDescriptor() {}, snapshot: () => ({tabs: []}),
    logger: { info() {}, warn() {} },
    async createTurnTab(traceId,helperPid,conversationKey,connectorIdentity) {
      const tab = {...original,id:"retry",surfaceId:"retry-surface",traceId,helperPid,conversationKey,connectorIdentity,status:"running"};
      this.turnTabs.set(tab.id,tab);
      return tab;
    },
  });
  return {host,original};
}

test("failed page preview remains visible without blocking a same-trace fresh retry", async () => {
  const {host,original} = fixture();
  const {traceId,helperPid,conversationKey,connectorIdentity} = original;
  await host.endTurn(traceId,helperPid,"failed",true,"Element is outside of the viewport",false,false,true);
  assert.equal(host.turnTabs.get(original.id),original);
  assert.equal(host.tabSnapshot(original).traceId,traceId);
  const retry = await host.beginTurn(traceId,false,helperPid,conversationKey,connectorIdentity);
  assert.equal(retry.reused,false);
  assert.equal(retry.tabId,"retry");
  assert.equal(host.turnTabs.size,2);
  assert.deepEqual(host.heartbeatTurn(traceId,helperPid),{tabs:[]});
  assert.throws(()=>host.heartbeatTurn(traceId,helperPid+1),/ownership mismatch/);
  await host.endTurn(traceId,helperPid,"completed",true,undefined,true,true,true);
  assert.equal(host.turnTabs.get(original.id),original);
  assert.equal(host.turnTabs.get("retry").connectorBound,true);
  assert.equal(host.turnTabs.get("retry").conversationKey,conversationKey);
});

test("a failed preview is not eligible for a required retained conversation", async () => {
  const {host,original} = fixture();
  const {traceId,helperPid,conversationKey,connectorIdentity} = original;
  await host.endTurn(traceId,helperPid,"failed",true,undefined,false,false,true);
  await assert.rejects(host.beginTurn(traceId,false,helperPid,conversationKey,connectorIdentity,true),{code:"retained_conversation_unavailable"});
  assert.equal(host.turnTabs.size,1);
});

test("completed bound page previews still reuse only matching conversation metadata", async () => {
  const {host,original} = fixture();
  const {traceId,helperPid,conversationKey,connectorIdentity} = original;
  await host.endTurn(traceId,helperPid,"completed",true,undefined,true,true,true);
  await assert.rejects(host.beginTurn(traceId,false,helperPid,"f".repeat(64),connectorIdentity),/metadata does not match/);
  const next = await host.beginTurn("next-trace",false,helperPid,conversationKey,connectorIdentity,true);
  assert.equal(next.reused,true);
  assert.equal(next.tabId,original.id);
});

test("keeping an aborted preview never removes explicit user cancellation", async () => {
  const {host,original} = fixture();
  const {traceId,helperPid,conversationKey,connectorIdentity} = original;
  host.userCancelledTurnOwners.set(traceId,helperPid);
  await host.endTurn(traceId,helperPid,"aborted",true,undefined,false,false,true);
  await assert.rejects(host.beginTurn(traceId,false,helperPid,conversationKey,connectorIdentity),/cancelled by the user/);
});
