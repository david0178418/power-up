import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP, BEAM } from '../src/game';
import { createCombatVolume } from '../src/combat';
import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';

const fixture = async function () {
	const target = new EventTarget();
	const world = createGameBuilder({ target }).build();
	await world.initialize();
	await world.setScreen('test', {});
	const level = spawnLevel(world, 'test');
	const step = function (n = 1) { for (let i = 0; i < n; i++) world.update(STEP); };
	const key = function (held: boolean, key = 'l') {
		const event = new Event(held ? 'keydown' : 'keyup');
		Object.defineProperty(event, 'key', { value: key });
		target.dispatchEvent(event);
	};
	return { world, level, step, key };
};

test('held beam pierces enemies, deduplicates hurtboxes, repeats on interval and stops on release', async function () {
	const f = await fixture();
	try {
		const first = f.level.enemies[0];
		if (!first) throw new Error('Missing target');
		f.world.spawnChild(first.enemy.id, createCombatVolume(first.enemy.id, 'hurtbox', 30, 40));
		f.key(true); f.step();
		expect(f.level.enemies.map(function ({ enemy }) { return enemy.components.health.current; })).toEqual([2, 3, 2]);
		f.step(14);
		expect(first.enemy.components.health.current).toBe(2);
		f.step();
		expect(first.enemy.components.health.current).toBe(1);
		f.key(false); f.step(30);
		expect(first.enemy.components.health.current).toBe(1);
		expect(f.world.getEntitiesWithQuery(['playerBeam', 'combatVolume'])[0]?.components.combatVolume.active).toBe(false);
		f.key(true); f.step();
		expect(f.world.getEntity(first.enemy.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});

test('beam cooldown survives release/repress; touch shares it and Shoot remains independent', async function () {
	const f = await fixture();
	try {
		f.key(true); f.step(); f.key(false); f.step();
		f.world.getResource('touchInput').beam = true;
		f.step();
		expect(f.level.enemies[0]?.enemy.components.health.current).toBe(2);
		f.key(true, 'k'); f.step();
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(1);
		expect(f.world.getEntitiesWithQuery(['playerBeam'])).toHaveLength(1);
	} finally { await f.world.dispose(); }
});

test('beam follows facing and resolved movement, and wall clipping matches damage coverage', async function () {
	const f = await fixture();
	try {
		f.world.spawn({ ...createTransform(620, 365), ...createRigidBody('static'), ...createAABBCollider(10, 60) });
		f.key(true); f.step();
		const beam = f.world.getEntitiesWithQuery(['playerBeam', 'beam'])[0];
		expect(beam?.components.beam.to.x).toBeCloseTo(615);
		expect(f.level.enemies[0]?.enemy.components.health.current).toBe(2);
		expect(f.level.enemies[2]?.enemy.components.health.current).toBe(3);
		f.world.getResource('touchInput').move = -1;
		f.step();
		expect(beam?.components.beam.from.x).toBeCloseTo(f.level.player.components.worldTransform.x);
		expect(beam?.components.beam.to.x).toBeCloseTo(f.level.player.components.worldTransform.x - BEAM.range);
		expect(f.level.enemies[1]?.enemy.components.health.current).toBe(2);
	} finally { await f.world.dispose(); }
});

test('hit stop pauses damage clocks; fall reset and screen transitions leave no stale beam', async function () {
	const f = await fixture();
	try {
		f.key(true); f.step();
		const beam = f.world.getEntitiesWithQuery(['playerBeam', 'beam'])[0];
		if (!beam) throw new Error('Missing beam');
		const cooldowns = Array.from(beam.components.playerBeam.cooldowns.values());
		f.world.getResource('hitStop').remaining = STEP * 3;
		f.step(3);
		expect(Array.from(beam.components.playerBeam.cooldowns.values())).toEqual(cooldowns);
		f.level.player.components.localTransform.y = 700;
		f.step();
		expect(beam.components.beam.from.y).toBeCloseTo(f.level.player.components.worldTransform.y);
		await f.world.setScreen('gameplay', {});
		expect(f.world.getEntity(beam.id)).toBeUndefined();
		spawnLevel(f.world, 'gameplay');
		f.step();
		expect(f.world.getEntitiesWithQuery(['playerBeam'])).toHaveLength(1);
	} finally { await f.world.dispose(); }
});

test('gamepad button 3 sustains a beam and disconnect deactivates it', async function () {
	let connected = true;
	const world = createGameBuilder({ target: new EventTarget(), gamepad: { poll: function () {
		return connected ? [{ id: 'Beam pad', connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, function (_, index) {
			return { pressed: index === 3, value: index === 3 ? 1 : 0 };
		}) }] : [];
	} } }).build();
	try {
		await world.initialize(); await world.setScreen('test', {});
		const level = spawnLevel(world, 'test');
		world.update(STEP);
		expect(level.enemies[0]?.enemy.components.health.current).toBe(2);
		connected = false; world.update(STEP);
		expect(world.getEntitiesWithQuery(['playerBeam', 'combatVolume'])[0]?.components.combatVolume.active).toBe(false);
	} finally { await world.dispose(); }
});
