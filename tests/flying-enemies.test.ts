import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP, START, ENEMY } from '../src/game';
import { FLYING_ENEMY } from '../src/flying-enemy';

const fixture = async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	await world.initialize();
	await world.setScreen('gameplay', {});
	const level = spawnLevel(world, 'gameplay');
	const step = function (ticks: number) { for (let tick = 0; tick < ticks; tick++) world.update(STEP); };
	return { world, level, step };
};

test('waves descend from above, converge around the player, remain airborne and follow a moving target', async () => {
	const { world, level, step } = await fixture();
	try {
		step(47);
		expect(world.getEntitiesWithQuery(['flyingChaser'])).toHaveLength(0);
		step(1);
		const flyers = world.getEntitiesWithQuery(['flyingChaser', 'localTransform', 'velocity']);
		expect(flyers).toHaveLength(FLYING_ENEMY.waveSize);
		for (const { components: { localTransform: p, velocity } } of flyers) {
			expect(p.y).toBeLessThan(0);
			expect(velocity.y).toBeGreaterThan(0);
			expect(Math.hypot(velocity.x, velocity.y)).toBeLessThanOrEqual(FLYING_ENEMY.speed + 1e-9);
		}
		step(500);
		for (const flyer of flyers) expect(Math.hypot(flyer.components.localTransform.x - START.x, flyer.components.localTransform.y - START.y)).toBeLessThan(110);
		for (let tick = 0; tick < 180; tick++) {
			world.mutateComponent(level.player.id, 'localTransform', function (p) { p.x = 700; p.y = 160; });
			world.mutateComponent(level.player.id, 'velocity', function (v) { v.y = 0; });
			step(1);
		}
		for (const flyer of flyers) {
			expect(flyer.components.localTransform.x).toBeGreaterThan(600);
			expect(flyer.components.localTransform.y).toBeLessThan(250);
		}
	} finally { await world.dispose(); }
});

test('cap, vacant slots, death cleanup and screen transitions bound the flock', async () => {
	const { world, step } = await fixture();
	try {
		step(1500);
		const flyers = world.getEntitiesWithQuery(['flyingChaser']);
		expect(flyers).toHaveLength(FLYING_ENEMY.limit);
		const victim = flyers[4];
		if (!victim) throw new Error('Missing flyer');
		const children = world.getEntitiesWithQuery(['combatVolume']).filter(function (v) { return v.components.combatVolume.ownerId === victim.id; });
		world.eventBus.publish('damage', { entityId: victim.id, amount: ENEMY.health });
		step(1);
		expect(world.getEntity(victim.id)).toBeUndefined();
		for (const child of children) expect(world.getEntity(child.id)).toBeUndefined();
		step(240);
		const slots = world.getEntitiesWithQuery(['flyingChaser']).map(function (e) { return e.components.flyingChaser.slot; });
		expect(new Set(slots).size).toBe(FLYING_ENEMY.limit);
		await world.setScreen('test', {});
		spawnLevel(world, 'test');
		step(600);
		expect(world.getEntitiesWithQuery(['flyingChaser'])).toHaveLength(0);
		await world.setScreen('gameplay', {});
		spawnLevel(world, 'gameplay');
		expect(world.getResource('flyingSpawns')).toEqual({ remaining: FLYING_ENEMY.initialDelay, spawned: 0 });
		step(48);
		expect(world.getEntitiesWithQuery(['flyingChaser'])).toHaveLength(3);
	} finally { await world.dispose(); }
});

test('normal melee hits airborne hurtboxes and stun suspends pursuit before it resumes', async () => {
	const { world, level, step } = await fixture();
	try {
		step(48);
		const flyer = world.getEntitiesWithQuery(['flyingChaser', 'health', 'hitReaction', 'localTransform', 'velocity'])[0];
		if (!flyer) throw new Error('Missing flyer');
		world.mutateComponent(flyer.id, 'localTransform', function (p) { p.x = START.x + 45; p.y = START.y - 35; });
		world.getResource('touchInput').attack = true;
		step(1);
		expect(flyer.components.health.current).toBe(ENEMY.health - 1);
		expect(flyer.components.hitReaction.remaining).toBeGreaterThan(0);
		world.getResource('touchInput').attack = false;
		step(10);
		expect(flyer.components.velocity.y).toBe(0);
		step(80);
		expect(flyer.components.hitReaction.remaining).toBe(0);
		expect(Math.hypot(flyer.components.velocity.x, flyer.components.velocity.y)).toBeGreaterThan(0);
		expect(level.player.components.localTransform.y).toBeLessThan(540);
	} finally { await world.dispose(); }
});
