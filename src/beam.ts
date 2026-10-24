import { definePlugin } from 'ecspresso';
import { collisionSystems, type CollisionComponentTypes } from 'ecspresso/plugins/physics/collision';
import type { Physics2DOwnComponentTypes } from 'ecspresso/plugins/physics/physics2D';
import type { TransformWorldConfig } from 'ecspresso/plugins/spatial/transform';
import { getCombatContact, layers, type CombatContact, type CombatVolume } from './combat';

interface Point { readonly x: number; readonly y: number }
interface Box extends Point { readonly width: number; readonly height: number }
export interface Beam { from: Point; to: Point; width: number }
export type BeamContact = (
	| (CombatContact & { kind: 'target' })
	| { kind: 'solid'; attackId: number; ownerId: number; obstacleId: number }
) & { fraction: number };
export interface BeamScan {
	attackId: number;
	ownerId: number;
	geometry: Readonly<Beam>;
	contacts: readonly BeamContact[];
}

export const validateBeam = function (beam: Readonly<Beam>) {
	if (![beam.from.x, beam.from.y, beam.to.x, beam.to.y, beam.width].every(Number.isFinite)
		|| beam.width <= 0 || !Number.isFinite(Math.hypot(beam.to.x - beam.from.x, beam.to.y - beam.from.y))
		|| (beam.from.x === beam.to.x && beam.from.y === beam.to.y)) {
		throw new RangeError('Beams require finite distinct endpoints and a positive finite width.');
	}
};

// Flat-ended oriented rectangle against a world-axis AABB. Strict SAT rejects
// edge-only contact; clipping finds the nearest covered longitudinal position.
export const beamOverlap = function (beam: Readonly<Beam>, box: Box): number | undefined {
	validateBeam(beam);
	const dx = beam.to.x - beam.from.x;
	const dy = beam.to.y - beam.from.y;
	const length = Math.hypot(dx, dy);
	const ux = dx / length;
	const uy = dy / length;
	const half = beam.width / 2;
	const cx = box.x - (beam.from.x + dx / 2);
	const cy = box.y - (beam.from.y + dy / 2);
	const hx = box.width / 2;
	const hy = box.height / 2;
	if (Math.abs(cx) >= Math.abs(ux) * length / 2 + Math.abs(uy) * half + hx
		|| Math.abs(cy) >= Math.abs(uy) * length / 2 + Math.abs(ux) * half + hy
		|| Math.abs(cx * ux + cy * uy) >= length / 2 + Math.abs(ux) * hx + Math.abs(uy) * hy
		|| Math.abs(-cx * uy + cy * ux) >= half + Math.abs(uy) * hx + Math.abs(ux) * hy) return undefined;
	let polygon = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(function ([x = 0, y = 0]) {
		const px = box.x + x - beam.from.x;
		const py = box.y + y - beam.from.y;
		return { x: px * ux + py * uy, y: -px * uy + py * ux };
	});
	for (const [axis, boundary, direction] of [['x', 0, 1], ['x', length, -1], ['y', -half, 1], ['y', half, -1]] as const) {
		const input = polygon;
		polygon = [];
		for (const [index, current] of input.entries()) {
			const previous = input[(index + input.length - 1) % input.length];
			if (!previous) continue;
			const a = (previous[axis] - boundary) * direction;
			const b = (current[axis] - boundary) * direction;
			if ((a >= 0) !== (b >= 0)) {
				const t = a / (a - b);
				polygon.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
			}
			if (b >= 0) polygon.push(current);
		}
	}
	return polygon.length ? Math.max(0, Math.min(...polygon.map(function (p) { return p.x; })) / length) : undefined;
};

// Root identity with explicit world geometry: no physical body, transform, or
// endpoint collision layer. Sustained until deactivated or explicitly removed.
export const createBeam = function (ownerId: number, from: Point, to: Point, width: number, active = true) {
	const beam: Beam = { from: { ...from }, to: { ...to }, width };
	validateBeam(beam);
	const combatVolume: CombatVolume = { ownerId, kind: 'attack', active };
	return { beam, combatVolume };
};

type Layer = keyof typeof layers;
export const beams = definePlugin('beams')
	.requires<TransformWorldConfig & {
		components: CollisionComponentTypes<Layer> & Physics2DOwnComponentTypes & { combatVolume: CombatVolume };
		events: { combatContact: CombatContact };
	}>()
	.withComponentTypes<{ beam: Beam }>()
	.withEventTypes<{ beamScan: BeamScan }>()
	.install(function (systems) {
		systems.addSystem('beam-scan').inPhase('fixedUpdate').after(collisionSystems.detect)
			.addQuery('beams', { with: ['beam'], mutates: [] })
			.addQuery('targets', { with: ['combatVolume', 'worldTransform', 'aabbCollider'], mutates: [] })
			.addQuery('solids', { with: ['rigidBody', 'worldTransform', 'aabbCollider'], mutates: [] })
			.setProcess(function ({ queries, ecs }) {
				for (const entity of queries.beams) {
					const volume = ecs.getComponent(entity.id, 'combatVolume');
					if (!volume || volume.kind !== 'attack' || !ecs.getEntity(volume.ownerId)) {
						ecs.commands.removeEntity(entity.id);
						continue;
					}
					if (ecs.getParent(entity.id) !== null) throw new Error('Beams must be root entities with world-space geometry.');
					if (!volume.active) continue;
					const beam = entity.components.beam;
					validateBeam(beam);
					const geometry = { from: { ...beam.from }, to: { ...beam.to }, width: beam.width };
					const contacts: BeamContact[] = [];
					for (const target of queries.targets) {
						const contact = getCombatContact(ecs, entity.id, target.id);
						if (!contact) continue;
						const { worldTransform: p, aabbCollider: box } = target.components;
						const fraction = beamOverlap(geometry, { ...box, x: p.x + (box.offsetX ?? 0), y: p.y + (box.offsetY ?? 0) });
						if (fraction !== undefined) contacts.push({ kind: 'target', ...contact, fraction });
					}
					for (const solid of queries.solids) {
						if (solid.components.rigidBody.type !== 'static') continue;
						const { worldTransform: p, aabbCollider: box } = solid.components;
						const fraction = beamOverlap(geometry, { ...box, x: p.x + (box.offsetX ?? 0), y: p.y + (box.offsetY ?? 0) });
						if (fraction !== undefined) contacts.push({ kind: 'solid', attackId: entity.id, ownerId: volume.ownerId, obstacleId: solid.id, fraction });
					}
					contacts.sort(function (a, b) {
						return a.fraction - b.fraction || Number(a.kind === 'target') - Number(b.kind === 'target')
							|| (a.kind === 'target' ? a.hurtboxId : a.obstacleId) - (b.kind === 'target' ? b.hurtboxId : b.obstacleId);
					});
					for (const contact of contacts) {
						if (contact.kind === 'target' && getCombatContact(ecs, entity.id, contact.hurtboxId)) {
							const { attackId, ownerId, targetId, hurtboxId } = contact;
							ecs.eventBus.publish('combatContact', { attackId, ownerId, targetId, hurtboxId });
						}
					}
					if (ecs.getEntity(entity.id) && ecs.getEntity(volume.ownerId) && volume.active) {
						ecs.eventBus.publish('beamScan', { attackId: entity.id, ownerId: volume.ownerId, geometry, contacts });
					}
				}
			});
	});
