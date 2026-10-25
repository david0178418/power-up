import { expect, test } from 'bun:test';
import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createCombatVolume, layers, type CombatContact } from '../src/combat';
import { createGameBuilder, spawnLevel, START, STEP } from '../src/game';

const fixture = async function () {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	await world.initialize();
	const owner = world.spawn({ ...createTransform(100, 100) });
	const target = world.spawn({ ...createTransform(130, 100) });
	const attack = world.spawnChild(owner.id, createCombatVolume(owner.id, 'attack', 20, 20, 20));
	const hurtbox = world.spawnChild(target.id, createCombatVolume(target.id, 'hurtbox', 20, 20));
	const contacts: CombatContact[] = [];
	world.eventBus.subscribe('combatContact', function (contact) { contacts.push(contact); });
	return { world, owner, target, attack, hurtbox, contacts };
};

test('contact identity, strict overlap, activation, and per-fixed-tick reporting without damage policy', async () => {
	const f = await fixture();
	try {
		f.world.update(STEP / 2);
		expect(f.contacts).toEqual([]);
		f.world.update(STEP / 2);
		const expected = { attackId: f.attack.id, ownerId: f.owner.id, hurtboxId: f.hurtbox.id, targetId: f.target.id };
		expect(f.contacts).toEqual([expected]);
		f.world.update(STEP * 3);
		expect(f.contacts).toEqual([expected, expected, expected, expected]);
		f.contacts.length = 0;
		f.world.mutateComponent(f.attack.id, 'combatVolume', function (v) { v.active = false; });
		f.world.update(STEP);
		expect(f.contacts).toEqual([]);
		f.world.mutateComponent(f.attack.id, 'combatVolume', function (v) { v.active = true; });
		f.world.mutateComponent(f.hurtbox.id, 'combatVolume', function (v) { v.active = false; });
		f.world.update(STEP);
		expect(f.contacts).toEqual([]);
		f.world.mutateComponent(f.hurtbox.id, 'combatVolume', function (v) { v.active = true; });
		// Attack center is 120; edge touching at 140 is not positive overlap.
		for (const x of [140, 141]) {
			f.world.mutateComponent(f.target.id, 'localTransform', function (t) { t.x = x; });
			f.world.update(STEP);
			expect(f.contacts).toEqual([]);
		}
		f.world.mutateComponent(f.target.id, 'localTransform', function (t) { t.x = 139; });
		f.world.update(STEP);
		expect(f.contacts).toEqual([expected]);
	} finally { await f.world.dispose(); }
});

test('attached volume centers follow hierarchy translation, rotation and scale on consecutive fixed ticks', async () => {
	const f = await fixture();
	try {
		f.world.mutateComponent(f.owner.id, 'localTransform', function (t) { t.x = 200; t.rotation = Math.PI / 2; t.scaleX = 2; });
		f.world.mutateComponent(f.target.id, 'localTransform', function (t) { t.x = 200; t.y = 140; });
		f.world.update(STEP);
		expect(f.attack.components.worldTransform.x).toBeCloseTo(200);
		expect(f.attack.components.worldTransform.y).toBeCloseTo(140);
		expect(f.contacts).toHaveLength(1);
		f.contacts.length = 0;
		f.world.mutateComponent(f.owner.id, 'localTransform', function (t) { t.x = 250; });
		f.world.update(STEP);
		expect(f.contacts).toEqual([]);
		expect(f.attack.components.worldTransform.x).toBeCloseTo(250);
	} finally { await f.world.dispose(); }
});

test('removing volumes, components, or either owner cannot produce stale contacts', async () => {
	for (const remove of ['attack', 'hurtbox', 'owner', 'target', 'component', 'orphan'] as const) {
		const f = await fixture();
		try {
			f.world.update(STEP);
			expect(f.contacts).toHaveLength(1);
			f.contacts.length = 0;
			if (remove === 'component') f.world.removeComponent(f.attack.id, 'combatVolume');
			else if (remove === 'orphan') f.world.removeEntity(f.owner.id, { cascade: false });
			else f.world.removeEntity(f[remove].id);
			f.world.update(STEP * 3);
			expect(f.contacts).toEqual([]);
			if (remove === 'owner') expect(f.world.getEntity(f.attack.id)).toBeUndefined();
			if (remove === 'target') expect(f.world.getEntity(f.hurtbox.id)).toBeUndefined();
		} finally { await f.world.dispose(); }
	}
});

