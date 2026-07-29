const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function captureMockNow(): Date | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  if (!params.has("mockNow")) return null;

  const value = params.get("mockNow") ?? "";
  const parsed = new Date(value);
  if (!ISO_INSTANT.test(value) || Number.isNaN(parsed.getTime())) {
    console.warn("[MolRoom QA] invalid mockNow");
    return null;
  }
  return parsed;
}

const frozenNow = captureMockNow();

export function appNow(): Date {
  return frozenNow === null ? new Date() : new Date(frozenNow);
}
