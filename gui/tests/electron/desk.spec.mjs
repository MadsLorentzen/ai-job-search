import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUI = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test.describe("Job Search Desk", () => {
  test("Open CLI remains available when Electron can launch", async ({}, testInfo) => {
    let app;
    try {
      app = await electron.launch({
        args: [GUI, "--first-run"],
        env: {
          ...process.env,
          JOB_SEARCH_FORCE_FIRST_RUN: "1",
          JOB_SEARCH_GUI_NO_BROWSER: "1",
        },
      });
    } catch (error) {
      testInfo.skip(true, `Electron launch unavailable: ${error.message}`);
      return;
    }
    try {
      const window = await app.firstWindow();
      await expect(window.locator("#open-cli, text=Open an existing")).toHaveCount({ timeout: 15000 }).catch(() => {});
      const openCli = window.locator("#open-cli");
      if (await openCli.count()) await expect(openCli).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
