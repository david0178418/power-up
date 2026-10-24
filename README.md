# Power Up

A minimal Bun + TypeScript + ECSpresso platformer: one solid amber platform, one cyan player, and a non-colliding violet camera-review marker. No external artwork.

```sh
bun install --frozen-lockfile
bun run dev
```

Open the URL printed by Bun (normally http://localhost:3000). Click the browser page if keyboard focus is elsewhere. For LAN access, use `bun run dev --hostname=0.0.0.0`.

- Move: **A / D**, **Left / Right**, gamepad **left stick** or **D-pad**.
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

Simulation runs at 60 Hz with explicit ordering: input → player control → physics integration → collision resolution → fall reset. Gravity, motion, restitution-free collisions, transforms, grounded state, and reset all live in ECS components/systems. Physics collision normals establish ground contact after the built-in solver removes penetration and downward velocity. Input is sampled in `fixedUpdate` so jump edges survive render frames with no simulation tick and are consumed once across multiple ticks.

`src/view.ts` defines the 960×540 logical viewport separately from `LEVEL_BOUNDS` in `src/game.ts`. Fall reset still occurs at level bottom 540 plus player height, regardless of camera position or visible dimensions. ECSpresso's camera plugin stores the view center; renderer2D's `camera: true` applies it to the scene, and `screenScale: { mode: 'fit' }` provides uniform scaling and centered letterboxing. A Pixi mask clips world graphics to the logical viewport, including when panning into letterboxed areas. No custom renderer, collision solver, or game loop is needed. One small input integration fix releases tracked keyboard keys on window blur because the installed input plugin does not clear them itself.

The isolated `src/camera-review.ts` adapter adds temporary review buttons below the game: **Pan left/right** shifts the view by 160 world units, **Pan up/down** by 90, and **Reset view** restores the initial view. Press Pan right twice to reveal the violet marker at world (1120, 270). The marker has no entity, collider, or simulation effect; this does not expand the playable level. These controls do not establish future gameplay bindings. Camera follow, smoothing, shake, zoom controls, and aiming are deferred.

`src/coordinates.ts` exports `worldToScreen` and `screenToWorld`. Their camera argument is the world coordinate at the viewport's **top-left**, obtained by subtracting half the viewport size from ECSpresso's camera center. Screen points use browser **client CSS pixels**, matching `PointerEvent.clientX/clientY`; pass the canvas's current `getBoundingClientRect()` so page position, scrolling, canvas scaling, and centered letterboxing are included. The current adapter uses translation with fixed zoom 1 and rotation 0. Conversions extrapolate within letterbox margins rather than clamping and reject invalid/nonpositive geometry with `RangeError`. The review pointer draws a white ring in world space and shows its world/client coordinates; letterbox points map outside the view and the ring is clipped.

Dependencies are pinned in `package.json` and `bun.lock`: ECSpresso **0.24.1**, Pixi **8.22.0**. Integration was checked against the installed package exports, declarations, implementation, changelog, and the matching [v0.24.1 platformer example](https://github.com/DeeGeeGames/ecspresso/blob/v0.24.1/examples/platformer/platformer.ts) and [plugin documentation](https://github.com/DeeGeeGames/ecspresso/blob/v0.24.1/docs/built-in-plugins.md).

Validation covers keyboard movement, jump/landing, blocked airborne jumps, held-jump behavior, ten seconds of stable ground contact, both fall edges, and simulated gamepad stick/D-pad/button/deadzone/disconnection using the public `gamepad.poll` API. Browser checks cover rendering, movement/jump/reset, and desktop/portrait scaling. These are automated checks; physical controller compatibility and subjective feel still require hardware playtesting. Standard browser gamepad mapping is assumed; a controller may need a button press before the browser exposes it. Touch controls are outside scope.

Camera validation adds deterministic conversion/invalid-geometry cases and a headless reset test with different camera translations and viewport sizes. Production-browser checks at 1280×960 and 390×844 verify the off-screen marker, panning, pointer alignment, movement/jump/landing/reset, and blur cleanup. Portrait checks use desktop browser emulation, not physical mobile hardware.
