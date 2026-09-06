export const themeScript = `try {
  const stored = JSON.parse(localStorage.getItem("sparkles-preferences") || "{}").theme;
  const theme = stored === "light" || stored === "dark" ? stored : "system";
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {}`;
