import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP, START, PLATFORM, ENEMY, ATTACK } from '../src/game';
import { inMeleeCone, MELEE } from '../src/melee';

const fixture = async function (gameplay = false) {
	const input = new EventTarget();
	const world = createGameBuilder({ target: input }).build();
	await world.initialize();
	if (gameplay) await world.setScreen('gameplay', {});
	const level = spawnLevel(world, gameplay ? 'gameplay' : undefined);
	const step = function (count = 1) { for (let i = 0; i < count; i++) world.update(STEP); };
	const attack = function (pressed: boolean) {
		const event = new Event(pressed ? 'keydown' : 'keyup');
		Object.defineProperty(event, 'key', { value: 'j' });
		input.dispatchEvent(event);
	};
	return { world, level, step, attack };
};

test('held melee repeats three distinct strikes, recovers between hits and resets after idle', async () => {
	const f = await fixture();
	try {
		const { melee, localTransform: position } = f.level.player.components;
		f.attack(true);
		f.world.update(STEP / 2);
		expect(melee.strike).toBe(0);
		f.world.update(STEP / 2);
		expect(melee.strike).toBe(1);
		expect(position.x).toBeGreaterThan(START.x);
		const strikes = [1];
		let recoveries = 0;
		for (let i = 0; i < 80; i++) {
			const active = melee.active;
			f.step();
			if (active && !melee.active) recoveries++;
			if (!active && melee.active) strikes.push(melee.strike);
		}
		expect(strikes.slice(0, 4)).toEqual([1, 2, 3, 1]);
		expect(recoveries).toBeGreaterThanOrEqual(3);
		f.attack(false);
		f.step(60);
		expect(melee.strike).toBe(0);
		expect(f.level.attack.components.combatVolume.active).toBe(false);
		const stopped = position.x;
		f.step(5);
		expect(position.x).toBe(stopped);
	} finally { await f.world.dispose(); }
});

test('a tap completes its swing and a tap during recovery buffers exactly one follow-up', async () => {
	const f = await fixture();
	try {
		const melee = f.level.player.components.melee;
		f.attack(true); f.step(); f.attack(false); f.step(8);
		expect(melee.active).toBe(false);
		f.attack(true); f.step(); f.attack(false);
		f.step(8);
		expect(melee.active).toBe(true);
		expect(melee.strike).toBe(2);
		f.step(25);
		expect(melee.active).toBe(false);
		expect(melee.strike).toBe(2);
	} finally { await f.world.dispose(); }
});

test('cone excludes rear, steep vertical, out-of-range and coincident targets on either facing', () => {
	for (const facing of [-1, 1] as const) {
		expect(inMeleeCone(facing * 100, 0, facing)).toBe(true);
		expect(inMeleeCone(facing * 70, 30, facing)).toBe(true);
		expect(inMeleeCone(facing * 30, 70, facing)).toBe(false);
		expect(inMeleeCone(facing * -20, 0, facing)).toBe(false);
		expect(inMeleeCone(facing * 111, 0, facing)).toBe(false);
		expect(inMeleeCone(0, 0, facing)).toBe(false);
	}
});

test('magnetism changes lunge only for a live target in the forward cone and reaches at maximum range', async () => {
	for (const scenario of ['ahead', 'behind', 'above', 'far', 'disabled'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) {
				p.x = START.x + (scenario === 'behind' ? -100 : scenario === 'far' ? 111 : 110);
				p.y = scenario === 'above' ? START.y - 150 : START.y;
			});
			if (scenario === 'disabled') f.world.mutateComponent(target.hurtbox.id, 'combatVolume', function (v) { v.active = false; });
			f.attack(true); f.step();
			expect(f.level.player.components.melee.lunge).toBe(scenario === 'ahead' ? MELEE.magnetismSpeed : MELEE.lungeSpeed);
			f.step(6);
			if (scenario === 'ahead') expect(target.enemy.components.hitReaction.remaining).toBeGreaterThan(0);
		} finally { await f.world.dispose(); }
	}
});

