import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP } from '../src/game';

test('lethal damage emits death once, disables hurtboxes immediately and removes the enemy hierarchy', async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		const level = spawnLevel(world);
		const target = level.enemies[0];
		if (!target) throw new Error('Missing enemy');
		world.addComponent(target.enemy.id, 'health', { current: 10, max: 10 });
		const deaths: number[] = [];
		const killers: (number | undefined)[] = [];
		world.eventBus.subscribe('entityDied', function (event) { deaths.push(event.entityId); killers.push(event.killerId); });
		world.eventBus.publish('damage', { entityId: target.enemy.id, amount: 4, sourceId: level.player.id });
		expect(world.getComponent(target.enemy.id, 'health')?.current).toBe(6);
		expect(deaths).toEqual([]);
		expect(target.hurtbox.components.combatVolume.active).toBe(true);
		world.eventBus.publish('damage', { entityId: target.enemy.id, amount: 20, sourceId: level.player.id });
		world.eventBus.publish('damage', { entityId: target.enemy.id, amount: 20, sourceId: level.player.id });
		expect(world.getComponent(target.enemy.id, 'health')?.current).toBe(0);
		expect(deaths).toEqual([target.enemy.id]);
		expect(killers).toEqual([level.player.id]);
		expect(target.hurtbox.components.combatVolume.active).toBe(false);
		world.update(STEP);
		expect(world.getEntity(target.enemy.id)).toBeUndefined();
		expect(world.getEntity(target.hurtbox.id)).toBeUndefined();
		expect(world.getEntity(level.player.id)).toBeDefined();
		expect(world.getEntity(level.attack.id)).toBeDefined();
		expect(world.getEntitiesWithQuery(['enemy'])).toHaveLength(2);
	} finally { await world.dispose(); }
});

test('real melee overlaps deal one damage per swing across multiple hurtboxes and kill on the third strike', async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		const level = spawnLevel(world);
		const target = level.enemies[0];
		if (!target) throw new Error('Missing enemy');
		const duplicate = world.spawnChild(target.enemy.id, { ...target.hurtbox.components,
			combatVolume: { ...target.hurtbox.components.combatVolume } });
		const deaths: number[] = [];
		world.eventBus.subscribe('entityDied', function (event) { deaths.push(event.entityId); });
		const touch = world.getResource('touchInput');
		const step = function () { world.update(STEP); };
		for (const strike of [1, 2, 3]) {
			world.mutateComponent(target.enemy.id, 'localTransform', function (position) {
				position.x = level.player.components.localTransform.x + 40;
			});
			touch.attack = true;
			step();
			touch.attack = false;
			expect(level.player.components.melee.strike).toBe(strike);
			expect(target.enemy.components.health.current).toBe(3 - strike);
			for (let tick = 0; tick < 3; tick++) step();
			expect(target.enemy.components.health.current).toBe(3 - strike);
			while (level.player.components.melee.active || level.player.components.melee.remaining > 1e-9) step();
		}
		expect(deaths).toEqual([target.enemy.id]);
		expect(world.getEntity(target.enemy.id)).toBeUndefined();
		expect(world.getEntity(target.hurtbox.id)).toBeUndefined();
		expect(world.getEntity(duplicate.id)).toBeUndefined();
	} finally { await world.dispose(); }
});

test('killing a spawned enemy frees the cap and replacements and restarted screens have full health', async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		await world.setScreen('gameplay', {});
		spawnLevel(world, 'gameplay');
		for (let tick = 0; tick < 1000; tick++) world.update(STEP);
		const enemies = world.getEntitiesWithQuery(['groundChaser', 'health']);
		expect(enemies).toHaveLength(8);
		const target = enemies[0];
		if (!target) throw new Error('Missing enemy');
		world.eventBus.publish('damage', { entityId: target.id, amount: 3 });
		world.update(STEP);
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(7);
		for (let tick = 0; tick < 121; tick++) world.update(STEP);
		const replacement = world.getEntitiesWithQuery(['groundChaser', 'health']).find(function (enemy) {
			return !enemies.some(function (original) { return original.id === enemy.id; });
		});
		expect(replacement?.components.health).toEqual({ current: 3, max: 3 });
		await world.setScreen('test', {});
		const level = spawnLevel(world, 'test');
		expect(world.getEntitiesWithQuery(['groundChaser'])).toHaveLength(0);
		for (const { enemy } of level.enemies) expect(enemy.components.health).toEqual({ current: 3, max: 3 });
	} finally { await world.dispose(); }
});
