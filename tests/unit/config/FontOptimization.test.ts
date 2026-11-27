import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOKENS } from '@/styles/tokens';

const PROJECT_ROOT = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

describe('Phase 12 Stage 2D: Self-Hosted Font Loading & Offline Typography', () => {
  it('removes render-blocking Google Fonts requests from index.html and preloads only critical WOFF2', () => {
    const html = readProjectFile('index.html');

    expect(html).not.toMatch(/fonts\.googleapis\.com/i);
    expect(html).not.toMatch(/fonts\.gstatic\.com/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);

    const preloadMatches = html.match(/<link[^>]+rel=["']preload["'][^>]*>/gi) ?? [];
    expect(preloadMatches).toHaveLength(1);
    expect(preloadMatches[0]).toContain('href="/fonts/manrope-latin-wght.woff2"');
    expect(preloadMatches[0]).toContain('as="font"');
    expect(preloadMatches[0]).toContain('type="font/woff2"');
    expect(preloadMatches[0]).toMatch(/\bcrossorigin\b/);
  });

  it('defines @font-face rules for Manrope (including ₹ unicode-range) and Inter with font-display swap and metric fallbacks', () => {
    const indexCss = readProjectFile('src/styles/index.css');
    const fontsCss = readProjectFile('src/styles/fonts.css');
    const themeCss = readProjectFile('src/styles/theme.css');

    expect(indexCss).toContain('@import "./fonts.css";');
    expect(indexCss.indexOf('@import "./fonts.css";')).toBeLessThan(
      indexCss.indexOf('@import "./theme.css";')
    );

    expect(fontsCss).not.toMatch(/https?:\/\//i);
    expect(themeCss).not.toMatch(/https?:\/\//i);

    // Self-hosted Manrope (latin + latin-ext containing U+20B9 Rupee sign) and Inter
    expect(fontsCss).toContain("font-family: 'Manrope'");
    expect(fontsCss).toContain("url('/fonts/manrope-latin-wght.woff2') format('woff2')");
    expect(fontsCss).toContain("url('/fonts/manrope-latin-ext-wght.woff2') format('woff2')");
    expect(fontsCss).toContain('U+20AD-20C0');
    expect(fontsCss).toContain('font-weight: 400 800');

    expect(fontsCss).toContain("font-family: 'Inter'");
    expect(fontsCss).toContain("url('/fonts/inter-latin-wght.woff2') format('woff2')");
    expect(fontsCss).toContain('font-weight: 400 700');

    expect(fontsCss).toContain('font-display: swap');

    // Metric-matched fallbacks to suppress vertical layout shift during swap
    expect(fontsCss).toContain("font-family: 'Manrope Fallback'");
    expect(fontsCss).toContain("font-family: 'Inter Fallback'");
    expect(fontsCss).toContain('ascent-override:');
    expect(fontsCss).toContain('descent-override:');
    expect(fontsCss).toContain('line-gap-override:');

    // Theme variables & JS design tokens preserve Obsidian Gold font families + metric fallbacks
    expect(themeCss).toContain("'Manrope', 'Manrope Fallback'");
    expect(themeCss).toContain("'Inter', 'Manrope', 'Inter Fallback'");
    expect(TOKENS.typography.primary).toContain('Manrope');
    expect(TOKENS.typography.primary).toContain('Manrope Fallback');
    expect(TOKENS.typography.secondary).toContain('Inter');
  });

  it('stores valid WOFF2 font files and SIL OFL licenses in public/fonts', () => {
    const expectedFonts = [
      'manrope-latin-wght.woff2',
      'manrope-latin-ext-wght.woff2',
      'inter-latin-wght.woff2'
    ];

    for (const file of expectedFonts) {
      const fullPath = path.join(PROJECT_ROOT, 'public', 'fonts', file);
      expect(fs.existsSync(fullPath)).toBe(true);

      const bytes = fs.readFileSync(fullPath);
      expect(bytes.length).toBeGreaterThan(5_000);
      // Valid WOFF2 signature bytes: 'wOF2'
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    }

    const manropeLicense = readProjectFile('public/fonts/OFL-Manrope.txt');
    const interLicense = readProjectFile('public/fonts/OFL-Inter.txt');
    expect(manropeLicense).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(interLicense).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('keeps VitePWA Workbox woff2 precaching and static asset navigateFallbackDenylist intact', () => {
    const viteConfig = readProjectFile('vite.config.ts');

    expect(viteConfig).toContain("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']");
    expect(viteConfig).toContain('woff2?');
    expect(viteConfig).toContain('/^\\/api\\//');
    expect(viteConfig).toContain('/^\\/auth\\//');
    expect(viteConfig).toContain('/^\\/assets\\//');
    expect(viteConfig).toContain('supabase');
  });
});
