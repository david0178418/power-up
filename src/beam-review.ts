import { Graphics, type Application, type Container } from 'pixi.js';
import { getCombatContact } from './combat';
import type { GameWorld } from './game';
import { beamOverlap, createBeam } from './beam';
import { BEAM_FIXTURE, spawnBeamFixture } from './beam-fixture';

type ReviewWorld = Pick<GameWorld, 'spawn' | 'spawnChild' | 'removeEntity' | 'getEntity' | 'getComponent' | 'mutateComponent' | 'eventBus'>;
export const attachBeamReview = function (world: ReviewWorld, app: Application, root: Container) {
	const active = document.getElementById('beam-active');
	const clear = document.getElementById('beam-remove');
	const status = document.getElementById('beam-status');
	const contacts = document.getElementById('beam-contacts');
	if (!contacts) throw new Error('Beam contact output is missing.');
	const readInput = function (id: string) {
		const element = document.getElementById(id);
		if (!(element instanceof HTMLInputElement)) throw new Error(`Missing beam input: ${id}`);
		return element;
	};
	const x = readInput('beam-x');
	const y = readInput('beam-y');
	const angle = readInput('beam-angle');
	const length = readInput('beam-length');
	const width = readInput('beam-width');
	if (!(active instanceof HTMLInputElement) || !(clear instanceof HTMLButtonElement) || !status) throw new Error('Beam review controls are missing.');
	const fixture = spawnBeamFixture(world);
	const f = BEAM_FIXTURE;
	const drawing = new Graphics();
	root.addChild(drawing);
	let ticks = 0;
	let beamId: number | undefined = fixture.beam.id;
	const stopScan = world.eventBus.subscribe('beamScan', function (scan) { if (scan.attackId === beamId) ticks += 1; });
	const apply = function () {
		if (!active.checked) {
			if (beamId !== undefined) world.mutateComponent(beamId, 'combatVolume', function (v) { v.active = false; });
			return;
		}
		if (![x, y, angle, length, width].every(function (input) { return input.reportValidity(); })) return;
		if (beamId === undefined) {
			// Restore only the beam, keeping fixture owners and guides stable.
			beamId = world.spawn(createBeam(fixture.owner.id, { x: f.x, y: f.y }, { x: f.x + f.length, y: f.y }, f.width, false)).id;
		}
		const radians = angle.valueAsNumber * Math.PI / 180;
		world.mutateComponent(beamId, 'beam', function (beam) {
			beam.from = { x: x.valueAsNumber, y: y.valueAsNumber };
			beam.to = { x: beam.from.x + Math.cos(radians) * length.valueAsNumber, y: beam.from.y + Math.sin(radians) * length.valueAsNumber };
			beam.width = width.valueAsNumber;
		});
		world.mutateComponent(beamId, 'combatVolume', function (v) { v.active = active.checked; });
	};
	const remove = function () {
		if (beamId !== undefined) world.removeEntity(beamId);
		beamId = undefined;
		active.checked = false;
	};
	const update = function () {
		drawing.clear();
		const beam = beamId === undefined ? undefined : world.getComponent(beamId, 'beam');
		const volume = beamId === undefined ? undefined : world.getComponent(beamId, 'combatVolume');
		const live = beam && volume?.active && world.getEntity(volume.ownerId) ? beam : undefined;
		for (const { target, hurtbox } of fixture.targets) {
			const p = world.getComponent(hurtbox.id, 'worldTransform');
			const box = world.getComponent(hurtbox.id, 'aabbCollider');
			const geometry = p && box ? { x: p.x + (box.offsetX ?? 0), y: p.y + (box.offsetY ?? 0), width: box.width, height: box.height }
				: { x: target.components.localTransform.x, y: f.y, width: f.targetWidth, height: f.targetHeight };
			const hit = live && beamId !== undefined && getCombatContact(world, beamId, hurtbox.id)
				&& beamOverlap(live, geometry) !== undefined;
			drawing.rect(geometry.x - geometry.width / 2, geometry.y - geometry.height / 2, geometry.width, geometry.height).fill(hit ? 0xffe08a : 0xe76e80);
		}
		drawing.rect(f.wallX - 4, f.y - 24, 8, 48).fill(0xe6b566);
		if (live) {
			const distance = Math.hypot(live.to.x - live.from.x, live.to.y - live.from.y);
			const nx = -(live.to.y - live.from.y) / distance * live.width / 2;
			const ny = (live.to.x - live.from.x) / distance * live.width / 2;
			drawing.poly([live.from.x + nx, live.from.y + ny, live.to.x + nx, live.to.y + ny,
				live.to.x - nx, live.to.y - ny, live.from.x - nx, live.from.y - ny]).fill({ color: 0x65deeb, alpha: 0.3 }).stroke({ color: 0x65deeb, width: 1 });
		}
		if (!live) contacts.textContent = 'No active contacts.';
		status.textContent = `Active beams: ${live ? 1 : 0} · active fixed ticks: ${ticks} · ${live ? 'full extent; reports through solids' : 'no active coverage'}`;
	};
	// Contact text represents the latest fixed scan and is cleared when inactive
	// or geometry changes; graphics use current geometry rather than cached events.
	const stopContacts = world.eventBus.subscribe('beamScan', function (scan) {
		if (scan.attackId !== beamId) return;
		contacts.textContent = `Current tick: ${scan.contacts.map(function (c) {
			return `${c.kind} ${c.kind === 'target' ? c.targetId : c.obstacleId} at ${(c.fraction * 100).toFixed(1)}%`;
		}).join(' → ') || 'no contacts'}`;
	});
	const change = function () { apply(); contacts.textContent = 'Awaiting active fixed tick.'; update(); };
	const clearBeam = function () { remove(); contacts.textContent = 'No active contacts.'; update(); };
	active.addEventListener('change', change);
	for (const input of [x, y, angle, length, width]) input.addEventListener('input', change);
	clear.addEventListener('click', clearBeam);
	app.ticker.add(update, undefined, -100);
	update();
	return function () {
		active.removeEventListener('change', change);
		for (const input of [x, y, angle, length, width]) input.removeEventListener('input', change);
		clear.removeEventListener('click', clearBeam);
		app.ticker.remove(update);
		stopScan();
		stopContacts();
		remove();
		world.removeEntity(fixture.owner.id);
		for (const { target } of fixture.targets) world.removeEntity(target.id);
		world.removeEntity(fixture.wall.id);
		drawing.removeFromParent();
		drawing.destroy();
	};
};