test('combat overlap does not push, stop, or change either physical body', async () => {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		const spawnBody = function (x: number, speed: number) {
			return world.spawn({ ...createTransform(x, 100), ...createRigidBody('dynamic', { gravityScale: 0 }),
				velocity: { x: speed, y: 0 }, ...createAABBCollider(32, 40), ...layers.player() });
		};
		const owner = spawnBody(100, 30);
		const target = spawnBody(130, -30);
		world.spawnChild(owner.id, createCombatVolume(owner.id, 'attack', 80, 40));
		world.spawnChild(target.id, createCombatVolume(target.id, 'hurtbox', 32, 40));
		let count = 0;
		world.eventBus.subscribe('combatContact', function () { count++; });
		world.update(STEP * 4);
		expect(count).toBe(4);
		expect(owner.components.localTransform).toMatchObject({ x: 102, y: 100 });
		expect(target.components.localTransform).toMatchObject({ x: 128, y: 100 });
		expect(owner.components.velocity).toEqual({ x: 30, y: 0 });
		expect(target.components.velocity).toEqual({ x: -30, y: 0 });
	} finally { await world.dispose(); }
});

test('melee accepts keyboard/gamepad, locks swing facing and resets without lag', async () => {
	const input = new EventTarget();
	let pressed = false;
	const world = createGameBuilder({ target: input, gamepad: { poll: function () {
		return [{ id: 'Test pad', connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, function (_, i) {
			return { pressed: pressed && i === 2, value: Number(pressed && i === 2) };
		}) }];
	} } }).build();
	const key = function (type: string, value: string) {
		const event = new Event(type);
		Object.defineProperty(event, 'key', { value });
		input.dispatchEvent(event);
	};
	try {
		await world.initialize();
		const level = spawnLevel(world);
		const customAttack = world.spawnChild(level.player.id, createCombatVolume(level.player.id, 'attack', 10, 10, -90, 12, false));
		const contacts: CombatContact[] = [];
		world.eventBus.subscribe('combatContact', function (contact) { contacts.push(contact); });
		key('keydown', 'j');
		world.update(STEP);
		expect(contacts).toHaveLength(1);
		expect(level.player.components.localTransform.x).toBeGreaterThan(START.x);
		key('keyup', 'j');
		world.update(STEP);
		expect(level.attack.components.combatVolume.active).toBe(true);
		for (let i = 0; i < 45; i++) world.update(STEP);
		expect(level.attack.components.combatVolume.active).toBe(false);
		pressed = true;
		world.update(STEP);
		expect(level.attack.components.combatVolume.active).toBe(true);
		expect(customAttack.components.combatVolume.active).toBe(false);
		expect(customAttack.components.localTransform).toMatchObject({ x: -90, y: 12 });
		key('keydown', 'a');
		world.update(STEP);
		expect(level.attack.components.worldTransform.x).toBe(level.player.components.localTransform.x + level.player.components.melee.aim.x * 40);
		key('keyup', 'a');
		while (world.getResource('hitStop').remaining > 1e-9) world.update(STEP);
		world.mutateComponent(level.player.id, 'localTransform', function (t) { t.y = 700; });
		world.update(STEP);
		expect(level.player.components.localTransform).toMatchObject(START);
		expect(level.attack.components.worldTransform.x).toBe(START.x + 40);
		expect(level.attack.components.worldTransform.y).toBe(START.y);
		expect(level.attack.components.combatVolume.active).toBe(false);
		expect(level.player.components.melee.strike).toBe(0);
	} finally { await world.dispose(); }
});

test('rotated melee rectangle rejects enclosing-box corners and reports only precise overlaps', async () => {
	const world = createGameBuilder({ target: new EventTarget() }).build();
	try {
		await world.initialize();
		const owner = world.spawn(createTransform(100, 100));
		const aim = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
		world.spawnChild(owner.id, {
			...createCombatVolume(owner.id, 'attack', 66, 66),
			combatRectangle: { width: 56, height: 36, aim },
		});
		const inside = world.spawn({});
		const corner = world.spawn({});
		world.spawn({ ...createCombatVolume(inside.id, 'hurtbox', 2, 2, 120, 120) });
		world.spawn({ ...createCombatVolume(corner.id, 'hurtbox', 2, 2, 130, 70) });
		const contacts: CombatContact[] = [];
		world.eventBus.subscribe('combatContact', function (contact) { contacts.push(contact); });
		world.update(STEP);
		expect(contacts.map(function (contact) { return contact.targetId; })).toEqual([inside.id]);
	} finally { await world.dispose(); }
});
