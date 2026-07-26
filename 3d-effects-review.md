# 3D Effects Review

Scope: the reusable effects merged in PR #290 on July 26, 2026 (`theme.css` and `styleguide.html`). No JavaScript drives these effects.

## Findings

| Severity | File and line | Issue | Why it matters | Suggested one-line fix |
| --- | --- | --- | --- | --- |
| High | `theme.css:418` and `theme.css:424` | The raised card transitions a three-layer `box-shadow` together with its transform. | Interpolating shadows repaints the card on each animation frame and can visibly jank on lower-power or high-DPI devices. | Remove `box-shadow` from the transition and animate only `transform`, or fade a pre-rendered shadow pseudo-element with `opacity`. |
| Medium | `theme.css:367`, `theme.css:372`, `theme.css:379`, `theme.css:392`, `theme.css:422`, `theme.css:433`, `theme.css:444`, and `theme.css:447` | The examples stack perspective, nested `translateZ` layers, preserve-3D contexts, and an icon `drop-shadow`. | Reusing several patterns together can promote many compositing layers and increase GPU memory/raster work for decorative depth. | Limit each component to one 3D context and one shadow treatment, flattening nested child `translateZ` values where the difference is not visible. |
| Medium | `theme.css:463` | Reduced motion removes the transition and resets hover geometry, but the hover rule can still switch to the deeper shadow instantly. | The fallback avoids movement but still creates an abrupt depth flash for users who requested reduced motion. | Inside the reduced-motion query, also set `.vh-depth-interaction:hover` to the resting `box-shadow`. |
| High | `theme.css:450` and `styleguide.html:86` | The depth interaction is hover-only and is not gated to hover-capable pointers or mirrored for keyboard focus. | Touch devices can get sticky hover shadows, while keyboard users cannot trigger the documented interaction. | Wrap hover styling in `@media (hover: hover) and (pointer: fine)` and add an equivalent `.vh-depth-interaction:focus-visible` state. |
| Medium | `theme.css:458` | The mobile rule adjusts padding and headline size but leaves all perspective, tilt, nested depth, and hover styling active. | Small touch devices pay the compositing cost without a dependable hover interaction, so the effect does not degrade gracefully. | Add `@media (hover: none), (max-width: 680px)` rules that flatten card/icon transforms and use the resting shadow. |
| Medium | `theme.css:326` and `theme.css:391` | The orange accent `#ff6b45` has only about `2.6–2.7:1` contrast against the style-guide demo backgrounds. | It misses the WCAG AA `3:1` threshold for large text; the yellow shadow is decorative and does not provide a reliable contrasting outline. | Darken the accent to approximately `#d94828` or another tested color reaching at least `3:1` against every demo background stop. |

## Notes

- The remaining heading, body, card, and code-snippet text colors have adequate contrast against their current backgrounds.
- The audit is review-only and makes no production code changes.
