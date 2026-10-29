// Scrubs secrets from anything that is about to be logged.
const PATTERNS: [RegExp, string][] = [
  [/(postgres(?:ql)?:\/\/[^:/\s@]+:)[^@\s]+@/gi, '$1****@'], // connection-string passwords
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1****'], // Authorization headers
  [/\boiq_[A-Za-z0-9_-]{20,}/g, 'oiq_****'], // our own session tokens
  [
    /("?(?:password|token|secret|authorization|x-service-key)"?\s*[:=]\s*)"?[^",\s}]+"?/gi,
    '$1"****"',
  ],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
