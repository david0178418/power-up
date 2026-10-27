import { expect, test } from 'bun:test';
import { createGameBuilder, spawnLevel, STEP, START, PLATFORM, ENEMY, ATTACK, PLAYER } from '../src/game';
import { inMeleeCone, MELEE } from '../src/melee';

const fixture = async function (gameplay = false) {
	const input = new EventTarget();
	const world = createGameBuilder({ target: input }).build();
	await world.initialize();
	if (gameplay) await world.setScreen('gameplay', {});
	const level = spawnLevel(world, gameplay ? 'gameplay' : undefined);
	// These mechanic tests count active simulation ticks; hit-stop timing has separate coverage.
	const step = function (count = 1) {
		for (let i = 0; i < count; i++) {
			while (world.getResource('hitStop').remaining > 1e-9) world.update(STEP);
			world.update(STEP);
		}
	};
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
		for (let i = 0; i < 100; i++) {
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

test('finisher blocks held and buffered attacks for 0.4 seconds after the swing ends', async () => {
	for (const input of ['held', 'buffered'] as const) {
		const f = await fixture();
		try {
			for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
			const melee = f.level.player.components.melee;
			melee.strike = 2;
			f.attack(true); f.step();
			while (melee.active) f.step();
			if (input === 'buffered') {
				f.attack(false); f.step();
				f.attack(true); f.step();
				f.attack(false);
			}
			for (let tick = input === 'buffered' ? 2 : 0; tick < 23; tick++) {
				f.step();
				expect(melee.active).toBe(false);
				expect(melee.strike).toBe(3);
				expect(f.level.attack.components.combatVolume.active).toBe(false);
			}
			f.step(); // 24 fixed ticks = 0.4 seconds.
			expect(Boolean(melee.active)).toBe(true);
			expect(melee.strike).toBe(1);
			f.attack(false);
			f.step(60);
			expect(melee.active).toBe(false);
			expect(melee.strike).toBe(0);
		} finally { await f.world.dispose(); }
	}
});

test('360-degree cone includes rear and vertical targets but excludes out-of-range and coincident targets', () => {
	for (const facing of [-1, 1] as const) {
		expect(inMeleeCone(facing * 100, 0, facing)).toBe(true);
		expect(inMeleeCone(facing * 70, 30, facing)).toBe(true);
		expect(inMeleeCone(facing * 30, 70, facing)).toBe(true);
		expect(inMeleeCone(facing * -110, 0, facing)).toBe(true);
		expect(inMeleeCone(facing * 111, 0, facing)).toBe(false);
		expect(inMeleeCone(0, -110, facing)).toBe(true);
		expect(inMeleeCone(0, 110, facing)).toBe(true);
		expect(inMeleeCone(0, 0, facing)).toBe(false);
		expect(inMeleeCone(NaN, 0, facing)).toBe(false);
		expect(inMeleeCone(0, Infinity, facing)).toBe(false);
	}
});

test('magnetism assists live targets ahead or behind within range', async () => {
	for (const scenario of ['ahead', 'behind', 'above', 'far', 'disabled'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) {
				p.x = START.x + (scenario === 'behind' ? -100 : scenario === 'far' ? 111 : 110);
				p.y = scenario === 'above' ? START.y - 150 : START.y;
			});
			if (scenario === 'disabled') f.world.mutateComponent(target.hurtbox.id, 'combatVolume', function (v) { v.active = false; });
			f.attack(true); f.step();
			expect(f.level.player.components.melee.lunge).toBe(scenario === 'ahead' || scenario === 'behind' ? MELEE.magnetismSpeed : 0);
			f.step(6);
			if (scenario === 'ahead' || scenario === 'behind') expect(target.enemy.components.hitReaction.remaining).toBeGreaterThan(0);
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
				// Hold the target at its new position so its fall cannot take it out of range.
				target.enemy.components.rigidBody.gravityScale = 0;
				target.enemy.components.velocity.y = 0;
				f.step(2);
				expect(melee.active).toBe(false);
				expect(velocity.x).toBe(0);
				expect(velocity.y).toBe(0);
				f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) { p.x = position.x + facing * 70; p.y = position.y - dy; });
				f.attack(true); f.step(10); f.attack(false);
				expect(melee.strike).toBe(2);
				expect(Math.sign(melee.aim.y)).toBe(-Math.sign(dy));
			} finally { await f.world.dispose(); }
		}
	}
});

