import { expect, test } from 'bun:test';
import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createCombatVolume, type CombatContact } from '../src/combat';
import { createGameBuilder, STEP } from '../src/game';
import { createViewCamera } from '../src/view';
import { createProjectile, type ProjectileSweep } from '../src/projectile';
import { launchFixtureProjectile, spawnProjectileFixture } from '../src/projectile-fixture';

const fixture = async function () {
	const world = createGameBuilder({ target: new EventTarget() }).withPlugin(createViewCamera()).build();
	await world.initialize();
	const owner = world.spawn({});
	const sweeps: ProjectileSweep[] = [];
	const combat: CombatContact[] = [];
	world.eventBus.subscribe('projectileSweep', function (s) { sweeps.push(s); });
	world.eventBus.subscribe('combatContact', function (c) { combat.push(c); });
	const target = function (x: number, y = 0, width = 2, height = 10) {
		const entity = world.spawn({ ...createTransform(x, y) });
		const hurtbox = world.spawnChild(entity.id, createCombatVolume(entity.id, 'hurtbox', width, height));
		return { entity, hurtbox };
	};
	const shot = function (x = 0, y = 0, vx = 6000, vy = 0, lifetime = 1, width = 4, height = 4) {
		return world.spawn(createProjectile(owner.id, { x, y }, { x: vx, y: vy }, width, height, lifetime));
	};
	return { world, owner, target, shot, sweeps, combat };
};

test('fast shot crosses a thin target in one fixed tick with shared contact identity and no endpoint duplicate', async () => {
	const f = await fixture();
	try {
		const target = f.target(50);
		const shot = f.shot();
		f.world.update(STEP / 2);
		expect(f.sweeps).toHaveLength(0);
		f.world.update(STEP / 2);
		expect(shot.components.localTransform.x).toBe(100);
		expect(shot.components.worldTransform.x).toBe(100);
		expect(f.combat).toEqual([{ attackId: shot.id, ownerId: f.owner.id, hurtboxId: target.hurtbox.id, targetId: target.entity.id }]);
		expect(f.sweeps[0]?.contacts[0]).toMatchObject({ kind: 'target', fraction: 0.47, position: { x: 47, y: 0 } });
		f.world.update(STEP);
		expect(f.combat).toHaveLength(1);
	} finally { await f.world.dispose(); }
});

test('projectile extent matters; strict tangency and near misses do not contact', async () => {
	for (const [y, count] of [[6, 1], [7, 0], [7.001, 0], [-6, 1]] as const) {
		const f = await fixture();
		try {
			f.target(50);
			f.shot(0, y);
			f.world.update(STEP);
			expect(f.combat).toHaveLength(count);
		} finally { await f.world.dispose(); }
	}
});

test('starting overlap, stationary overlap, edge entry and edge departure', async () => {
	for (const [x, vx, expected] of [[50, 0, 0], [50, 6000, 0], [47, 6000, 0], [47, -6000, undefined], [0, 2820, undefined]] as const) {
		const f = await fixture();
		try {
			f.target(50);
			f.shot(x, 0, vx);
			f.world.update(STEP);
			expect(f.sweeps[0]?.contacts[0]?.fraction).toBe(expected);
			expect(f.combat).toHaveLength(expected === undefined ? 0 : 1);
		} finally { await f.world.dispose(); }
	}
});

test('diagonal and reverse paths use the traveled volume rather than its enclosing rectangle', async () => {
	const f = await fixture();
	try {
		const hit = f.target(50, 50);
		f.target(50, 80);
		f.shot(0, 0, 6000, 6000);
		f.shot(100, 100, -6000, -6000);
		f.world.update(STEP);
		expect(f.combat.map(function (c) { return c.targetId; })).toEqual([hit.entity.id, hit.entity.id]);
		expect(f.sweeps[0]?.contacts[0]?.fraction).toBeCloseTo(0.47);
		expect(f.sweeps[1]?.contacts[0]?.fraction).toBeCloseTo(0.47);
	} finally { await f.world.dispose(); }
});

