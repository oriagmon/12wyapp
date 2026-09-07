import { describe, it, expect, afterEach } from 'vitest';
import { readAndClearResetTokenFromUrl } from '../resetToken';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('readAndClearResetTokenFromUrl', () => {
  it('detects a token carried in the URL fragment (current format) and strips it, leaving a clean hash-free URL', () => {
    window.history.replaceState(null, '', '/#resetToken=abc123XYZ');
    const token = readAndClearResetTokenFromUrl();
    expect(token).toBe('abc123XYZ');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('abc123XYZ');
  });

  it('detects a legacy token carried in the query string, for backward compatibility with already-sent emails', () => {
    window.history.replaceState(null, '', '/?resetToken=legacy123');
    const token = readAndClearResetTokenFromUrl();
    expect(token).toBe('legacy123');
    expect(window.location.search).not.toContain('resetToken');
    expect(window.location.href).not.toContain('legacy123');
  });

  it('prefers the fragment over the query string when both are somehow present', () => {
    window.history.replaceState(null, '', '/?resetToken=legacyOne#resetToken=fragmentOne');
    const token = readAndClearResetTokenFromUrl();
    expect(token).toBe('fragmentOne');
  });

  it('preserves other query params while stripping only resetToken from the query string', () => {
    window.history.replaceState(null, '', '/?foo=bar&resetToken=abc123');
    readAndClearResetTokenFromUrl();
    expect(window.location.search).toContain('foo=bar');
    expect(window.location.search).not.toContain('resetToken');
  });

  it('preserves other fragment content while stripping only resetToken from the fragment', () => {
    window.history.replaceState(null, '', '/#other=1&resetToken=abc123');
    readAndClearResetTokenFromUrl();
    expect(window.location.hash).toContain('other=1');
    expect(window.location.hash).not.toContain('resetToken');
  });

  it('returns null and leaves the URL untouched when no token is present anywhere', () => {
    window.history.replaceState(null, '', '/?foo=bar');
    const token = readAndClearResetTokenFromUrl();
    expect(token).toBeNull();
    expect(window.location.search).toBe('?foo=bar');
  });

  it('URL-decodes a percent-encoded token', () => {
    window.history.replaceState(null, '', `/#resetToken=${encodeURIComponent('a+b/c=')}`);
    const token = readAndClearResetTokenFromUrl();
    expect(token).toBe('a+b/c=');
  });
});