test('distant and disabled targets leave an airborne attack horizontal without cancelling momentum', async () => {
	for (const scenario of ['far', 'disabled'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { localTransform: position, velocity, melee } = f.level.player.components;
			position.y = 200;
			velocity.y = -200;
			f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) {
				p.x = position.x + (scenario === 'far' ? 120 : 50);
				p.y = position.y - 25;
			});
			if (scenario === 'disabled') target.hurtbox.components.combatVolume.active = false;
			f.attack(true); f.step();
			expect(melee.aim).toEqual({ x: 1, y: 0 });
			expect(position.x).toBe(START.x);
			expect(velocity.x).toBe(0);
			expect(velocity.y).toBeCloseTo(-200 + 1400 * STEP);
			expect(f.level.attack.components.localTransform.y).toBe(0);
		} finally { await f.world.dispose(); }
	}
});


test('strikes acquire all eight directions from either facing and turn facing and pushback toward rear targets', async () => {
	for (const facing of [-1, 1] as const) {
		for (const [dx, dy] of [[80, 0], [60, 60], [0, 80], [-60, 60], [-80, 0], [-60, -60], [0, -80], [60, -60]] as const) {
			const f = await fixture();
			try {
				const target = f.level.enemies[0];
				if (!target) throw new Error('Missing target');
				for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
				const { player, melee, localTransform: position } = f.level.player.components;
				position.y = 200;
				player.facing = facing;
				f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) { p.x = START.x + dx; p.y = 200 + dy; });
				f.attack(true); f.step(); f.attack(false);
				const direction = dx === 0 ? facing : dx < 0 ? -1 : 1;
				expect(melee.aim.x).toBeCloseTo(dx / Math.hypot(dx, dy));
				expect(melee.aim.y).toBeCloseTo(dy / Math.hypot(dx, dy));
				expect(player.facing).toBe(direction);
				f.world.getResource('touchInput').move = -direction;
				f.step(6);
				expect(player.facing).toBe(direction);
				expect(target.enemy.components.health.current).toBe(ENEMY.health - 1);
				expect(Math.sign(target.enemy.components.hitReaction.push)).toBe(direction);
			} finally { await f.world.dispose(); }
		}
	}
});

test('nearest target wins across both sides and next swing can reverse direction', async () => {
	const f = await fixture();
	try {
		const ahead = f.level.enemies[0];
		const behind = f.level.enemies[1];
		if (!ahead || !behind) throw new Error('Missing targets');
		for (const { enemy } of f.level.enemies.slice(2)) f.world.removeEntity(enemy.id);
		f.world.mutateComponent(ahead.enemy.id, 'localTransform', function (p) { p.x = START.x + 100; });
		f.world.mutateComponent(behind.enemy.id, 'localTransform', function (p) { p.x = START.x - 60; });
		f.attack(true); f.step(); f.attack(false);
		expect(f.level.player.components.player.facing).toBe(-1);
		f.step(8);
		const position = f.level.player.components.localTransform;
		f.world.mutateComponent(ahead.enemy.id, 'localTransform', function (p) { p.x = position.x + 50; });
		f.world.mutateComponent(behind.enemy.id, 'localTransform', function (p) { p.x = position.x - 100; });
		f.attack(true); f.step(10); f.attack(false);
		expect(f.level.player.components.melee.strike).toBe(2);
		expect(f.level.player.components.player.facing).toBe(1);
	} finally { await f.world.dispose(); }
});


