import type { Page } from '@playwright/test';
import type { BackendInfo } from './backend';

/** The question text currently shown on the gate (the harness key is looked up by prompt). */
export async function currentPrompt(page: Page): Promise<string> {
  return (await page.locator('legend').first().innerText()).trim();
}

async function pick(page: Page, text: string): Promise<void> {
  // The native radio is stretched over its card, so check it directly.
  await page.getByRole('radio', { name: text, exact: true }).check({ force: true });
}

export async function submit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Submit answer' }).click();
}

/** Answers the visible question with the harness's correct option TEXT (options are shuffled). */
export async function answerCorrectly(page: Page, b: BackendInfo): Promise<string> {
  const prompt = await currentPrompt(page);
  const text = b.gateKeyText[prompt];
  if (!text) throw new Error(`no harness key for prompt: ${prompt}`);
  await pick(page, text);
  await submit(page);
  return prompt;
}

/** Answers wrongly: picks any option whose text is not the harness's correct one. */
export async function answerWrongly(page: Page, b: BackendInfo): Promise<string> {
  const prompt = await currentPrompt(page);
  const correct = b.gateKeyText[prompt];
  const labels = await page.locator('fieldset label span:last-of-type').allInnerTexts();
  const wrong = labels.map((l) => l.trim()).find((l) => l !== '' && l !== correct);
  if (!wrong) throw new Error('no wrong option found');
  await pick(page, wrong);
  await submit(page);
  return prompt;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(/Work email/).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
