import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const localFile = (relative: string) => new URL(relative, import.meta.url);
const source = (relative: string) => readFileSync(localFile(relative), 'utf8');

describe('local mobile shell assets', () => {
  it('has a scoped standalone manifest with no account data in its launch URL', () => {
    const manifest = JSON.parse(source('../../public/manifest.webmanifest'));
    expect(manifest).toMatchObject({
      id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'he', dir: 'rtl',
      theme_color: '#0e1013', background_color: '#0e1013',
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ src: '/app-icon-512.png', sizes: '512x512', type: 'image/png' }),
    ]));
  });

  it.each([192, 512])('provides a real %i-pixel local PNG icon', (size) => {
    const icon = readFileSync(localFile(`../../public/app-icon-${size}.png`));
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(icon.readUInt32BE(16)).toBe(size);
    expect(icon.readUInt32BE(20)).toBe(size);
  });

  it('declares safe-area viewport, theme-color and home-screen metadata without an offline claim', () => {
    const html = source('../../index.html');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('name="theme-color" content="#0e1013"');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).not.toMatch(/serviceWorker|offline/i);
  });

  it('keeps touch targets, Hebrew wrapping and local grid scrolling explicit in mobile CSS', () => {
    const global = source('../styles/global.css');
    const today = source('../components/TodayList.module.css');
    const weekly = source('../components/WeeklyGrid.module.css');
    const page = source('../pages/DashboardPage.module.css');
    const nav = source('../components/MobileNavigation.module.css');
    expect(global).toContain('overflow-x: clip');
    expect(global).toContain('min-height: 44px');
    expect(global).toContain('prefers-reduced-motion: reduce');
    expect(today).toContain('repeat(4, minmax(44px, 1fr))');
    expect(today).toContain('overflow-wrap: anywhere');
    expect(weekly).toContain('overflow-x: auto');
    expect(weekly).toContain('white-space: normal');
    expect(page).toContain('100px + env(safe-area-inset-bottom)');
    expect(nav).toContain('env(safe-area-inset-bottom)');
    expect(nav).toContain('minmax(0, 1fr)');
    expect(nav).toContain('max-height: calc(85dvh');
    expect(nav).toContain('overflow-y: auto');
  });

  it('releases route containing blocks after entrance and immediately for nested fixed dialogs', () => {
    const global = source('../styles/global.css');
    const routeRules = [...global.matchAll(/\.motion-route[^{}]*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(routeRules.length).toBeGreaterThan(2);
    for (const rule of routeRules) {
      expect(rule).not.toMatch(/\b(transform|filter|will-change)\s*:/);
      expect(rule).not.toMatch(/\b(forwards|both)\b/);
    }
    expect(global).toMatch(/@keyframes route-enter\s*\{\s*from\s*\{[^}]*\}\s*to\s*\{[^}]*transform: none;\s*\}\s*\}/);
    expect(global).toContain(".motion-route:has([aria-modal='true'], dialog[open])");
    expect(global).toContain('animation: none !important');
  });
});
