/**
 * Obsidian Gold Design Tokens - Single Source of Truth
 */
export const TOKENS = {
  colors: {
    background: '#101010',
    surface: '#1B1B1B',
    surfaceElevated: '#242424',
    surfaceHover: '#2A2A2A',
    border: '#303030',
    borderStrong: '#454545',
    primary: '#D6AD60',
    primaryHover: '#E2BE7D',
    primaryActive: '#B88E46',
    primaryMuted: '#80683C',
    textPrimary: '#F5F1E8',
    textSecondary: '#B9B4AA',
    textMuted: '#858078',
    income: '#72B895',
    expense: '#D9827C',
    transfer: '#82A9CF',
    warning: '#E4B66D'
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '22px'
  },
  typography: {
    primary: "'Manrope', 'Manrope Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
    secondary: "'Inter', 'Manrope', 'Inter Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
  },
  breakpoints: {
    mobileSm: '360px',
    mobile: '390px',
    tablet: '768px',
    laptop: '1024px',
    desktop: '1440px'
  }
} as const;

export type DesignTokens = typeof TOKENS;
