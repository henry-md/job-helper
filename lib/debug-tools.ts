export function isDebugToolsEnabled() {
  return process.env.DISABLE_DEBUG_TOOLS !== "true";
}
