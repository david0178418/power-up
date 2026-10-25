import { expect, test } from 'bun:test';
import type { GamepadLike } from 'ecspresso/plugins/input/input';
import { createGameBuilder, spawnLevel, PLAYER, START, STEP } from '../src/game';

class KeyEvent extends Event {
	readonly repeat = false;
	constructor(type: 'keydown' | 'keyup', readonly key: string) { super(type); }
}

const fixture = async function () {
	const target = new EventTarget();
	let pad: GamepadLike | null = null;
	const world = createGameBuilder({ target, gamepad: { poll: function () { return [null, null, pad]; } } }).build();
	await world.initialize();
	const level = spawnLevel(world);
	return {
		world, ...level,
		key: function (key: string, down: boolean) { target.dispatchEvent(new KeyEvent(down ? 'keydown' : 'keyup', key)); },
		pad: function (axis: number, buttons: number[] = []) {
			pad = { id: 'Simulated standard pad', connected: true, axes: [axis, 0], buttons: Array.from({ length: 16 }, function (_, index) {
				return { pressed: buttons.includes(index), value: Number(buttons.includes(index)) };
			}) };
		},
		disconnect: function () { pad = null; },
		step: function (count = 1) { for (let i = 0; i < count; i++) world.update(STEP); },
	};
};

test('keyboard movement, grounded jump, airborne rejection, held-jump landing, and stable rest', async () => {
	const game = await fixture();
	try {
		const { localTransform: position, velocity, player } = game.player.components;
		for (const [key, direction] of [['a', -1], ['ArrowLeft', -1], ['d', 1], ['ArrowRight', 1]] as const) {
			const before = position.x;
			game.key(key, true);
			game.step(6);
			expect(position.x - before).toBeCloseTo(direction * PLAYER.speed * STEP * 6);
			game.key(key, false);
			game.step();
			expect(velocity.x).toBe(0);
		}
		game.key(' ', true);
		// A short render frame must not consume an input edge before a fixed tick.
		game.world.update(STEP / 2);
		expect(position.y).toBe(START.y);
		game.world.update(STEP / 2);
		expect(position.y).toBeLessThan(START.y);
		expect(player.grounded).toBe(false);
		game.key(' ', false);
		game.step(5);
		const airborneVelocity = velocity.y;
		game.key(' ', true);
		game.step();
		expect(velocity.y).toBeGreaterThan(airborneVelocity);
		// Hold through landing, including a frame containing several fixed steps.
		game.world.update(STEP * 4);
		game.step(120);
		expect(player.grounded).toBe(true);
		expect(position.y).toBeCloseTo(START.y, 10);
		expect(velocity.y).toBe(0);
		game.step(600);
		expect(position.y).toBeCloseTo(START.y, 10);
		expect(velocity.y).toBe(0);
		game.key(' ', false);
		game.step();
		game.key(' ', true);
		game.step();
		expect(velocity.y).toBeLessThan(0);
	} finally { await game.world.dispose(); }
});

test('simulated gamepad stick, D-pad, primary jump, deadzone, and disconnect', async () => {
	const game = await fixture();
	try {
		const { velocity, player } = game.player.components;
		game.pad(0.1);
		game.step();
		expect(velocity.x).toBe(0);
		game.pad(1);
		game.step();
		expect(velocity.x).toBe(PLAYER.speed);
		game.pad(-1);
		game.step();
		expect(velocity.x).toBe(-PLAYER.speed);
		game.pad(0, [15]);
		game.step();
		expect(velocity.x).toBe(PLAYER.speed);
		game.pad(0, [14]);
		game.step();
		expect(velocity.x).toBe(-PLAYER.speed);
		game.pad(0, [0]);
		game.step();
		expect(velocity.y).toBeLessThan(0);
		expect(player.grounded).toBe(false);
		game.step(120);
		expect(player.grounded).toBe(true);
		expect(velocity.y).toBe(0);
		game.pad(1);
		game.step();
		game.disconnect();
		game.step();
		expect(velocity.x).toBe(0);
	} finally { await game.world.dispose(); }
});

