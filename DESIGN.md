# LaxmiLens Design System: Obsidian Gold

## 1. Aesthetic Direction & Philosophy

The **Obsidian Gold** design system is crafted specifically for high-trust personal finance applications. It pairs a deep, true-dark foundation with champagne gold highlights and restrained semantic accents to deliver a tactile, elegant, and distraction-free experience.

- **Theme Mode**: Dark-first (pure OLED-friendly black `#101010`).
- **Accent**: Refined champagne gold `#D6AD60`.
- **Personality**: Minimal, executive, precise, and secure.

---

## 2. Color Palette Specification

### Backgrounds & Surfaces
| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| `bg-obsidian-bg` | `#101010` | Root background for app shell and canvas |
| `bg-obsidian-surface` | `#1B1B1B` | Default card and panel surface |
| `bg-obsidian-elevated` | `#242424` | Modals, dropdown menus, and elevated cards |
| `bg-obsidian-hover` | `#2A2A2A` | Hover states on interactive surfaces |
| `border-obsidian-border` | `#303030` | Default structural borders and dividers |
| `border-obsidian-strong` | `#454545` | Emphasized dividers, focus borders, active card outlines |

### Gold Accents
| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| `gold-primary` | `#D6AD60` | Primary action buttons, active navigation markers, key stats |
| `gold-hover` | `#E2BE7D` | Hover state for gold action elements |
| `gold-active` | `#B88E46` | Pressed/active state for primary gold buttons |
| `gold-muted` | `#80683C` | Subtle borders, badges, and focus rings |

### Typography & Content
| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| `text-primary` | `#F5F1E8` | High-contrast body text, primary financial figures |
| `text-secondary` | `#B9B4AA` | Secondary labels, descriptions, and timestamps |
| `text-muted` | `#858078` | Placeholders, inactive icons, helper text |

### Semantic Financial Indicators
| Indicator | Hex Code | Semantic Purpose |
| :--- | :--- | :--- |
| `finance-income` | `#72B895` | Income transactions, positive cashflow indicators |
| `finance-expense` | `#D9827C` | Expense debits, negative budget warnings |
| `finance-transfer` | `#82A9CF` | Neutral account-to-account transfer transactions |
| `finance-warning` | `#E4B66D` | Budget threshold warnings, offline sync alerts |

---

## 3. Typography & Financial Number Formatting

- **Display Font**: `Manrope Variable` for titles, headers, card metrics, and key balance headlines.
- **Body & Interface Font**: `Inter Variable` for body copy, form fields, and navigation elements.
- **Tabular Numerals**: All monetary amounts and balances **must** utilize tabular figures (`font-tabular` / `font-variant-numeric: tabular-nums`). This guarantees decimal alignment in transaction ledgers and financial tables.
- **Currency Representation**: Standard Indian numbering system with the rupee symbol (e.g., `₹1,00,000.50`).

---

## 4. Accessibility & Interaction Rules

- **Contrast Ratios**: All primary text against surfaces maintains a minimum contrast ratio of 10.5:1 (well exceeding WCAG AAA). Secondary text maintains > 4.5:1 (WCAG AA).
- **Keyboard Navigation**: All interactive elements display a 2px outline in `--gold-primary` with a 2px offset.
- **Reduced Motion**: Respects `prefers-reduced-motion: reduce` by disabling transitions and animations globally.
- **Touch Targets**: Mobile navigation and touch actions enforce a minimum bounding box of 44×44px.
