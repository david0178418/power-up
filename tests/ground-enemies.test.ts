import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, ENEMY, GROUND_ENEMY, PLATFORM, START, STEP } from '../src/game';

const fixture = async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	await world.initialize();
	await world.setScreen('gameplay', {});
	const level = spawnLevel(world, 'gameplay');
	const step = function (count = 1) { for (let i = 0; i < count; i++) world.update(STEP); };
	return { world, level, step };
};

test('ground enemies spawn from alternating sides on fixed ticks, chase and stop beside the player', async () => {
	const { world, level, step } = await fixture();
	try {
		world.update(0);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(0);
		step();
		const first = world.getEntitiesWithQuery(['groundChaser', 'localTransform', 'velocity'])[0];
		if (!first) throw new Error('Missing first ground enemy.');
		expect(first.components.localTransform.x).toBeLessThan(START.x);
		expect(first.components.velocity.x).toBe(GROUND_ENEMY.speed);
		const before = first.components.localTransform.x;
		step(30);
		expect(first.components.localTransform.x - before).toBeCloseTo(GROUND_ENEMY.speed / 2);
		step(89);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(1);
		step();
		const second = world.getEntitiesWithQuery(['groundChaser', 'localTransform', 'velocity'])[1];
		if (!second) throw new Error('Missing second ground enemy.');
		expect(second.components.localTransform.x).toBeGreaterThan(START.x);
		expect(second.components.velocity.x).toBe(-GROUND_ENEMY.speed);
		step(600);
		expect(first.components.velocity.x).toBe(0);
		expect(second.components.velocity.x).toBe(0);
		expect(level.player.components.localTransform).toMatchObject(START);
		expect(world.getEntitiesWithQuery(['groundChaser']).length).toBeLessThanOrEqual(GROUND_ENEMY.limit);
	} finally { await world.dispose(); }
});

test('pursuit reverses with the player, stays grounded during jumps, and guards both platform edges', async () => {
	const { world, level, step } = await fixture();
	try {
		step();
		const enemy = world.getEntitiesWithQuery(['groundChaser', 'localTransform', 'velocity'])[0];
		if (!enemy) throw new Error('Missing ground enemy.');
		const groundY = PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2;
		for (const targetX of [-500, 1500]) {
			world.mutateComponent(level.player.id, 'localTransform', function (p) { p.x = targetX; p.y = 120; });
			world.mutateComponent(level.player.id, 'velocity', function (v) { v.y = -300; });
			step();
			expect(Math.sign(enemy.components.velocity.x)).toBe(Math.sign(targetX - enemy.components.localTransform.x));
			expect(enemy.components.localTransform.y).toBeCloseTo(groundY);
			for (let tick = 0; tick < 300; tick++) {
				// Hold an airborne target beyond the edge without triggering player fall reset.
				world.mutateComponent(level.player.id, 'localTransform', function (p) { p.x = targetX; p.y = 120; });
				world.mutateComponent(level.player.id, 'velocity', function (v) { v.y = 0; });
				step();
			}
			expect(enemy.components.localTransform.x).toBeGreaterThanOrEqual(PLATFORM.x - PLATFORM.width / 2 + ENEMY.width / 2);
			expect(enemy.components.localTransform.x).toBeLessThanOrEqual(PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2);
			expect(enemy.components.localTransform.y).toBeCloseTo(groundY);
			expect(enemy.components.velocity.y).toBe(0);
		}
	} finally { await world.dispose(); }
});

test('spawn cap bounds a long run and removed enemies can be replaced', async () => {
	const { world, step } = await fixture();
	try {
		step(2400);
		const enemies = world.getEntitiesWithQuery(['groundChaser']);
		expect(enemies).toHaveLength(GROUND_ENEMY.limit);
		const removed = enemies[0];
		if (!removed) throw new Error('Missing ground enemy.');
		const volumes = world.getEntitiesWithQuery(['combatVolume']).filter(function (e) { return e.components.combatVolume.ownerId === removed.id; });
		world.removeEntity(removed.id);
		for (const volume of volumes) expect(world.getEntity(volume.id)).toBeUndefined();
		step(120);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(GROUND_ENEMY.limit);
	} finally { await world.dispose(); }
});

