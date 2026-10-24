import { expect, test } from 'bun:test';
import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { beamOverlap, createBeam, type BeamScan } from '../src/beam';
import { createCombatVolume, type CombatContact } from '../src/combat';
import { createGameBuilder, STEP } from '../src/game';
import { createViewCamera } from '../src/view';

const fixture = async function () {
	const world = createGameBuilder({ target: new EventTarget() }).withPlugin(createViewCamera()).build();
	await world.initialize();
	const owner = world.spawn({});
	const scans: BeamScan[] = [];
	const contacts: CombatContact[] = [];
	world.eventBus.subscribe('beamScan', function (scan) { scans.push(scan); });
	world.eventBus.subscribe('combatContact', function (contact) { contacts.push(contact); });
	const target = function (x: number, y = 0, width = 2, height = 10) {
		const entity = world.spawn({ ...createTransform(x, y) });
		const hurtbox = world.spawnChild(entity.id, createCombatVolume(entity.id, 'hurtbox', width, height));
		return { entity, hurtbox };
	};
	const beam = function () { return world.spawn(createBeam(owner.id, { x: 0, y: 0 }, { x: 100, y: 0 }, 4)); };
	return { world, owner, scans, contacts, target, beam };
};

test('finite width, flat ends, starting overlap and strict edge misses', () => {
	const beam = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 4 };
	for (const [x, y, expected] of [[50, 6, 0.49], [50, 7, undefined], [50, 7.001, undefined],
		[0, 0, 0], [-1, 0, undefined], [101, 0, undefined], [100, 0, 0.99]] as const) {
		expect(beamOverlap(beam, { x, y, width: 2, height: 10 })).toBe(expected);
	}
});

test('diagonal, reverse and vertical geometry uses an oriented rectangle', () => {
	const beam = { from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, width: 4 };
	expect(beamOverlap(beam, { x: 50, y: 50, width: 2, height: 2 })).toBeCloseTo(0.49);
	expect(beamOverlap(beam, { x: 50, y: 80, width: 2, height: 2 })).toBeUndefined();
	expect(beamOverlap({ ...beam, from: beam.to, to: beam.from }, { x: 50, y: 50, width: 2, height: 2 })).toBeCloseTo(0.49);
	expect(beamOverlap({ ...beam, to: { x: 0, y: 100 } }, { x: 2, y: 50, width: 2, height: 2 })).toBeCloseTo(0.49);
	expect(beamOverlap({ ...beam, to: { x: 0, y: 100 } }, { x: 3, y: 50, width: 2, height: 2 })).toBeUndefined();
});

test('invalid geometry fails explicitly rather than creating a stale volume', () => {
	for (const [from, to, width] of [
		[{ x: 0, y: 0 }, { x: 0, y: 0 }, 4],
		[{ x: 0, y: 0 }, { x: Infinity, y: 0 }, 4],
		[{ x: NaN, y: 0 }, { x: 100, y: 0 }, 4],
		[{ x: 0, y: 0 }, { x: 100, y: 0 }, 0],
	] as const) expect(function () { createBeam(1, from, to, width); }).toThrow(RangeError);
});

test('every active tick reports all contacts through solids, sorted by entry, solid ties and ID', async () => {
	const f = await fixture();
	try {
		const far = f.target(80);
		const a = f.target(50);
		const start = f.target(0);
		const b = f.target(50);
		const wall = f.world.spawn({ ...createTransform(50, 0), ...createAABBCollider(2, 10), ...createRigidBody('static') });
		f.world.spawn({ ...createTransform(20, 0), ...createAABBCollider(2, 10), ...createRigidBody('kinematic') });
		const beam = f.beam();
		f.world.update(STEP / 2);
		expect(f.scans).toHaveLength(0);
		f.world.update(STEP / 2);
		expect(f.scans[0]?.contacts.map(function (c) { return c.kind === 'solid' ? c.obstacleId : c.hurtboxId; }))
			.toEqual([start.hurtbox.id, wall.id, a.hurtbox.id, b.hurtbox.id, far.hurtbox.id]);
		expect(f.contacts[0]).toEqual({ attackId: beam.id, ownerId: f.owner.id, hurtboxId: start.hurtbox.id, targetId: start.entity.id });
		f.world.update(STEP * 2);
		expect(f.scans).toHaveLength(3);
		expect(f.contacts).toHaveLength(12);
		f.world.mutateComponent(beam.id, 'combatVolume', function (v) { v.active = false; });
		f.world.update(STEP * 2);
		expect(f.scans).toHaveLength(3);
		f.world.mutateComponent(beam.id, 'combatVolume', function (v) { v.active = true; });
		f.world.update(STEP);
		expect(f.scans).toHaveLength(4);
	} finally { await f.world.dispose(); }
});