test('vertical path, hurtbox offsets and propagated owner transforms participate in the sweep', async () => {
	const f = await fixture();
	try {
		const target = f.target(80, 50);
		f.world.mutateComponent(target.hurtbox.id, 'aabbCollider', function (box) { box.offsetX = 20; });
		f.shot(100, 0, 0, 6000);
		f.world.update(STEP);
		expect(f.combat[0]?.targetId).toBe(target.entity.id);
		expect(f.sweeps[0]?.contacts[0]?.position.y).toBe(43);
	} finally { await f.world.dispose(); }
});

test('contacts sort by travel, then solid before target, then collider ID, independent of spawn order', async () => {
	const f = await fixture();
	try {
		const far = f.target(80);
		const tieA = f.target(50);
		const near = f.target(20);
		const tieB = f.target(50);
		const wall = f.world.spawn({ ...createTransform(50, 0), ...createAABBCollider(2, 10), ...createRigidBody('static') });
		f.shot();
		f.world.update(STEP);
		expect(f.sweeps[0]?.contacts.map(function (c) { return c.kind === 'solid' ? c.obstacleId : c.hurtboxId; }))
			.toEqual([near.hurtbox.id, wall.id, tieA.hurtbox.id, tieB.hurtbox.id, far.hurtbox.id]);
		expect(f.combat.map(function (c) { return c.hurtboxId; })).toEqual([near.hurtbox.id, tieA.hurtbox.id, tieB.hurtbox.id, far.hurtbox.id]);
	} finally { await f.world.dispose(); }
});

test('last fractional tick checks only the live path, then removes every component and child', async () => {
	const f = await fixture();
	try {
		const hit = f.target(25);
		f.target(75);
		const shot = f.shot(0, 0, 6000, 0, STEP / 2);
		const child = f.world.spawnChild(shot.id, createCombatVolume(f.owner.id, 'attack', 1, 1, 0, 0, false));
		let removed = false;
		f.world.registerDispose('projectile', function () { removed = true; });
		f.world.update(STEP);
		expect(f.combat.map(function (c) { return c.targetId; })).toEqual([hit.entity.id]);
		expect(f.sweeps[0]?.to.x).toBe(50);
		expect(removed).toBe(true);
		expect(f.world.getEntity(shot.id)).toBeUndefined();
		expect(f.world.getEntity(child.id)).toBeUndefined();
		expect(f.world.getEntitiesWithQuery(['projectile'])).toHaveLength(0);
		expect(f.world.getComponent(shot.id, 'aabbCollider')).toBeUndefined();
		f.world.update(STEP * 3);
		expect(f.sweeps).toHaveLength(1);
		expect(f.combat).toHaveLength(1);
	} finally { await f.world.dispose(); }
});

test('multiple fixed ticks expire predictably, while zero-step frames do not move or expire', async () => {
	const f = await fixture();
	try {
		const shot = f.shot(0, 0, 6000, 0, STEP * 2);
		f.world.update(STEP / 2);
		expect(shot.components.localTransform.x).toBe(0);
		expect(shot.components.projectile.remainingLifetime).toBe(STEP * 2);
		f.world.update(STEP * 2);
		expect(f.sweeps.map(function (s) { return s.to.x; })).toEqual([100, 200]);
		expect(f.world.getEntity(shot.id)).toBeUndefined();
	} finally { await f.world.dispose(); }
});

test('decimal tick-multiple lifetimes have no roundoff contact after expiration', async () => {
	for (const [lifetime, ticks] of [[0.1, 6], [0.35, 21], [10, 600]] as const) {
		const f = await fixture();
		try {
			f.target(50);
			const shot = f.shot(50, 0, 0, 0, lifetime);
			for (let tick = 0; tick < ticks; tick++) f.world.update(STEP);
			expect(f.world.getEntity(shot.id)).toBeUndefined();
			expect(f.combat).toHaveLength(ticks);
			f.world.update(STEP);
			expect(f.combat).toHaveLength(ticks);
			expect(f.sweeps).toHaveLength(ticks);
		} finally { await f.world.dispose(); }
	}
});

