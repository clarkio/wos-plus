/**
 * URL validation utilities for preventing open redirect vulnerabilities
 */

/**
 * List of allowed internal paths for redirects
 * Only paths in this list (or starting with these prefixes) are allowed
 */
const ALLOWED_REDIRECT_PATHS = [
  '/player',
  '/streamer',
  '/',
];

/**
 * Validates and sanitizes a return URL to prevent open redirect attacks
 *
 * @param url - The URL to validate (can be full URL, path, or relative)
 * @param defaultPath - The path to return if validation fails (default: '/')
 * @returns A safe, validated path that starts with '/'
 */
export function validateReturnUrl(url: string | null | undefined, defaultPath: string = '/'): string {
  // Handle null/undefined/empty
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return defaultPath;
  }

  const trimmed = url.trim();

  // Block protocol-relative URLs (//evil.com)
  if (trimmed.startsWith('//')) {
    return defaultPath;
  }

  // Block dangerous URL schemes - check with regex for case-insensitive matching
  // This prevents javascript:, data:, vbscript:, and other dangerous schemes
  const dangerousSchemePattern = /^[a-z-]+:/i;
  if (dangerousSchemePattern.test(trimmed) &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('HTTP://') &&
    !trimmed.startsWith('HTTPS://')) {
    return defaultPath;
  }

  // Try to extract just the path if it's a full URL
  let pathname: string;
  try {
    // If it starts with http:// or https://, parse it and extract path
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      pathname = parsed.pathname + parsed.search;
    } else if (trimmed.startsWith('/')) {
      // Already a path, use as-is but verify no protocol injection
      pathname = trimmed;
    } else {
      // Relative path without leading slash - reject
      return defaultPath;
    }
  } catch {
    // Invalid URL format
    return defaultPath;
  }

  // Normalize the path (remove double slashes, decode, etc.)
  pathname = normalizePath(pathname);

  // Must start with /
  if (!pathname.startsWith('/')) {
    return defaultPath;
  }

  // Check against allowed paths
  if (!isAllowedPath(pathname)) {
    return defaultPath;
  }

  return pathname;
}

/**
 * Normalizes a path by removing double slashes and handling edge cases
 */
function normalizePath(path: string): string {
  // Replace multiple slashes with single slash
  let normalized = path.replace(/\/+/g, '/');

  // Remove any backslash encoding tricks
  normalized = normalized.replace(/\\/g, '/');

  // Limit length to prevent abuse
  if (normalized.length > 500) {
    normalized = normalized.substring(0, 500);
  }

  return normalized;
}

/**
 * Checks if a path is in the allowed list
 */
function isAllowedPath(path: string): boolean {
  // Extract just the pathname without query string for checking
  const pathOnly = path.split('?')[0].split('#')[0];

  // Check exact match first
  if (ALLOWED_REDIRECT_PATHS.includes(pathOnly)) {
    return true;
  }

  // Check if it starts with any allowed path prefix (for paths like /player?foo=bar)
  for (const allowed of ALLOWED_REDIRECT_PATHS) {
    // Handle root path specially - only allow exact match or with query string
    if (allowed === '/') {
      if (pathOnly === '/' || path.startsWith('/?')) {
        return true;
      }
      continue;
    }

    // For other paths, allow the path itself or paths starting with it followed by / or ?
    if (pathOnly === allowed || pathOnly.startsWith(allowed + '/')) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a nested returnUrl from a URL that might be the login-required page
 * e.g., /?login=required&returnUrl=/player -> /player
 */
export function extractNestedReturnUrl(url: string, defaultPath: string = '/player'): string {
  try {
    const parsed = new URL(url, 'https://example.invalid');

    // Check if this is the login-required redirect URL
    if (parsed.pathname === '/' && parsed.searchParams.get('login') === 'required') {
      const embeddedReturnUrl = parsed.searchParams.get('returnUrl');
      if (embeddedReturnUrl) {
        // Validate the embedded URL too
        return validateReturnUrl(embeddedReturnUrl, defaultPath);
      }
    }

    // Not a nested URL, validate as-is
    return validateReturnUrl(url, defaultPath);
  } catch {
    return defaultPath;
  }
}