test('airborne lunges zero velocity after the burst, hover for a quarter second, then resume falling', async () => {
	for (const momentum of [-100, 0, 100]) {
		const f = await fixture();
		try {
			for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
			const { melee, localTransform: position, velocity } = f.level.player.components;
			position.y = 150;
			velocity.y = momentum;
			// A horizontal target gives a lunge without adding vertical momentum.
			const target = f.world.spawn({ enemy: true, localTransform: { x: position.x + 100, y: position.y, rotation: 0, scaleX: 1, scaleY: 1 } });
			f.world.spawn({ combatVolume: { ownerId: target.id, kind: 'hurtbox', active: true } });
			f.attack(true); f.step(); f.attack(false);
			while (melee.active) {
				expect(velocity.y).toBeCloseTo(momentum);
				f.step();
			}
			const tailStartY = position.y;
			const tailStartX = position.x;
			expect(velocity.x).toBe(0);
			expect(velocity.y).toBe(0);
			f.step(14);
			expect(velocity.y).toBeCloseTo(0);
			expect(position.x).toBeCloseTo(tailStartX);
			expect(position.y).toBeCloseTo(tailStartY);
			f.step();
			expect(velocity.y).toBeCloseTo(1400 * STEP);
			f.step();
			expect(velocity.y).toBeCloseTo(2800 * STEP);
		} finally { await f.world.dispose(); }
	}
});

test('a connected non-lunge swing stops player momentum and hovers once for a quarter second', async () => {
	for (const momentum of [-100, 100]) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { melee, localTransform: position, velocity } = f.level.player.components;
			position.y = 150;
			velocity.x = 100;
			velocity.y = momentum;
			// Touching physical boxes need no lunge, but the attack still connects.
			target.enemy.components.localTransform.x = position.x + (PLAYER.width + ENEMY.width) / 2;
			target.enemy.components.localTransform.y = position.y;
			target.enemy.components.rigidBody.gravityScale = 0;
			f.attack(true); f.step(); f.attack(false);
			expect(melee.lunge).toBe(0);
			expect(melee.hitTargets.has(target.enemy.id)).toBe(true);
			expect(target.enemy.components.health.current).toBe(ENEMY.health - 1);
			expect(velocity).toEqual({ x: 0, y: 0 });
			const hoverY = position.y;
			f.step(14);
			expect(melee.active).toBe(false);
			expect(target.enemy.components.health.current).toBe(ENEMY.health - 1);
			expect(position.y).toBeCloseTo(hoverY);
			expect(velocity.y).toBeCloseTo(0);
			f.step();
			expect(velocity.y).toBeCloseTo(1400 * STEP);
		} finally { await f.world.dispose(); }
	}
});

test('untargeted follow-ups do not renew a lunge gravity tail and falling out resets it', async () => {
	const f = await fixture();
	try {
		const target = f.level.enemies[0];
		if (!target) throw new Error('Missing target');
		for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
		const { melee, localTransform: position, velocity } = f.level.player.components;
		position.y = 150;
		target.enemy.components.localTransform.x = position.x + 100;
		target.enemy.components.localTransform.y = position.y;
		f.attack(true); f.step();
		expect(melee.lunge).toBeGreaterThan(0);
		f.world.removeEntity(target.enemy.id);
		while (melee.active) f.step();
		f.step(14);
		expect(melee.strike).toBe(2);
		expect(melee.lunge).toBe(0);
		expect(velocity.y).toBeCloseTo(0);
		f.step();
		expect(velocity.y).toBeCloseTo(1400 * STEP);
		while (melee.active) f.step();
		expect(melee.gravityTail).toBe(0);
		f.attack(false);
		position.y = 600;
		f.step();
		expect(position.y).toBe(START.y);
		expect(melee.gravityTail).toBe(0);
		position.y = 150;
		f.step();
		expect(velocity.y).toBeCloseTo(1400 * STEP);
	} finally { await f.world.dispose(); }
});

test('untargeted airborne combos follow the same gravity trajectory as no attack', async () => {
	for (const momentum of [-100, 0, 100]) {
		const attacking = await fixture();
		const idle = await fixture();
		try {
			for (const f of [attacking, idle]) {
				for (const { enemy } of f.level.enemies) f.world.removeEntity(enemy.id);
				f.level.player.components.localTransform.y = 150;
				f.level.player.components.velocity.y = momentum;
			}
			attacking.attack(true);
			for (let i = 0; i < 30; i++) {
				attacking.step(); idle.step();
				expect(attacking.level.player.components.velocity.y).toBeCloseTo(idle.level.player.components.velocity.y);
				expect(attacking.level.player.components.localTransform.y).toBeCloseTo(idle.level.player.components.localTransform.y);
				expect(attacking.level.player.components.melee.gravityTail).toBe(0);
			}
		} finally { await attacking.world.dispose(); await idle.world.dispose(); }
	}
});


