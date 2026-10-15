/**
 * The only place in the app that reads process.env.
 * The key is optional (it only raises data.gov.sg's rate limit) and never leaves the server.
 */
export function getApiKey(): string | null {
  const key = process.env.DATAGOV_API_KEY?.trim();
  return key ? key : null;
}

export function isKeyConfigured(): boolean {
  return getApiKey() !== null;
}
