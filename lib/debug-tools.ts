export function isDebugToolsEnabled() {
  return process.env.DISABLE_DEBUG_TOOLS !== "true";
}

export function isDebugUiEnabled() {
  const value = process.env.DEBUG_UI?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}
