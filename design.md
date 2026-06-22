# Apple (Philippines)

## Mission
Create implementation-ready, token-driven UI guidance for Apple (Philippines) that is optimized for consistency, accessibility, and fast delivery across e-commerce storefront.

## Brand
- Product/brand: Apple (Philippines)
- URL: https://www.apple.com/ph/
- Audience: online shoppers and consumers
- Product surface: e-commerce storefront

## Style Foundations
- Visual style: clean, functional, implementation-oriented
- Main font style: `font.family.primary=SF Pro Text`, `font.family.stack=SF Pro Text, Myriad Set Pro, SF Pro Icons, Apple Legacy Chevron, Helvetica Neue, Helvetica, Arial, sans-serif`, `font.size.base=12px`, `font.weight.base=400`, `font.lineHeight.base=16.0005px`
- Typography scale: `font.size.xs=12px`, `font.size.sm=14px`, `font.size.md=17px`, `font.size.lg=21px`, `font.size.xl=28px`, `font.size.2xl=34px`, `font.size.3xl=40px`, `font.size.4xl=56px`
- Color palette: `color.surface.base=#000000`, `color.text.secondary=#1d1d1f`, `color.text.tertiary=#0066cc`, `color.text.inverse=#f5f5f7`, `color.surface.muted=#0071e3`, `color.surface.strong=#ffffff`
- Spacing scale: `space.1=3px`, `space.2=4px`, `space.3=5px`, `space.4=6px`, `space.5=8px`, `space.6=9px`, `space.7=9.6px`, `space.8=11px`
- Radius/shadow/motion tokens: `radius.xs=50px`, `radius.sm=980px` | `motion.duration.instant=100ms`, `motion.duration.fast=250ms`, `motion.duration.normal=320ms`, `motion.duration.slow=1000ms`

## Accessibility
- Target: WCAG 2.2 AA
- Keyboard-first interactions required.
- Focus-visible rules required.
- Contrast constraints required.

## Writing Tone
Concise, confident, implementation-focused.

## Rules: Do
- Use semantic tokens, not raw hex values, in component guidance.
- Every component must define states for default, hover, focus-visible, active, disabled, loading, and error.
- Component behavior should specify responsive and edge-case handling.
- Interactive components must document keyboard, pointer, and touch behavior.
- Accessibility acceptance criteria must be testable in implementation.

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
- Do not ship component guidance without explicit state rules.

## Guideline Authoring Workflow
1. Restate design intent in one sentence.
2. Define foundations and semantic tokens.
3. Define component anatomy, variants, interactions, and state behavior.
4. Add accessibility acceptance criteria with pass/fail checks.
5. Add anti-patterns, migration notes, and edge-case handling.
6. End with a QA checklist.

## Required Output Structure
- Context and goals.
- Design tokens and foundations.
- Component-level rules (anatomy, variants, states, responsive behavior).
- Accessibility requirements and testable acceptance criteria.
- Content and tone standards with examples.
- Anti-patterns and prohibited implementations.
- QA checklist.

## Component Rule Expectations
- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.
- Include known page component density: links (249), buttons (70), lists (54), inputs (2), navigation (2).

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Teams should prefer system consistency over local visual exceptions.
