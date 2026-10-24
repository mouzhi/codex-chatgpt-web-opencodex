import type { Locator } from "playwright-core";

/** The October composer exposes plugin search through its owned add-context button. */
export async function openChatGptPluginSearchMenu(
  composer: Locator,
  appName: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const trigger = composer.locator("xpath=ancestor::form[1]")
    .locator('button[data-composer-navigation-target="add-context"]')
    .filter({ visible: true });
  const count = await trigger.count();
  signal?.throwIfAborted();
  if (count === 0) return false;
  if (count !== 1) throw new Error("ChatGPT composer exposed ambiguous plugin-search controls");
  const options = { timeout: 10_000, signal };
  await composer.press("Escape", options);
  await composer.fill("", options);
  await trigger.press("Enter", options);
  if (await trigger.getAttribute("aria-expanded", options) !== "true") {
    throw new Error("ChatGPT composer plugin-search menu did not open");
  }
  await composer.focus(options);
  await composer.pressSequentially(appName, { ...options, delay: 25 });
  signal?.throwIfAborted();
  return true;
}