test('untargeted combos preserve movement and stop lunging after losing a target', async () => {
	for (const move of [-1, 0, 1]) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { melee, localTransform: position, velocity } = f.level.player.components;
			f.world.mutateComponent(target.enemy.id, 'localTransform', function (p) { p.x = START.x + 100; });
			f.attack(true); f.step();
			expect(velocity.x).toBeGreaterThan(0);
			f.world.removeEntity(target.enemy.id);
			while (melee.active) f.step();
			f.world.getResource('touchInput').move = move;
			const startX = position.x;
			for (let i = 0; i < 40; i++) {
				f.step();
				expect(velocity.x).toBe(move * PLAYER.speed);
				if (melee.active) expect(melee.lunge).toBe(0);
			}
			expect(melee.strike).toBe(3);
			expect(position.x).toBeCloseTo(startX + move * PLAYER.speed * STEP * 40);
		} finally { await f.world.dispose(); }
	}
});

test('only a connected finisher grants one optional air jump, which survives lunge recovery', async () => {
	for (const scenario of ['first', 'second', 'miss', 'finisher'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { player, melee, localTransform: position, velocity } = f.level.player.components;
			position.y = 150;
			player.grounded = false;
			target.enemy.components.localTransform.x = position.x + 50;
			target.enemy.components.localTransform.y = position.y;
			melee.strike = scenario === 'first' ? 0 : scenario === 'second' ? 1 : 2;
			if (scenario === 'miss') target.hurtbox.components.combatVolume.active = false;
			f.attack(true); f.step(); f.attack(false);
			expect(melee.airJumpAvailable).toBe(scenario === 'finisher');
			expect(velocity.y).toBeGreaterThanOrEqual(0); // No automatic jump on contact.
			const touch = f.world.getResource('touchInput');
			touch.jump = true;
			// A tap during impact freeze must survive until the next active tick.
			f.world.update(STEP);
			touch.jump = false;
			f.step();
			if (scenario !== 'finisher') {
				expect(velocity.y).toBeGreaterThanOrEqual(0);
				continue;
			}
			expect(velocity.y).toBeCloseTo(-PLAYER.jumpSpeed + 1400 * STEP);
			expect(melee.airJumpAvailable).toBe(false);
			expect(melee.active).toBe(false);
			const jumpY = position.y;
			f.step(10);
			expect(position.y).toBeLessThan(jumpY);
			expect(velocity.y).toBeCloseTo(-PLAYER.jumpSpeed + 1400 * STEP * 11);
			touch.jump = true;
			f.step();
			expect(velocity.y).toBeCloseTo(-PLAYER.jumpSpeed + 1400 * STEP * 12);
		} finally { await f.world.dispose(); }
	}
});

test('a held jump needs a new press after the finisher; landing and fall reset clear the reward', async () => {
	for (const reset of ['landing', 'fall'] as const) {
		const f = await fixture();
		try {
			const target = f.level.enemies[0];
			if (!target) throw new Error('Missing target');
			for (const { enemy } of f.level.enemies.slice(1)) f.world.removeEntity(enemy.id);
			const { player, melee, localTransform: position, velocity } = f.level.player.components;
			position.y = 150;
			player.grounded = false;
			const touch = f.world.getResource('touchInput');
			touch.jump = true;
			f.step(); // Discard an airborne press before the reward exists.
			target.enemy.components.localTransform.x = position.x + 50;
			target.enemy.components.localTransform.y = position.y;
			melee.strike = 2;
			f.attack(true); f.step(); f.attack(false);
			f.step(10);
			expect(melee.airJumpAvailable).toBe(true);
			expect(velocity.y).toBeGreaterThanOrEqual(0);
			position.y = reset === 'fall' ? 600 : START.y + 1;
			velocity.y = 0;
			f.step(2);
			expect(melee.airJumpAvailable).toBe(false);
		} finally { await f.world.dispose(); }
	}
});