test('one swing stuns and pushes multiple solid enemies once; finisher is stronger', async () => {
	for (const strike of [1, 3]) {
		const f = await fixture();
		try {
			const targets = f.level.enemies.slice(0, 2);
			for (const { enemy } of f.level.enemies.slice(2)) f.world.removeEntity(enemy.id);
			for (const [index, { enemy }] of targets.entries()) {
				f.world.mutateComponent(enemy.id, 'localTransform', function (p) { p.x = START.x + 35 + index * ENEMY.width; });
			}
			f.level.player.components.melee.strike = strike - 1;
			f.attack(true); f.step(); f.attack(false);
			for (const { enemy } of targets) {
				expect(enemy.components.hitReaction.remaining).toBe(strike === 3 ? MELEE.finisherStun : MELEE.stun);
				expect(enemy.components.hitReaction.push).toBe(strike === 3 ? MELEE.finisherPushSpeed : MELEE.pushSpeed);
			}
			f.step(3);
			for (const [index, { enemy }] of targets.entries()) {
				expect(enemy.components.localTransform.x).toBeGreaterThan(START.x + 35 + index * ENEMY.width);
				expect(enemy.components.hitReaction.remaining).toBeLessThan(strike === 3 ? MELEE.finisherStun : MELEE.stun);
			}
			f.step(45);
			for (const { enemy } of targets) {
				expect(enemy.components.hitReaction.remaining).toBe(0);
				expect(enemy.components.velocity.x).toBe(0);
			}
		} finally { await f.world.dispose(); }
	}
});

test('hit stun overrides pursuit, pushback respects platform edges, and chase resumes', async () => {
	const f = await fixture(true);
	try {
		f.step();
		const enemy = f.world.getEntitiesWithQuery(['groundChaser', 'hitReaction', 'localTransform', 'velocity'])[0];
		if (!enemy) throw new Error('Missing chaser');
		f.world.mutateComponent(enemy.id, 'localTransform', function (p) { p.x = START.x + 50; });
		f.attack(true); f.step(); f.attack(false); f.step();
		expect(enemy.components.velocity.x).toBeGreaterThan(0);
		f.step(15);
		expect(enemy.components.hitReaction.remaining).toBe(0);
		expect(enemy.components.velocity.x).toBeLessThan(0);
		f.world.mutateComponent(enemy.id, 'localTransform', function (p) { p.x = PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2; });
		f.world.mutateComponent(enemy.id, 'hitReaction', function (r) { r.remaining = 0.2; r.push = 230; });
		f.step(10);
		expect(enemy.components.localTransform.x).toBeLessThanOrEqual(PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2);
		expect(enemy.components.localTransform.y).toBeCloseTo(PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2);
	} finally { await f.world.dispose(); }
});


test('diagonal strikes aim and hit above/below on both facings, lock aim, and reacquire next swing', async () => {
	for (const facing of [-1, 1] as const) {
		for (const dy of [-40, 40]) {
			const f = await fixture();
			try {
				const target = f.level.enemies[0];
				if (!target) throw new Error('Missing target');
				for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
				const { player, melee, localTransform: position, velocity } = f.level.player.components;
				position.y = 200;
				player.facing = facing;
				f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) { p.x = START.x + facing * 70; p.y = 200 + dy; });
				f.attack(true); f.step(); f.attack(false);
				const aim = { ...melee.aim };
				expect(aim.x).toBeCloseTo(facing * 70 / Math.hypot(70, dy));
				expect(aim.y).toBeCloseTo(dy / Math.hypot(70, dy));
				expect(Math.sign(velocity.x)).toBe(facing);
				expect(Math.sign(velocity.y)).toBe(Math.sign(dy));
				expect(f.level.attack.components.localTransform.x).toBeCloseTo(aim.x * ATTACK.offset);
				expect(f.level.attack.components.localTransform.y).toBeCloseTo(aim.y * ATTACK.offset);
				f.step(6);
				expect(target.enemy.components.health.current).toBe(ENEMY.health - 1);
				expect(melee.aim).toEqual(aim);
				// Reposition during recovery: the next swing must take a new bearing.
				f.step(2);
				f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) { p.x = position.x + facing * 70; p.y = position.y - dy; });
				f.attack(true); f.step(10); f.attack(false);
				expect(melee.strike).toBe(2);
				expect(Math.sign(melee.aim.y)).toBe(-Math.sign(dy));
			} finally { await f.world.dispose(); }
		}
	}
});

test('rear, steep, distant and disabled targets leave an airborne attack horizontal without cancelling momentum', async () => {
	for (const scenario of ['behind', 'steep', 'far', 'disabled'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { localTransform: position, velocity, melee } = f.level.player.components;
			position.y = 200;
			velocity.y = -200;
			f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) {
				p.x = position.x + (scenario === 'behind' ? -50 : scenario === 'far' ? 120 : 50);
				p.y = position.y + (scenario === 'steep' ? -100 : -25);
			});
			if (scenario === 'disabled') target.hurtbox.components.combatVolume.active = false;
			f.attack(true); f.step();
			expect(melee.aim).toEqual({ x: 1, y: 0 });
			expect(velocity.y).toBeCloseTo(-200 + 1400 * STEP);
			expect(f.level.attack.components.localTransform.y).toBe(0);
		} finally { await f.world.dispose(); }
	}
});
