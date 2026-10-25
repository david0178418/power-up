import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP, START, ENEMY } from '../src/game';
import { MELEE } from '../src/melee';
import { createProjectile } from '../src/projectile';
import { createBeam } from '../src/beam';

const fixture = async function () {
	const input = new EventTarget();
	const world = createGameBuilder({ target: input }).build();
	await world.initialize();
	await world.setScreen('test', {});
	const level = spawnLevel(world, 'test');
	const key = function (key: string, down: boolean) {
		const event = new Event(down ? 'keydown' : 'keyup');
		Object.defineProperty(event, 'key', { value: key });
		input.dispatchEvent(event);
	};
	return { world, level, key };
};

test('confirmed multi-target hits freeze gameplay for three ticks, five on finisher, then resume without catch-up', async () => {
	for (const strike of [1, 3]) {
		const f = await fixture();
		try {
			const { world, level } = f;
			for (const [index, { enemy }] of level.enemies.entries()) {
				world.mutateComponent(enemy.id, 'localTransform', function (p) { p.x = START.x + 35 + index * ENEMY.width; });
			}
			const shot = world.spawn(createProjectile(level.player.id, { x: 900, y: 100 }, { x: 100, y: 0 }, 4, 4, 2));
			world.spawn(createBeam(level.player.id, { x: 900, y: 100 }, { x: 950, y: 100 }, 4));
			let scans = 0;
			world.eventBus.subscribe('beamScan', function () { scans++; });
			let renders = 0;
			world.addSystem('render-probe').inPhase('render').setProcess(function () { renders++; });
			level.player.components.melee.strike = strike - 1;
			f.key('j', true); world.update(STEP); f.key('j', false);
			expect(level.enemies[0]?.enemy.components.health.current).toBe(2);
			expect(level.enemies[1]?.enemy.components.health.current).toBe(2);
			expect(world.getResource('hitStop').remaining).toBe(strike === 3 ? MELEE.finisherHitStop : MELEE.hitStop);
			const snapshot = structuredClone({ player: level.player.components.localTransform, melee: level.player.components.melee,
				targets: level.enemies.map(function ({ enemy }) { return enemy.components; }), shot: shot.components });
			const pausedTicks = strike === 3 ? 5 : 3;
			// One update containing several fixed ticks must also stay frozen.
			world.update(STEP * pausedTicks);
			expect(level.player.components.localTransform).toEqual(snapshot.player);
			expect(level.player.components.melee.remaining).toBe(snapshot.melee.remaining);
			expect(level.enemies.map(function ({ enemy }) { return enemy.components; })).toEqual(snapshot.targets);
			expect(shot.components).toEqual(snapshot.shot);
			expect(scans).toBe(1);
			expect(renders).toBe(2);
			world.update(STEP);
			expect(shot.components.localTransform.x).toBeCloseTo(snapshot.shot.localTransform.x + 100 * STEP);
			expect(level.player.components.melee.remaining).toBeCloseTo(snapshot.melee.remaining - STEP);
			expect(scans).toBe(2);
			expect(level.enemies[0]?.enemy.components.health.current).toBe(2);
		} finally { await f.world.dispose(); }
	}
});

test('misses do not pause and attack/jump taps during hit stop survive release before resume', async () => {
	const f = await fixture();
	try {
		const { world, level } = f;
		for (const { enemy } of level.enemies) world.removeEntity(enemy.id);
		f.key('j', true); world.update(STEP); f.key('j', false);
		expect(world.getResource('hitStop').remaining).toBe(0);
		world.update(STEP); // Sample the release before the next tap.
		world.getResource('hitStop').remaining = MELEE.hitStop;
		world.update(STEP / 2);
		expect(world.getResource('hitStop').remaining).toBe(MELEE.hitStop);
		f.key('j', true); f.key(' ', true); world.update(STEP);
		f.key('j', false); f.key(' ', false); world.update(STEP);
		expect(level.player.components.melee.queued).toBe(true);
		expect(level.player.components.velocity.y).toBe(0);
		world.update(STEP); world.update(STEP);
		expect(level.player.components.velocity.y).toBeLessThan(0);
		for (let i = 0; i < 20; i++) world.update(STEP);
		expect(level.player.components.melee.strike).toBe(2);
	} finally { await f.world.dispose(); }
});

test('screen switches and restarts clear a pending freeze and reset spawn timers', async () => {
	const f = await fixture();
	try {
		for (const screen of ['gameplay', 'test', 'gameplay', 'gameplay'] as const) {
			f.world.getResource('hitStop').remaining = MELEE.finisherHitStop;
			f.world.update(STEP);
			await f.world.setScreen(screen, {});
			spawnLevel(f.world, screen);
			expect(f.world.getResource('hitStop').remaining).toBe(0);
			f.world.update(STEP);
			if (screen === 'gameplay') {
				expect(f.world.getResource('groundSpawns').spawned).toBe(1);
				const remaining = f.world.getResource('groundSpawns').remaining;
				f.world.getResource('hitStop').remaining = MELEE.hitStop;
				f.world.update(STEP * 3);
				expect(f.world.getResource('groundSpawns').remaining).toBe(remaining);
			}
		}
	} finally { await f.world.dispose(); }
});


test('external lethal damage during hit stop still disables and removes the enemy hierarchy', async () => {
	const f = await fixture();
	try {
		const target = f.level.enemies[0];
		if (!target) throw new Error('Missing target');
		f.world.getResource('hitStop').remaining = MELEE.finisherHitStop;
		f.world.update(STEP);
		f.world.eventBus.publish('damage', { entityId: target.enemy.id, amount: ENEMY.health });
		expect(target.hurtbox.components.combatVolume.active).toBe(false);
		f.world.update(STEP);
		expect(f.world.getEntity(target.enemy.id)).toBeUndefined();
		expect(f.world.getEntity(target.hurtbox.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});