test('walking off either edge clears grounded state and resets position and all velocity', async () => {
	for (const key of ['a', 'd']) {
		const game = await fixture();
		try {
			const { localTransform: position, velocity, player, force } = game.player.components;
			game.key(key, true);
			game.step(90);
			expect(player.grounded).toBe(false);
			expect(position.y).toBeGreaterThan(START.y);
			game.key(' ', true);
			game.step();
			expect(velocity.y).toBeGreaterThan(0);
			let reset = false;
			for (let tick = 0; tick < 120; tick++) {
				game.step();
				if (position.x === START.x && position.y === START.y) { reset = true; break; }
			}
			expect(reset).toBe(true);
			expect(velocity).toEqual({ x: 0, y: 0 });
			expect(force).toEqual({ x: 0, y: 0 });
			game.key(key, false);
			game.step();
			expect(player.grounded).toBe(true);
			expect(velocity.y).toBe(0);
		} finally { await game.world.dispose(); }
	}
});

test('camera translation and viewport size leave physics and the level reset boundary unchanged', async () => {
	const { createCameraPlugin } = await import('ecspresso/plugins/spatial/camera');
	const { LEVEL_BOUNDS } = await import('../src/game');
	const worlds = [
		createGameBuilder({ target: new EventTarget() }).withPlugin(createCameraPlugin({ viewportWidth: 960, viewportHeight: 540 })).build(),
		createGameBuilder({ target: new EventTarget() }).withPlugin(createCameraPlugin({ viewportWidth: 320, viewportHeight: 900, initial: { x: 10000, y: -2000 } })).build(),
	];
	try {
		for (const world of worlds) await world.initialize();
		const levels = worlds.map(function (world) { return spawnLevel(world); });
		for (const [index, world] of worlds.entries()) {
			const level = levels[index];
			if (!level) throw new Error('Missing test level.');
			world.mutateComponent(level.player.id, 'localTransform', function (position) {
				position.x = 900;
				position.y = LEVEL_BOUNDS.bottom + PLAYER.height - 1;
			});
			world.update(STEP);
			expect(level.player.components.localTransform.x).toBe(900);
			expect(level.player.components.localTransform.y).toBeGreaterThan(LEVEL_BOUNDS.bottom);
			world.getResource('cameraState').setPosition(-9000, 8000);
			world.update(STEP);
			expect(level.player.components.localTransform).toMatchObject(START);
			expect(level.player.components.velocity).toEqual({ x: 0, y: 0 });
			expect(level.player.components.force).toEqual({ x: 0, y: 0 });
		}
		expect(levels[0]?.player.components).toEqual(levels[1]?.player.components);
	} finally { for (const world of worlds) await world.dispose(); }
});

test('touch movement and simultaneous jump/attack preserve keyboard input and jump edges', async () => {
	const game = await fixture();
	try {
		const touch = game.world.getResource('touchInput');
		const { localTransform: position, velocity, player } = game.player.components;
		touch.move = 0.5;
		touch.attack = true;
		touch.jump = true;
		game.world.update(STEP / 2);
		expect(position.y).toBe(START.y);
		game.world.update(STEP / 2);
		expect(velocity.x).toBeGreaterThan(PLAYER.speed / 2);
		expect(velocity.y).toBeLessThan(0);
		expect(game.attack.components.combatVolume.active).toBe(true);
		touch.move = 0;
		touch.attack = false;
		game.step(13);
		game.key('a', true);
		game.step();
		expect(velocity.x).toBe(-PLAYER.speed);
		game.key('a', false);
		game.step(120);
		expect(game.attack.components.combatVolume.active).toBe(false);
		expect(player.grounded).toBe(true);
		expect(velocity.y).toBe(0);
		// A second source pressing jump while touch holds it is not a fresh press.
		game.key(' ', true);
		game.step();
		expect(velocity.y).toBe(0);
		touch.jump = false;
		game.step();
		expect(velocity.y).toBe(0);
		game.key(' ', false);
		game.step();
		touch.jump = true;
		game.step();
		expect(velocity.y).toBeLessThan(0);
	} finally { await game.world.dispose(); }
});
