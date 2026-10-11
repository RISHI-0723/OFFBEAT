/** Remembers which referral link brought this browser to an event, so check-in can attribute it. */
const key = (eventSlug: string) => `offbeat.ref.${eventSlug}`;

export function rememberReferral(eventSlug: string, code: string) {
  try {
    localStorage.setItem(key(eventSlug), code.toUpperCase());
  } catch {
    /* ignore */
  }
}
export function recallReferral(eventSlug: string): string {
  try {
    return localStorage.getItem(key(eventSlug)) ?? "";
  } catch {
    return "";
  }
}