test('live aiming, extent and width changes replace geometry; targets sampled at current transforms/offsets', async () => {
	const f = await fixture();
	try {
		const a = f.target(50);
		const b = f.target(50, 40);
		f.world.mutateComponent(b.hurtbox.id, 'aabbCollider', function (box) { box.offsetY = 10; });
		const beam = f.beam();
		f.world.update(STEP);
		expect(f.contacts.map(function (c) { return c.targetId; })).toEqual([a.entity.id]);
		f.world.mutateComponent(beam.id, 'beam', function (g) { g.to = { x: 100, y: 100 }; g.width = 2; });
		f.world.update(STEP);
		expect(f.scans[1]?.contacts).toHaveLength(1);
		expect(f.contacts[1]?.targetId).toBe(b.entity.id);
		expect(f.scans[0]?.geometry.to).toEqual({ x: 100, y: 0 });
		f.world.mutateComponent(beam.id, 'beam', function (g) { g.from = { x: 80, y: 80 }; g.to = { x: 90, y: 90 }; g.width = 30; });
		f.world.update(STEP);
		expect(f.scans[2]?.contacts).toHaveLength(0);
	} finally { await f.world.dispose(); }
});

test('activation boundary, removals and owner cleanup leave no subsequent contacts', async () => {
	for (const operation of ['target-off', 'target-remove', 'target-owner-remove', 'beam-remove', 'identity-remove', 'owner-remove', 'geometry-remove'] as const) {
		const f = await fixture();
		try {
			const t = f.target(50);
			const beam = f.beam();
			const child = f.world.spawnChild(beam.id, {});
			f.world.update(STEP);
			if (operation === 'target-off') f.world.mutateComponent(t.hurtbox.id, 'combatVolume', function (v) { v.active = false; });
			if (operation === 'target-remove') f.world.removeEntity(t.hurtbox.id);
			if (operation === 'target-owner-remove') f.world.removeEntity(t.entity.id, { cascade: false });
			if (operation === 'beam-remove') f.world.removeEntity(beam.id);
			if (operation === 'identity-remove') f.world.removeComponent(beam.id, 'combatVolume');
			if (operation === 'geometry-remove') f.world.removeComponent(beam.id, 'beam');
			if (operation === 'owner-remove') f.world.removeEntity(f.owner.id);
			f.world.update(STEP * 2);
			expect(f.contacts).toHaveLength(1);
			if (['beam-remove', 'identity-remove', 'owner-remove'].includes(operation)) {
				expect(f.world.getEntity(beam.id)).toBeUndefined();
				expect(f.world.getEntity(child.id)).toBeUndefined();
			}
		} finally { await f.world.dispose(); }
	}
});

test('camera and off-screen position do not affect sustained lifetime or contacts', async () => {
	const f = await fixture();
	try {
		const target = f.target(5050);
		const beam = f.world.spawn(createBeam(f.owner.id, { x: 5000, y: 0 }, { x: 5100, y: 0 }, 4));
		f.world.update(STEP);
		f.world.getResource('cameraState').x = -900;
		f.world.getResource('cameraState').y = 700;
		f.world.update(STEP * 3);
		expect(f.contacts.map(function (c) { return c.targetId; })).toEqual(Array(4).fill(target.entity.id));
		expect(f.world.getEntity(beam.id)).toBeDefined();
	} finally { await f.world.dispose(); }
});

test('browser fixture reports the target beyond its solid, then changes to a miss while active', async () => {
	const { spawnBeamFixture } = await import('../src/beam-fixture');
	const f = await fixture();
	try {
		const scene = spawnBeamFixture(f.world);
		f.world.update(STEP);
		expect(f.scans).toHaveLength(0);
		f.world.mutateComponent(scene.beam.id, 'combatVolume', function (v) { v.active = true; });
		f.world.update(STEP);
		expect(f.scans[0]?.contacts.map(function (c) { return c.kind; })).toEqual(['target', 'solid', 'target']);
		f.world.mutateComponent(scene.beam.id, 'beam', function (b) { b.from = { x: 240, y: 60 }; b.to = { x: 840, y: 60 }; });
		f.world.update(STEP);
		expect(f.scans[1]?.contacts).toHaveLength(0);
	} finally { await f.world.dispose(); }
});
