import { describe, it, expect, afterEach } from 'vitest';
import { readReturnTarget } from '../returnTarget';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('readReturnTarget', () => {
  it('returns nothing when no return address was asked for', () => {
    window.history.replaceState(null, '', '/');
    expect(readReturnTarget()).toBeNull();
  });

  it('carries someone back to the gym tracker on its own hostname', () => {
    window.history.replaceState(
      null,
      '',
      '/?next=' + encodeURIComponent('https://gymtracker.12wy.duckdns.org/')
    );
    expect(readReturnTarget()).toBe('https://gymtracker.12wy.duckdns.org/');
  });

  it('accepts a same-origin path, which is how the tracker links back when served under /gym', () => {
    window.history.replaceState(null, '', '/?next=' + encodeURIComponent('/gym/'));
    expect(readReturnTarget()).toBe(`${window.location.origin}/gym/`);
  });

  // The rest of these are the reason this helper exists rather than reading the parameter
  // inline: a sign-in screen that forwards anywhere is an open redirect, and the fact that
  // the victim really did land on the genuine login page is what sells the next hop.
  it('refuses to forward to somebody else entirely', () => {
    window.history.replaceState(
      null,
      '',
      '/?next=' + encodeURIComponent('https://evil.example.com/harvest')
    );
    expect(readReturnTarget()).toBeNull();
  });

  it('refuses a lookalike host that merely ends with the real domain name', () => {
    window.history.replaceState(
      null,
      '',
      '/?next=' + encodeURIComponent('https://not-12wy.duckdns.org.evil.example/')
    );
    expect(readReturnTarget()).toBeNull();
  });

  it('refuses to downgrade an off-origin hop to plaintext', () => {
    window.history.replaceState(
      null,
      '',
      '/?next=' + encodeURIComponent('http://gymtracker.12wy.duckdns.org/')
    );
    expect(readReturnTarget()).toBeNull();
  });

  it('refuses a scripted scheme', () => {
    window.history.replaceState(null, '', '/?next=' + encodeURIComponent('javascript:alert(1)'));
    expect(readReturnTarget()).toBeNull();
  });

  it('ignores a malformed address rather than throwing on the sign-in screen', () => {
    window.history.replaceState(null, '', '/?next=%2F%2F%2F%2Fhttp:');
    expect(() => readReturnTarget()).not.toThrow();
  });
});
