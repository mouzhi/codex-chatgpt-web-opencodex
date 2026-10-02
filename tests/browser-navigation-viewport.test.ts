import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

type Preparation = {
  prepareChatSurface(page: unknown, capture?: (checkpoint: string) => Promise<void>, saved?: boolean, signal?: AbortSignal): Promise<unknown>;
};
const prepare = (ChatGptBrowserWorker.prototype as unknown as Preparation).prepareChatSurface;

test("normal-chat navigation waits for the restored viewport before probing the composer", async () => {
  let width = 1232;
  let height = 1318;
  const events: string[] = [];
  const reachedComposer = new Error("fixture reached composer after viewport restoration");
  const page = {
    url: () => "about:blank",
    goto: async (_url: string, options: { waitUntil: string }) => {
      expect(options.waitUntil).toBe("domcontentloaded");
      events.push("dom-ready");
      width = height = 0;
    },
    waitForFunction: async (_predicate: unknown, minimum: { width: number; height: number }) => {
      events.push("viewport-barrier");
      expect(minimum).toEqual({ width: 320, height: 240 });
      // Electron's did-finish-load/emulation callback happens after DOMContentLoaded.
      await Promise.resolve();
      width = 1232;
      height = 1318;
      events.push("native-viewport-restored");
    },
  };
  const fixture = { activeComposer: async () => {
    if (!width || !height) throw new Error("locator.click: Element is outside of the viewport");
    events.push("composer");
    throw reachedComposer;
  } };
  await expect(prepare.call(fixture, page, async () => { events.push("diagnostic"); }, true)).rejects.toBe(reachedComposer);
  expect(events).toEqual(["dom-ready", "viewport-barrier", "native-viewport-restored", "diagnostic", "composer"]);
});

test("a viewport that never recovers fails before any model/composer activation", async () => {
  let composerCalls = 0;
  const page = {
    url: () => "about:blank", goto: async () => {},
    waitForFunction: async () => { throw new Error("fixture viewport remained 0x0"); },
  };
  await expect(prepare.call({activeComposer: async () => { composerCalls++; }},page,undefined,true))
    .rejects.toThrow("ChatGPT browser surface did not expose an operational viewport");
  expect(composerCalls).toBe(0);
});

test("an already navigated/reloaded home page still revalidates its viewport", async () => {
  let checked = false;
  const stop = new Error("fixture checked existing page");
  const page = {
    url: () => "https://chatgpt.com/", goto: async () => { throw new Error("must not navigate twice"); },
    waitForFunction: async () => { checked = true; },
  };
  await expect(prepare.call({activeComposer: async () => { expect(checked).toBeTrue(); throw stop; }},page,undefined,true))
    .rejects.toBe(stop);
});

test("cancellation during navigation never proceeds to composer activation", async () => {
  const abort = new AbortController();
  let composerCalls = 0;
  const page = {
    url: () => "about:blank", goto: async () => { abort.abort(); },
    waitForFunction: () => new Promise(() => {}),
  };
  await expect(prepare.call({activeComposer: async () => { composerCalls++; }},page,undefined,true,abort.signal))
    .rejects.toMatchObject({name:"AbortError"});
  expect(composerCalls).toBe(0);
});
