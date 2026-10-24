# Power Up

A minimal Bun + TypeScript + ECSpresso platformer: one solid amber platform, one cyan player, three stationary rose enemy targets, and a non-colliding violet camera-review marker. No external artwork.

```sh
bun install --frozen-lockfile
bun run dev
```

Open the URL printed by Bun (normally http://localhost:3000). Click the browser page if keyboard focus is elsewhere. For LAN access, use `bun run dev --hostname=0.0.0.0`.

- Move: **A / D**, **Left / Right**, gamepad **left stick** or **D-pad**.
- Attack fixture: hold **J** or gamepad **button 2** (standard left face button). Faces the last movement direction.
- Jump: **Space** or the gamepad **primary face button** (standard button 0).
- Jump requires ground contact and a fresh press. Airborne presses are discarded; holding jump does not repeat it.
- Falling below the world returns the player to the middle of the platform with velocity and force reset. Held movement resumes on the next tick.

```sh
bun run typecheck  # TypeScript
bun test           # deterministic ECS/input/physics scenarios
bun run build      # production output in dist/
bun run preview    # serve the production output at http://localhost:3000
bun run check      # all three
```

Development uses Bun's native HTML server with automatic bundling and reloads. Production uses `Bun.build()` with `index.html` as the entry point, minification, and external source maps. Preview uses `Bun.serve()` to serve the built files directly; set `PORT` to choose another preview port. This follows Math Marsh's native Bun approach without its project-specific packaging or asset plugins.

TypeScript enables `strict` and all additional type-checking diagnostics: exact optional properties, checked indexed access, index-signature access restrictions, explicit overrides, complete returns, switch fallthrough checks, unused declarations, unreachable code, and unused labels. Side-effect imports, import casing, and isolated module transpilation are checked too. These apply to `src`, `tests`, and `scripts`. `skipLibCheck` remains enabled because Pixi's installed bitmap-font declaration fails exact optional-property checking. Dependency declarations are skipped; application code and its use of dependency APIs remain checked.

`src/main.ts` composes the browser application and owns startup, graphics, focus cleanup, page teardown, and Bun hot-reload disposal. ECSpresso's managed `renderer2D` owns Pixi and its ticker; the world owns input listeners. `src/game.ts` composes transform, input, physics, and a small gameplay plugin. Tests use the same simulation without a renderer.

Simulation runs at 60 Hz with explicit ordering: input → player control → physics integration → collision resolution → fall reset → transform propagation → combat detection. Gravity, motion, restitution-free collisions, transforms, grounded state, and reset all live in ECS components/systems. Physics collision normals establish ground contact after the built-in solver removes penetration and downward velocity. Input is sampled in `fixedUpdate` so jump edges survive render frames with no simulation tick and are consumed once across multiple ticks.

`src/view.ts` defines the 960×540 logical viewport separately from `LEVEL_BOUNDS` in `src/game.ts`. Fall reset still occurs at level bottom 540 plus player height, regardless of camera position or visible dimensions. ECSpresso's camera plugin stores the view center; renderer2D's `camera: true` applies it to the scene, and `screenScale: { mode: 'fit' }` provides uniform scaling and centered letterboxing. A Pixi mask clips world graphics to the logical viewport, including when panning into letterboxed areas. No custom renderer, collision solver, or game loop is needed. One small input integration fix releases tracked keyboard keys on window blur because the installed input plugin does not clear them itself.

The isolated `src/camera-review.ts` adapter adds temporary review buttons below the game: **Pan left/right** shifts the view by 160 world units, **Pan up/down** by 90, and **Reset view** restores the initial view. Press Pan right twice to reveal the violet marker at world (1120, 270). The marker has no entity, collider, or simulation effect; this does not expand the playable level. These controls do not establish future gameplay bindings. Camera follow, smoothing, shake, zoom controls, and aiming are deferred.

`src/coordinates.ts` exports `worldToScreen` and `screenToWorld`. Their camera argument is the world coordinate at the viewport's **top-left**, obtained by subtracting half the viewport size from ECSpresso's camera center. Screen points use browser **client CSS pixels**, matching `PointerEvent.clientX/clientY`; pass the canvas's current `getBoundingClientRect()` so page position, scrolling, canvas scaling, and centered letterboxing are included. The current adapter uses translation with fixed zoom 1 and rotation 0. Conversions extrapolate within letterbox margins rather than clamping and reject invalid/nonpositive geometry with `RangeError`. The review pointer draws a white ring in world space and shows its world/client coordinates; letterbox points map outside the view and the ring is clipped.

Dependencies are pinned in `package.json` and `bun.lock`: ECSpresso **0.24.1**, Pixi **8.22.0**. Integration was checked against the installed package exports, declarations, implementation, changelog, and the matching [v0.24.1 platformer example](https://github.com/DeeGeeGames/ecspresso/blob/v0.24.1/examples/platformer/platformer.ts) and [plugin documentation](https://github.com/DeeGeeGames/ecspresso/blob/v0.24.1/docs/built-in-plugins.md).

## Combat overlap primitive

`src/combat.ts` provides `createCombatVolume(ownerId, kind, width, height, x, y, active)` and the `combat` plugin. Spawn the returned components with `world.spawnChild(ownerId, ...)`. Each attack/hurtbox is an independent entity with a `combatVolume`, transform, AABB collider, and attack/hurtbox collision layer; it has **no rigid body**. Owner movement colliders remain separate. Installed ECSpresso 0.24.1's detection-only collision plugin handles overlap tests; its physics solver only queries rigid bodies, so these volumes cannot resolve physical collisions. No new dependency or custom detector is needed.

Set `combatVolume.active` to enable/disable either volume; use `removeEntity(volumeId)` to remove it. Default owner removal cascades to its children. Contact forwarding also validates both owners exist, including non-cascading owner removal. Removing a volume's `combatVolume` component stops combat forwarding. No previous-contact cache is retained by the primitive.

`combatContact` is a synchronous, transient event with `{ attackId, ownerId, hurtboxId, targetId }`, once per overlapping attack/hurtbox pair on **every fixed simulation tick**, including sustained overlaps. There are no enter/exit events, deduplication across ticks, or contacts on frames with zero fixed ticks. Multiple fixed ticks in one render frame each report contacts. `combatScan` marks the start of each detection pass for presentation consumers. Consumers retaining events own their history and must revalidate identities before later use. The review adapter clears its display per scan and checks activation/existence again before drawing.

Geometry is the library's smallest supported primitive: world-axis AABBs with positive width and height. Edge touching does not count as overlap. Parent hierarchy translation, rotation, and scale affect the attached **center**; the installed detector keeps dimensions and collider offsets in world units, without rotating or scaling the box. Debug outlines draw these same world-space rectangles inside the existing camera root and viewport mask. They can be toggled without affecting detection. Detection samples after physics and reset on each tick; swept/continuous projectile collision is deferred.

The fixture places one enemy in reach of the initial right-facing attack and two farther away. Enemies are stationary, non-blocking targets with hurtboxes and no damage, health, attacks, or AI. Hold J without moving: the near enemy turns gold and the status reports all contact identities while both bodies stay still. Release J to deactivate. Move through or past targets, turn left, jump, and pan the camera to inspect alignment; uncheck **Show combat outlines** to hide only the debug overlay. Input controls the player's fixture attack activation directly; this is not a swing duration/cooldown or a damage cadence. Teams, self-hit filtering, invulnerability, knockback, combos, and once-per-swing damage remain future combat rules.

`tests/combat.test.ts` covers strict overlap, activation of both kinds, identity, consecutive/multiple/zero fixed ticks, parent transform propagation, volume/component/owner removal (including non-cascading removal), unchanged motion of two overlapping dynamic bodies, and keyboard/gamepad fixture activation/facing/reset. Existing movement and camera tests remain in place.

## CI and protected delivery

`.github/workflows/ci.yml` runs on every pull request targeting `master` and every push to `master`, including documentation-only changes. Three independent jobs publish the exact check names `tests` (`bun test`), `typecheck` (`bun run typecheck`), and `build` (`bun run build`). Each installs Bun **1.3.14** and runs `bun install --frozen-lockfile`; actions are pinned to commit SHAs and workflow permissions are limited to `contents: read`. There are no path filters or conditional job skips.

The live classic branch-protection rule for `master` requires a pull request and all three checks from the **GitHub Actions app (ID 15368)**. Strict status checking requires the branch to be up to date. Protection applies to administrators, has no PR bypass allowances, prevents force pushes and deletion, and requires review conversations to be resolved. No additional approving-review count is imposed. Native repository auto-merge is enabled; use the existing **squash** merge method without an admin override or merge queue. These settings are held by GitHub, not applied by the workflow; inspect them live before relying on them.

Before delivering an authorized implementation PR:

1. Finish review, repairs, local checks, and any owner-required acceptance. Required reviews, unresolved findings, conflicts, and explicit leave-open instructions still prevent automatic delivery.
2. Fetch the current `master` and read the PR head SHA. Query `gh api repos/david0178418/power-up/branches/master/protection`, `gh api repos/david0178418/power-up/rules/branches/master`, and `gh api repos/david0178418/power-up/rulesets` for active enforcement and any additional rules. Query the repository for `allow_auto_merge` and permitted merge methods.
3. Match every required context and source app against check runs for the current head (`gh api repos/david0178418/power-up/commits/HEAD_SHA/check-runs`) and `gh pr view NUMBER --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision`. Require completed **success** for every required check; missing, pending, failed, cancelled, skipped, and neutral results are insufficient. A changed head requires fresh verification; results from an earlier head do not qualify.
4. Once all requirements are satisfied, use normal GitHub auto-merge with an expected-head guard: `gh pr merge NUMBER --auto --squash --match-head-commit HEAD_SHA`. Never bypass protection. Verify eventual `mergedAt` and `mergeCommit` with `gh pr view`, and record the result in the PR description. Auto-merge being enabled or queued does not establish that a PR merged.

Standing automatic-merge authorization covers only PRs created for authorized work. It does not cover arbitrary PRs or releases. If protection cannot be verified or any requirement is unmet, leave the PR open; if enforcement cannot be established, leave repository auto-merge disabled.

Setup validation on 2026-10-24 used [PR #6](https://github.com/david0178418/power-up/pull/6). Initial head `8f0ca29` passed all three checks. A temporary failing test on head `f584853` produced a failed `tests` check in [run 40134703840](https://github.com/david0178418/power-up/actions/runs/40134703840); the normal REST squash-merge endpoint, guarded by that exact head SHA, refused with HTTP 405: `2 of 3 required status checks have not succeeded: 1 failing.` The new head was blocked despite the previous head's successful checks. The temporary test was then removed. The PR description records final recovery checks and merge evidence.

Validation covers keyboard movement, jump/landing, blocked airborne jumps, held-jump behavior, ten seconds of stable ground contact, both fall edges, and simulated gamepad stick/D-pad/button/deadzone/disconnection using the public `gamepad.poll` API. Browser checks cover rendering, movement/jump/reset, and desktop/portrait scaling. These are automated checks; physical controller compatibility and subjective feel still require hardware playtesting. Standard browser gamepad mapping is assumed; a controller may need a button press before the browser exposes it. Touch controls are outside scope.

Camera validation adds deterministic conversion/invalid-geometry cases and a headless reset test with different camera translations and viewport sizes. Production-browser checks at 1280×960 and 390×844 verify the off-screen marker, panning, pointer alignment, movement/jump/landing/reset, and blur cleanup. Portrait checks use desktop browser emulation, not physical mobile hardware.
