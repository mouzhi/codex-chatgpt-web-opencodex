import { expect, test } from "bun:test";
import { chromium, type Locator } from "playwright-core";
import { openChatGptPluginSearchMenu } from "../src/adapters/chatgpt-web/connector-search-menu";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

test("plugin search remains absent on legacy layouts and rejects ambiguous controls", async () => {
  for (const count of [0, 2]) {
    const composer = { locator: () => ({ locator: () => ({ filter: () => ({ count: async () => count }) }) }) } as unknown as Locator;
    if (count === 0) expect(await openChatGptPluginSearchMenu(composer, "Fixture Connector")).toBeFalse();
    else await expect(openChatGptPluginSearchMenu(composer, "Fixture Connector")).rejects.toThrow("ambiguous");
  }
});

test("aborted plugin search does not operate the composer", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(openChatGptPluginSearchMenu({} as Locator, "Fixture Connector", controller.signal)).rejects.toThrow("cancelled");
});

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
test.skipIf(!executable)("new plugin-search composer selects only the exact connector without sending", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    // Sanitized observed structure: owned form, add-context button, mention-list rows and pill.
    await page.setContent(`<form><button type="button" data-composer-navigation-target="add-context" aria-expanded="false">Add files and more</button><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button data-testid="send-button" type="submit">Send</button></form><div data-mention-list-scroll-area hidden><button type="button" data-list-navigation-item="true" aria-current="true"><span>Fixture Connector</span><span>Fixture Connector</span></button></div><form hidden><button data-composer-navigation-target="add-context">Hidden</button></form>
      <script>window.sends=0;const form=document.querySelector('form'),editor=document.querySelector('#prompt-textarea'),trigger=form.querySelector('[data-composer-navigation-target]'),menu=document.querySelector('[data-mention-list-scroll-area]');form.onsubmit=e=>{e.preventDefault();window.sends++};trigger.onclick=()=>{trigger.setAttribute('aria-expanded','true');editor.focus()};editor.oninput=()=>{menu.hidden=!(trigger.getAttribute('aria-expanded')==='true'&&editor.textContent==='Fixture Connector')};editor.onkeydown=e=>{if(e.key==='Escape'){menu.hidden=true;trigger.setAttribute('aria-expanded','false')}if(e.key==='Enter'&&!menu.hidden){e.preventDefault();editor.innerHTML='<span contenteditable="false" app-mention-path="app://fixture" app-mention-display-name="Fixture Connector">Fixture Connector</span>';menu.hidden=true;trigger.setAttribute('aria-expanded','false')}};</script>`);
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    worker.config = { appName: "Fixture Connector" };
    const checkpoints: string[] = [];
    const selected = await worker.selectConnector(page, async (value: string) => { checkpoints.push(value); });
    expect(checkpoints).toContain("connector-plugin-search-visible");
    expect(await worker.connectorIsSelected(selected)).toBeTrue();
    expect(await page.evaluate(() => (window as any).sends)).toBe(0);
    expect(await page.locator('form[hidden] button').getAttribute('aria-expanded')).toBeNull();
  } finally { await browser.close(); }
}, 15_000);
