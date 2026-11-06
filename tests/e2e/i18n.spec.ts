import { test, expect } from "./fixtures";

// The UI language comes from the PARAGLIDE_LOCALE cookie, falling back to the
// browser's Accept-Language and then English. URLs never carry a locale.

test.describe("Language selection", () => {
  test("lists English, Portuguese (Brazil), Spanish and Polish with flags on the login page", async ({
    page,
  }) => {
    await page.goto("/login");
    const picker = page.getByLabel("Language");
    await expect(picker).toHaveValue("en");
    await expect(picker.locator("option")).toHaveText([
      "🇬🇧 English",
      /^🇧🇷 Português/,
      /^🇪🇸 Español/,
      "🇵🇱 Polski",
    ]);
  });

  test("switches the login page to Portuguese and keeps the URL", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Language").selectOption("pt-BR");

    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/login");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "PARAGLIDE_LOCALE")?.value).toBe("pt-BR");
  });

  test("remembers the language chosen in the sidebar across reloads", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Budgets" })).toBeVisible();

    await page.locator("#sidebar-locale").selectOption("pl");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("link", { name: "Budgets" })).toHaveCount(0);

    await page.reload();
    // Server-rendered in Polish too: no flash of English after reload.
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.locator("#sidebar-locale")).toHaveValue("pl");
  });
});

test.describe("Browser language", () => {
  test.use({ locale: "es-ES" });

  test("follows Accept-Language on the first visit", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByLabel("Language")).toHaveCount(0);
    await expect(page.locator("#login-locale")).toHaveValue("es");
  });
});
