// The deployed app sits behind CloudFront, which uses Origin Access Control (SigV4) to reach
// the Lambda Function URL. AWS requires the ORIGINAL client request to carry a precomputed
// SHA-256 hash of the body as x-amz-content-sha256 for any method that can have one - without
// it, CloudFront's own re-signing doesn't match what Lambda expects and every POST/PUT/PATCH/
// DELETE gets rejected with a signature-mismatch 403, even though GET/HEAD work fine (empty
// body, nothing to hash). A local dev server ignores this header entirely, so it's safe to
// always send it.
const METHODS_WITH_BODY_SIGNING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// SHA-256 of an empty string - required even for a body-less POST (e.g. speed-round create/
// ready), since the signature still covers "no bytes" rather than nothing at all.
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!METHODS_WITH_BODY_SIGNING.has(method)) {
    return fetch(input, init);
  }

  const bodyHash = typeof init.body === 'string' ? await sha256Hex(init.body) : EMPTY_BODY_SHA256;
  const headers = new Headers(init.headers);
  headers.set('x-amz-content-sha256', bodyHash);
  return fetch(input, { ...init, headers });
}
