import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const credentialsPath = join(process.cwd(), ".e2e-creds.json");
const evidencePath = join(process.cwd(), "evidence", "responsavel-do-funil");

test("a configuração do responsável aparece no funil sem criar associação", async ({ page }) => {
  if (!existsSync(credentialsPath)) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8")) as {
    password: string; users: Record<string, { email: string }>;
  };
  await page.goto("/login");
  await page.locator("#email").fill(credentials.users.manager!.email);
  await page.locator("#password").fill(credentials.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  await page.goto("/app/settings/tenant/pipelines");
  const heading = page.getByRole("heading", { name: "Quem atende os contatos deste funil" }).first();
  await expect(heading).toBeVisible();
  const section = heading.locator("xpath=..");
  await expect(section.getByLabel("Agente responsável pelo funil")).toBeVisible();
  await expect(section.getByText("Nenhum agente definido")).toBeVisible();
  mkdirSync(evidencePath, { recursive: true });
  await section.screenshot({ path: join(evidencePath, "configuracao-sem-associacao.png") });
});