test('explicit projectile removal and disabled/removed combat identities cannot leave later reports', async () => {
	for (const change of ['shot', 'owner', 'owner-orphan', 'target', 'hurtbox', 'target-volume', 'attack-volume', 'inactive-attack', 'inactive-target'] as const) {
		const f = await fixture();
		try {
			const target = f.target(50);
			const shot = f.shot(50, 0, 0);
			f.world.update(STEP);
			expect(f.combat).toHaveLength(1);
			f.combat.length = 0;
			if (change === 'shot') f.world.removeEntity(shot.id);
			if (change === 'owner') f.world.removeEntity(f.owner.id);
			if (change === 'owner-orphan') f.world.removeEntity(f.owner.id, { cascade: false });
			if (change === 'target') f.world.removeEntity(target.entity.id, { cascade: false });
			if (change === 'hurtbox') f.world.removeEntity(target.hurtbox.id);
			if (change === 'target-volume') f.world.removeComponent(target.hurtbox.id, 'combatVolume');
			if (change === 'attack-volume') f.world.removeComponent(shot.id, 'combatVolume');
			if (change === 'inactive-attack') f.world.mutateComponent(shot.id, 'combatVolume', function (v) { v.active = false; });
			if (change === 'inactive-target') f.world.mutateComponent(target.hurtbox.id, 'combatVolume', function (v) { v.active = false; });
			f.world.update(STEP * 3);
			expect(f.combat).toHaveLength(0);
			if (change.startsWith('owner') || change === 'attack-volume') expect(f.world.getEntity(shot.id)).toBeUndefined();
		} finally { await f.world.dispose(); }
	}
});

test('off-screen movement and lifetime are independent of camera position', async () => {
	for (const x of [-10000, 0, 10000]) {
		const f = await fixture();
		try {
			f.world.getResource('cameraState').x = x;
			const target = f.target(5050);
			const shot = f.shot(5000, 0, 6000, 0, STEP * 2);
			f.world.update(STEP);
			expect(f.combat[0]?.targetId).toBe(target.entity.id);
			expect(f.world.getEntity(shot.id)).toBeDefined();
			expect(shot.components.localTransform.x).toBe(5100);
			f.world.update(STEP);
			expect(f.world.getEntity(shot.id)).toBeUndefined();
		} finally { await f.world.dispose(); }
	}
});

test('browser fixture crosses both thin targets and solid in one tick; miss path clears all', async () => {
	const f = await fixture();
	try {
		const demo = spawnProjectileFixture(f.world);
		launchFixtureProjectile(f.world, demo.owner.id, 24000, STEP, false);
		f.world.update(STEP);
		expect(f.sweeps[0]?.contacts.map(function (c) { return c.kind; })).toEqual(['target', 'target', 'solid']);
		expect(f.sweeps[0]?.to.x).toBe(640);
		launchFixtureProjectile(f.world, demo.owner.id, 24000, STEP, true);
		f.world.update(STEP);
		expect(f.sweeps[1]?.contacts).toEqual([]);
	} finally { await f.world.dispose(); }
});

test('creation rejects nonfinite geometry/velocity and invalid lifetimes', () => {
	for (const invalid of [0, -1, Infinity, NaN]) {
		expect(function () { createProjectile(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 4, 4, invalid); }).toThrow(RangeError);
		expect(function () { createProjectile(1, { x: 0, y: 0 }, { x: 1, y: 0 }, invalid, 4, 1); }).toThrow(RangeError);
	}
	expect(function () { createProjectile(1, { x: NaN, y: 0 }, { x: 1, y: 0 }, 4, 4, 1); }).toThrow(RangeError);
	expect(function () { createProjectile(1, { x: 0, y: 0 }, { x: Infinity, y: 0 }, 4, 4, 1); }).toThrow(RangeError);
});