test('solid enemy boxes stay separate through crowding, pursuit reversals and knockback at both edges', async () => {
	const { world, level, step } = await fixture();
	try {
		let maximumOverlap = 0;
		let outsidePlatform = false;
		const advance = function (ticks: number, targetX?: number) {
			for (let tick = 0; tick < ticks; tick++) {
				if (targetX !== undefined) {
					world.mutateComponent(level.player.id, 'localTransform', function (p) { p.x = targetX; p.y = 120; });
					world.mutateComponent(level.player.id, 'velocity', function (v) { v.y = 0; });
				}
				step();
				const positions = world.getEntitiesWithQuery(['groundChaser', 'localTransform'])
					.map(function (e) { return e.components.localTransform; }).sort(function (a, b) { return a.x - b.x; });
				for (const [index, position] of positions.entries()) {
					const previous = positions[index - 1];
					if (previous && Math.abs(position.y - previous.y) < ENEMY.height) {
						maximumOverlap = Math.max(maximumOverlap, ENEMY.width - (position.x - previous.x));
					}
					outsidePlatform ||= position.x < PLATFORM.x - PLATFORM.width / 2 + ENEMY.width / 2 - 1e-9
						|| position.x > PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2 + 1e-9;
				}
			}
		};
		advance(2400);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(GROUND_ENEMY.limit);
		for (const direction of [-1, 1] as const) {
			advance(600, PLATFORM.x + direction * 1000);
			for (const enemy of world.getEntitiesWithQuery(['groundChaser', 'hitReaction'])) {
				world.mutateComponent(enemy.id, 'hitReaction', function (reaction) { reaction.remaining = 0.5; reaction.push = direction * 230; });
			}
			advance(60, PLATFORM.x + direction * 1000);
		}
		expect(maximumOverlap).toBeLessThan(1e-9);
		expect(outsidePlatform).toBe(false);
	} finally { await world.dispose(); }
});

test('an occupied spawn box delays that side until there is room', async () => {
	const { world, level, step } = await fixture();
	try {
		step();
		const first = world.getEntitiesWithQuery(['groundChaser', 'localTransform'])[0];
		if (!first) throw new Error('Missing ground enemy.');
		const spawnX = PLATFORM.x - PLATFORM.width / 2 + ENEMY.width;
		for (let tick = 0; tick < 240; tick++) {
			world.mutateComponent(first.id, 'localTransform', function (p) { p.x = spawnX; });
			world.mutateComponent(level.player.id, 'localTransform', function (p) { p.x = spawnX; });
			step();
		}
		expect(world.getResource('groundSpawns').spawned).toBe(2);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(2);
		world.removeEntity(first.id);
		step(120);
		expect(world.getResource('groundSpawns').spawned).toBe(3);
	} finally { await world.dispose(); }
});

test('switching and restarting screens removes prior entities and volumes, resets spawns, and preserves stationary fixtures', async () => {
	const { world, step } = await fixture();
	try {
		for (let cycle = 0; cycle < 3; cycle++) {
			step(121);
			const previous = world.getEntitiesWithQuery(['localTransform']).map(function (e) { return e.id; });
			await world.setScreen('test', {});
			for (const id of previous) expect(world.getEntity(id)).toBeUndefined();
			const fixtureLevel = spawnLevel(world, 'test');
			expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(0);
			const positions = fixtureLevel.enemies.map(function (e) { return { ...e.enemy.components.localTransform }; });
			step(300);
			expect(fixtureLevel.enemies.map(function (e) { return e.enemy.components.localTransform; })).toEqual(positions);
			expect(world.getEntitiesWithQuery(['enemy'])).toHaveLength(3);
			await world.setScreen('gameplay', {});
			spawnLevel(world, 'gameplay');
			expect(world.getResource('groundSpawns')).toEqual({ remaining: 0, spawned: 0 });
			step();
			expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(1);
			await world.setScreen('gameplay', {});
			spawnLevel(world, 'gameplay');
			expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(0);
			expect(world.getEntitiesWithQuery(['combatVolume'])).toHaveLength(1);
		}
	} finally { await world.dispose(); }
});
