import { expect, test } from 'bun:test';
import type { GamepadLike } from 'ecspresso/plugins/input/input';
import { createGameBuilder, spawnLevel, STEP } from '../src/game';

test('neutral menu controls allow a fresh attack immediately after resume', async function () {
	const target = new EventTarget();
	const world = createGameBuilder({ target }).build();
	try {
		await world.initialize();
		const level = spawnLevel(world);
		const pause = world.getResource('gamePause');
		pause.paused = true;
		world.update(STEP);
		pause.paused = false;
		const event = new Event('keydown');
		Object.defineProperty(event, 'key', { value: 'j' });
		target.dispatchEvent(event);
		world.update(STEP);
		expect(level.player.components.melee.active).toBe(true);
	} finally { await world.dispose(); }
});

test('menu pause freezes spawning, motion, damage and weapon clocks without consuming hit stop', async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		await world.setScreen('gameplay', {});
		const level = spawnLevel(world, 'gameplay');
		world.update(STEP * 10);
		world.getResource('touchInput').shoot = true;
		world.getResource('touchInput').beam = true;
		world.update(STEP);
		const pause = world.getResource('gamePause');
		pause.paused = true;
		world.getResource('hitStop').remaining = 0.05;
		const snapshot = function () {
			return structuredClone({
				positions: world.getEntitiesWithQuery(['localTransform']).map(function (entity) { return entity.components.localTransform; }),
				health: world.getEntitiesWithQuery(['health']).map(function (entity) { return entity.components.health; }),
				shots: world.getEntitiesWithQuery(['projectile']).map(function (entity) { return entity.components.projectile; }),
				beams: world.getEntitiesWithQuery(['playerBeam']).map(function (entity) { return entity.components.playerBeam; }),
				ground: world.getResource('groundSpawns'), flying: world.getResource('flyingSpawns'),
				ranged: level.player.components.ranged.remaining, hitStop: world.getResource('hitStop').remaining,
			});
		};
		const before = snapshot();
		for (let tick = 0; tick < 180; tick++) world.update(STEP);
		expect(snapshot()).toEqual(before);
		pause.paused = false;
		world.getResource('touchInput').shoot = false;
		world.getResource('touchInput').beam = false;
		world.update(STEP * 10);
		expect(world.getResource('hitStop').remaining).toBeLessThan(1e-9);
		expect(snapshot().ground.remaining).toBeLessThan(before.ground.remaining);
	} finally { await world.dispose(); }
});

for (const source of ['keyboard', 'touch', 'gamepad'] as const) {
	test(`menu input from ${source} cannot leak into gameplay until controls are released`, async function () {
		const target = new EventTarget();
		let held = false;
		const pad = function (): GamepadLike {
			return { connected: true, id: 'Standard test pad', axes: [held ? 1 : 0, 0], buttons: Array.from({ length: 16 }, function (_, index) {
				const pressed = held && [0, 1, 2, 3].includes(index);
				return { pressed, value: Number(pressed) };
			}) };
		};
		const world = createGameBuilder({ target, gamepad: { poll: function () { return source === 'gamepad' ? [pad()] : []; } } }).build();
		const keys = function (down: boolean) {
			for (const key of ['d', ' ', 'j', 'k', 'l']) {
				const event = new Event(down ? 'keydown' : 'keyup');
				Object.defineProperty(event, 'key', { value: key });
				target.dispatchEvent(event);
			}
		};
		const controls = function (down: boolean) {
			held = down;
			if (source === 'keyboard') keys(down);
			if (source === 'touch') Object.assign(world.getResource('touchInput'), { move: down ? 1 : 0, jump: down, attack: down, shoot: down, beam: down });
		};
		try {
			await world.initialize();
			await world.setScreen('test', {});
			const level = spawnLevel(world, 'test');
			world.update(STEP);
			const pause = world.getResource('gamePause');
			pause.paused = true;
			controls(true);
			world.update(STEP * 2);
			pause.paused = false;
			world.update(STEP * 10);
			expect(level.player.components.velocity).toEqual({ x: 0, y: 0 });
			expect(level.player.components.melee.queued).toBe(false);
			expect(level.player.components.melee.active).toBe(false);
			expect(level.player.components.ranged.remaining).toBe(0);
			expect(world.getEntitiesWithQuery(['playerBeam', 'combatVolume'])[0]?.components.combatVolume.active).toBe(false);
			controls(false);
			world.update(STEP);
			expect(pause.awaitingRelease).toBe(false);
			controls(true);
			world.update(STEP);
			expect(level.player.components.melee.active).toBe(true);
			expect(level.player.components.ranged.remaining).toBeGreaterThan(0);
			expect(world.getEntitiesWithQuery(['playerBeam', 'combatVolume'])[0]?.components.combatVolume.active).toBe(true);
		} finally { await world.dispose(); }
	});
}
