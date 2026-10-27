import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP } from '../src/game';
import type { GamepadLike } from 'ecspresso/plugins/input/input';
import { createCombatVolume } from '../src/combat';
import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createProjectile } from '../src/projectile';

const fixture = async function () {
	const target = new EventTarget();
	const world = createGameBuilder({ target }).build();
	await world.initialize();
	await world.setScreen('test', {});
	const level = spawnLevel(world, 'test');
	const step = function (count = 1) { for (let i = 0; i < count; i++) world.update(STEP); };
	const key = function (held: boolean) {
		const event = new Event(held ? 'keydown' : 'keyup');
		Object.defineProperty(event, 'key', { value: 'k' });
		target.dispatchEvent(event);
	};
	return { world, level, step, key };
};

test('player projectiles damage only the first enemy in a swept path', async function () {
	const f = await fixture();
	try {
		const shot = f.world.spawn({ playerShot: true, ...createProjectile(f.level.player.id,
			{ x: 480, y: 365 }, { x: 24000, y: 0 }, 12, 12, 1) });
		f.step();
		expect(f.level.enemies.map(function ({ enemy }) { return enemy.components.health.current; })).toEqual([2, 3, 3]);
		expect(f.world.getEntity(shot.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});

test('a platform blocks damage behind it and removes a player shot', async function () {
	const f = await fixture();
	try {
		const enemy = f.level.enemies[0];
		if (!enemy) throw new Error('Missing target');
		enemy.enemy.components.localTransform.y = 470;
		const shot = f.world.spawn({ playerShot: true, ...createProjectile(f.level.player.id,
			{ x: 540, y: 350 }, { x: 0, y: 12000 }, 12, 12, 1) });
		f.step();
		expect(enemy.enemy.components.health.current).toBe(3);
		expect(f.world.getEntity(shot.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});

test('K selects the nearest live enemy in any direction and touch shares the cooldown', async function () {
	const f = await fixture();
	try {
		const nearest = f.level.enemies[1];
		if (!nearest) throw new Error('Missing target');
		nearest.enemy.components.localTransform.x = 450;
		f.key(true); f.step(); f.key(false);
		const shot = f.world.getEntitiesWithQuery(['playerShot', 'homingTarget', 'projectile'])[0];
		expect(shot?.components.homingTarget.id).toBe(nearest.enemy.id);
		expect(shot?.components.projectile.velocity.x).toBeLessThan(0);
		f.world.getResource('touchInput').shoot = true;
		f.step();
		expect(f.level.player.components.ranged.remaining).toBeGreaterThan(0);
		expect(f.world.getEntitiesWithQuery(['playerShot']).length).toBeLessThanOrEqual(1);
	} finally { await f.world.dispose(); }
});

test('homing follows within the cone, permanently loses a target outside it, and never reacquires', async function () {
	const f = await fixture();
	try {
		const target = f.level.enemies[0]?.enemy;
		if (!target) throw new Error('Missing target');
		target.components.rigidBody.gravityScale = 0;
		Object.assign(target.components.localTransform, { x: 650, y: 150 });
		const shot = f.world.spawn({ playerShot: true, homingTarget: { id: target.id },
			...createProjectile(f.level.player.id, { x: 480, y: 100 }, { x: 700, y: 0 }, 12, 12, 2, 900) });
		f.step();
		expect(shot.components.homingTarget.id).toBe(target.id);
		expect(shot.components.projectile.velocity.y).toBeGreaterThan(0);
		expect(Math.hypot(shot.components.projectile.velocity.x, shot.components.projectile.velocity.y)).toBeCloseTo(700);
		Object.assign(target.components.localTransform, { x: 350, y: 100 });
		const heading = { ...shot.components.projectile.velocity };
		f.step();
		expect(shot.components.homingTarget.id).toBeUndefined();
		expect(shot.components.projectile.velocity).toEqual(heading);
		Object.assign(target.components.localTransform, { x: 650, y: 80 });
		f.step();
		expect(shot.components.homingTarget.id).toBeUndefined();
		expect(shot.components.projectile.velocity).toEqual(heading);
	} finally { await f.world.dispose(); }
});

test('destroyed targets are not replaced by another enemy', async function () {
	const f = await fixture();
	try {
		const target = f.level.enemies[0]?.enemy;
		if (!target) throw new Error('Missing target');
		const shot = f.world.spawn({ playerShot: true, homingTarget: { id: target.id },
			...createProjectile(f.level.player.id, { x: 480, y: 100 }, { x: 700, y: 0 }, 12, 12, 2, 900) });
		f.world.eventBus.publish('damage', { entityId: target.id, amount: 3 });
		f.step();
		expect(shot.components.homingTarget.id).toBeUndefined();
		expect(shot.components.projectile.velocity).toEqual({ x: 700, y: 0 });
	} finally { await f.world.dispose(); }
});

test('no live targets produces no shot; held input repeats and screen changes clean up shots', async function () {
	const f = await fixture();
	try {
		for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
		f.key(true); f.step();
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(0);
		const enemy = f.world.spawn({ enemy: true, health: { current: 3, max: 3 },
			...createTransform(10000, 100) });
		f.world.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', 30, 40));
		f.step(9);
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(1);
		f.step();
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(2);
		await f.world.setScreen('gameplay', {});
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(0);
	} finally { await f.world.dispose(); }
});

test('range clips the final sweep and lifetime expires even without range exhaustion', async function () {
	const f = await fixture();
	try {
		const beyondRange = f.level.enemies[0]?.enemy;
		if (!beyondRange) throw new Error('Missing target');
		beyondRange.components.rigidBody.gravityScale = 0;
		Object.assign(beyondRange.components.localTransform, { x: 540, y: 100 });
		const shot = f.world.spawn({ playerShot: true, ...createProjectile(f.level.player.id,
			{ x: 480, y: 100 }, { x: 700, y: 0 }, 12, 12, 2, 25) });
		const ends: number[] = [];
		f.world.eventBus.subscribe('projectileSweep', function (sweep) { if (sweep.attackId === shot.id) ends.push(sweep.to.x); });
		f.step(3);
		expect(ends.at(-1)).toBeCloseTo(505);
		expect(beyondRange.components.health.current).toBe(3);
		expect(shot.components.projectile.remainingRange).toBe(0);
		expect(f.world.getEntity(shot.id)).toBeUndefined();
		const slow = f.world.spawn({ playerShot: true, ...createProjectile(f.level.player.id,
			{ x: 480, y: 100 }, { x: 1, y: 0 }, 12, 12, 2, 900) });
		f.step(119);
		expect(f.world.getEntity(slow.id)).toBeDefined();
		f.step();
		expect(f.world.getEntity(slow.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});


test('a shooting tap during hit stop fires once after simulation resumes', async function () {
	const f = await fixture();
	try {
		f.world.getResource('hitStop').remaining = STEP * 3;
		f.key(true); f.step(); f.key(false); f.step(2);
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(0);
		f.step();
		expect(f.world.getEntitiesWithQuery(['playerShot'])).toHaveLength(1);
		f.step(60);
		expect(f.level.enemies[0]?.enemy.components.health.current).toBe(2);
	} finally { await f.world.dispose(); }
});

test('gamepad button 1 fires a projectile and release stops repeat fire', async function () {
	let pressed = true;
	const pad = function (): GamepadLike {
		return { id: 'Simulated pad', connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, function (_, index) {
			return { pressed: index === 1 && pressed, value: index === 1 && pressed ? 1 : 0 };
		}) };
	};
	const world = createGameBuilder({ target: new EventTarget(), gamepad: { poll: function () { return [pad()]; } } }).build();
	try {
		await world.initialize();
		await world.setScreen('test', {});
		const level = spawnLevel(world, 'test');
		world.update(STEP);
		expect(world.getEntitiesWithQuery(['playerShot'])).toHaveLength(1);
		pressed = false;
		for (let i = 0; i < 60; i++) world.update(STEP);
		expect(level.enemies[0]?.enemy.components.health.current).toBe(2);
	} finally { await world.dispose(); }
});

test('the tracking cone includes its boundary and drops a target just outside it', async function () {
	for (const degrees of [60, 60.01]) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0]?.enemy;
			if (!target) throw new Error('Missing target');
			target.components.rigidBody.gravityScale = 0;
			const angle = degrees * Math.PI / 180;
			Object.assign(target.components.localTransform, { x: 480 + Math.cos(angle) * 200, y: 100 + Math.sin(angle) * 200 });
			const shot = f.world.spawn({ playerShot: true, homingTarget: { id: target.id },
				...createProjectile(f.level.player.id, { x: 480, y: 100 }, { x: 700, y: 0 }, 12, 12, 2, 900) });
			f.step();
			expect(shot.components.homingTarget.id).toBe(degrees === 60 ? target.id : undefined);
		} finally { await f.world.dispose(); }
	}
});

test('invalid range caps are rejected without changing lifetime-only callers', function () {
	for (const range of [0, -1, Infinity, NaN]) {
		expect(function () { createProjectile(1, { x: 0, y: 0 }, { x: 700, y: 0 }, 12, 12, 2, range); }).toThrow(RangeError);
	}
	expect(createProjectile(1, { x: 0, y: 0 }, { x: 700, y: 0 }, 12, 12, 2).projectile.remainingRange).toBeUndefined();
});

test('firing suspends gravity for half a second after the last actual shot', async function () {
	const f = await fixture();
	try {
		const { localTransform: position, velocity, ranged } = f.level.player.components;
		position.y = 100;
		velocity.y = 0;
		f.key(true); f.step(); f.key(false);
		expect(ranged.gravityTail).toBeCloseTo(0.5);
		f.step(29);
		expect(position.y).toBeCloseTo(100);
		expect(velocity.y).toBeCloseTo(0);
		f.step();
		expect(ranged.gravityTail).toBeCloseTo(0);
		expect(velocity.y).toBeGreaterThan(0);
	} finally { await f.world.dispose(); }
});

test('repeated shots renew the gravity pause and empty fire attempts do not', async function () {
	const f = await fixture();
	try {
		const { localTransform: position, ranged, velocity } = f.level.player.components;
		position.y = 100;
		velocity.y = 0;
		for (const { enemy } of f.level.enemies) enemy.components.localTransform.x += 10000;
		f.key(true); f.step(40);
		expect(position.y).toBeCloseTo(100);
		expect(ranged.gravityTail).toBeGreaterThan(0.4);
		for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
		f.step(30);
		expect(ranged.gravityTail).toBeCloseTo(0);
		expect(velocity.y).toBeGreaterThan(0);
	} finally { await f.world.dispose(); }
});

test('overlapping melee and projectile gravity pauses cancel gravity only once', async function () {
	const f = await fixture();
	try {
		const { localTransform: position, velocity, melee, ranged } = f.level.player.components;
		position.y = 100;
		velocity.y = 0;
		melee.gravityTail = 0.25;
		ranged.gravityTail = 0.5;
		f.step(10);
		expect(position.y).toBeCloseTo(100);
		expect(velocity.y).toBeCloseTo(0);
	} finally { await f.world.dispose(); }
});

test('shooting gravity timers pause during hit stop and clear on fall reset and screen restart', async function () {
	const f = await fixture();
	try {
		const { ranged, localTransform: position } = f.level.player.components;
		ranged.gravityTail = 0.4;
		f.world.getResource('hitStop').remaining = STEP * 3;
		f.step(3);
		expect(ranged.gravityTail).toBeCloseTo(0.4);
		position.y = 700;
		f.step();
		expect(ranged.gravityTail).toBe(0);
		ranged.gravityTail = 0.4;
		await f.world.setScreen('test', {});
		const restarted = spawnLevel(f.world, 'test');
		expect(restarted.player.components.ranged.gravityTail).toBe(0);
	} finally { await f.world.dispose(); }
});

test('a shot zeros both velocity axes for rising and falling players; movement works between shots', async function () {
	for (const vertical of [-250, 250]) {
		const f = await fixture();
		try {
			const { localTransform: position, velocity } = f.level.player.components;
			position.y = 100;
			velocity.y = vertical;
			f.world.getResource('touchInput').move = 1;
			f.key(true); f.step(); f.key(false);
			expect(velocity.x).toBeCloseTo(0);
			expect(velocity.y).toBeCloseTo(0);
			expect(position.x).toBeCloseTo(480);
			expect(position.y).toBeCloseTo(100);
			f.step();
			expect(velocity.x).toBeGreaterThan(0);
			expect(position.x).toBeGreaterThan(480);
			velocity.y = -100;
			f.step();
			expect(velocity.y).toBeCloseTo(-100);
		} finally { await f.world.dispose(); }
	}
});

test('shooting without targets neither stops momentum nor pauses gravity', async function () {
	const f = await fixture();
	try {
		for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
		const { localTransform: position, velocity, ranged } = f.level.player.components;
		position.y = 100;
		velocity.y = 100;
		f.world.getResource('touchInput').move = 1;
		f.key(true); f.step();
		expect(velocity.x).toBeGreaterThan(0);
		expect(velocity.y).toBeGreaterThan(100);
		expect(ranged.gravityTail).toBe(0);
	} finally { await f.world.dispose(); }
});
