# OFFBEAT Design System

## Brand
OFFBEAT is an editorial discovery brand for independent culture. It should feel like a carefully curated culture magazine crossed with a modern community product—not a generic crypto dashboard.

Tagline: **Discover differently. Reward discovery.**

## Visual direction
- Near-black editorial canvas.
- Warm white text, muted grey metadata.
- Violet/lavender accent for brand and primary actions.
- Acid-lime reserved for verified/success states, not decoration.
- Artwork is the hero; UI chrome should stay quiet.
- Large editorial headlines, asymmetric layouts, generous spacing.
- Crisp borders, subtle surface contrast, restrained shadows.
- Small, deliberate motion; honor reduced-motion preferences.

## Suggested tokens
```css
:root {
  --bg: #0B0B0F;
  --surface: #14141B;
  --surface-raised: #1B1B24;
  --border: #2B2B36;
  --text: #F4F1F8;
  --text-muted: #A6A2B3;
  --accent: #A78BFA;
  --accent-strong: #8B5CF6;
  --success: #B7F171;
  --warning: #F6C76B;
  --danger: #F28B82;
  --radius-card: 18px;
  --radius-control: 12px;
}
```

## Typography
- Display: a distinctive open-source editorial font if setup time permits; otherwise use a bold modern sans-serif.
- UI: Inter or system sans-serif.
- Headlines should be large but not oversized to the point of wasting viewport.
- Body copy must be readable at 14–18 px.
- Use tabular numerals for balances, scores, and timestamps.

## Layout
- Desktop content max width around 1280 px.
- Responsive 12-column grid on wide screens; single-column-first on mobile.
- Header: logo, Discover, Communities, Impact, Connect wallet.
- Main feed: editorial featured recommendation + compact recommendation grid.
- Cards: artwork, category, creator, curator's reason, useful action, impact indicator.
- Dashboard: one clear primary action, a small number of meaningful metrics, transparent tables.
- Mobile: sticky bottom navigation only if it improves the flow; avoid cramped data tables.

## Component patterns
- `Button`: primary, secondary, ghost, danger; clear loading/disabled states.
- `Badge`: category, verified, pending, demo.
- `RecommendationCard`: image, category, title, creator, curator, reason, impact.
- `ScoreBreakdown`: quality/novelty/impact bars and plain-language explanations.
- `RewardPoolCard`: funding status, remaining balance, eligible contributions.
- `TransactionStatus`: pending/success/failure and explorer link only when real.
- `EmptyState`: helpful action, not just “no data”.
- `Toast`: concise success/error; never hide critical transaction status in a toast alone.
- `Skeleton`: stable layout while loading.

## Interaction rules
- All actions have visible feedback.
- Forms validate on both client and server.
- Disable double submission while a transaction/check-in is pending.
- Explain wallet/network requirements before asking for a signature.
- Never use a fake transaction hash.
- Use labels and helper text for technical terms.
- Support keyboard navigation, focus visibility, semantic controls, and sufficient contrast.
- Avoid motion if `prefers-reduced-motion` is enabled.

## Content voice
Friendly, confident, concise, culture-first.
Good: “A curator sent 8 people to this event.”
Better with caveat: “8 verified check-ins were attributed to this recommendation.”
Avoid: “Guaranteed viral growth”, “fraud-proof rewards”, “AI knows what is culturally valuable”.

## Demo data
Use believable, fictional/sample artists and clearly mark them as demo content unless you have permission to use real people/assets. Use high-quality royalty-free images or stable local assets. Do not hotlink random images as a production dependency.
