/**
 * @file The "reminds them first" check: before a message is sent to the AI,
 * look for private things a person may have pasted in by mistake (an email
 * address, a phone number, a card or ID number, a password or key, a path
 * that shows their name, or a long block of pasted text such as the
 * contents of one of their files).
 *
 * Plain code, no AI: the whole point is that nothing is sent anywhere until
 * the person has seen the reminder and said it's fine.
 *
 * Imports nothing.
 */

/** One kind of private thing found, in plain English (e.g. "an email address"). */
export type PrivateTextKind = string;

/** Above this many characters, a message probably holds pasted text. */
const LONG_PASTE_CHARS = 1_200;
/** Above this many lines, a message probably holds pasted text. */
const LONG_PASTE_LINES = 15;

const CHECKS: readonly { kind: PrivateTextKind; test: (text: string) => boolean }[] = [
  { kind: "an email address", test: (t) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) },
  { kind: "a phone number", test: (t) => [...t.matchAll(/\+?\(?\d[\d\s().-]{7,}\d/g)].some(([m]) => digits(m).length >= 10 && digits(m).length <= 15 && !isCardNumber(digits(m))) },
  { kind: "a card number", test: (t) => [...t.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)].some(([m]) => isCardNumber(digits(m))) },
  { kind: "an ID number (like a Social Security number)", test: (t) => /\b\d{3}-\d{2}-\d{4}\b/.test(t) },
  {
    kind: "a password or key",
    test: (t) =>
      /\b(?:sk-ant-|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}|\bAIza[0-9A-Za-z_-]{35}|\bxox[abposr]-[A-Za-z0-9-]{10,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY/.test(t) ||
      /\b(?:password|passwd|pwd|passcode|pin)\s*(?:is|[:=])\s*\S{4,}/i.test(t),
  },
  { kind: "a file location that shows your name", test: (t) => /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s/\\]+/i.test(t) },
  { kind: "a long piece of pasted text", test: (t) => t.length > LONG_PASTE_CHARS || t.split("\n").length > LONG_PASTE_LINES },
];

/**
 * What private things a message seems to contain.
 *
 * @returns Plain-English kinds, in a fixed order; empty when nothing was found.
 */
export function findPrivateText(message: string): PrivateTextKind[] {
  return CHECKS.filter(({ test }) => test(message)).map(({ kind }) => kind);
}

/** The reminder shown before a message with private things in it is sent. */
export function privacyReminder(found: readonly PrivateTextKind[]): string {
  const list = found.length <= 1 ? (found[0] ?? "something private") : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
  return (
    `Before I send this: your message seems to include ${list}. ` +
    "Your messages are sent to an AI service so it can change your project, and only your project's code and this chat are needed. " +
    "If you're sure, send it again. Otherwise, take that part out first."
  );
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}

/** A 13–19 digit number that passes the Luhn check card numbers use. */
function isCardNumber(number: string): boolean {
  if (number.length < 13 || number.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
