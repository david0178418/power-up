import { SIMULATION_GROUP } from './hit-stop';
import { definePlugin, defineSystemRef } from 'ecspresso';
import { collisionSystems, type CollisionComponentTypes } from 'ecspresso/plugins/physics/collision';
import type { Physics2DOwnComponentTypes } from 'ecspresso/plugins/physics/physics2D';
import { transformSystems, type TransformWorldConfig } from 'ecspresso/plugins/spatial/transform';
import { createCombatVolume, getCombatContact, layers, type CombatContact, type CombatVolume } from './combat';

interface Point { readonly x: number; readonly y: number }
interface Box extends Point { readonly width: number; readonly height: number }

export interface Projectile {
	velocity: Point;
	remainingLifetime: number;
	lifetime: number;
	elapsedTicks: number;
	previous: Point;
	stepDuration: number;
	remainingRange?: number;
}

export type ProjectileContact = (
	| (CombatContact & { kind: 'target' })
	| { kind: 'solid'; attackId: number; ownerId: number; obstacleId: number }
) & { fraction: number; position: Point };

export interface ProjectileSweep {
	attackId: number;
	ownerId: number;
	from: Point;
	to: Point;
	contacts: readonly ProjectileContact[];
}

// Slab test against the target expanded by the projectile's half extents.
// Strict positive overlap matches combat AABBs: edge/corner tangency alone misses.
// fraction is the entry boundary of that overlap; starting overlap returns zero.
export const sweepAABB = function (from: Point, to: Point, size: Pick<Box, 'width' | 'height'>, target: Box): number | undefined {
	let enter = -Infinity;
	let exit = Infinity;
	for (const axis of ['x', 'y'] as const) {
		const half = (axis === 'x' ? target.width + size.width : target.height + size.height) / 2;
		const low = target[axis] - half;
		const high = target[axis] + half;
		const delta = to[axis] - from[axis];
		if (delta === 0) {
			if (from[axis] <= low || from[axis] >= high) return undefined;
			continue;
		}
		const a = (low - from[axis]) / delta;
		const b = (high - from[axis]) / delta;
		enter = Math.max(enter, Math.min(a, b));
		exit = Math.min(exit, Math.max(a, b));
	}
	return Math.max(enter, 0) < Math.min(exit, 1) ? Math.max(enter, 0) : undefined;
};

// Spawn as a root entity. No rigidBody (no gravity/solver), and no collisionLayer
// (swept contacts exclusively; endpoint detection must not report them again).
export const createProjectile = function (
	ownerId: number, position: Point, velocity: Point, width: number, height: number, lifetime: number, range?: number,
) {
	if (![velocity.x, velocity.y, lifetime].every(Number.isFinite) || lifetime <= 0) {
		throw new RangeError('Projectiles require finite velocity and a positive finite lifetime.');
	}
	if (range !== undefined && (!Number.isFinite(range) || range <= 0)) throw new RangeError('Projectile range must be positive and finite.');
	const { collisionLayer: _layer, ...volume } = createCombatVolume(ownerId, 'attack', width, height, position.x, position.y);
	const projectile: Projectile = { velocity: { ...velocity }, remainingLifetime: lifetime, lifetime, elapsedTicks: 0, previous: { ...position }, stepDuration: 0, ...(range === undefined ? {} : { remainingRange: range }) };
	return { ...volume, projectile };
};

export const projectileSystems = { move: defineSystemRef('projectiles.move') };
const { move } = projectileSystems;
type Layer = keyof typeof layers;

export const projectiles = definePlugin('projectiles')
	.requires<TransformWorldConfig & {
		components: CollisionComponentTypes<Layer> & Physics2DOwnComponentTypes & { combatVolume: CombatVolume };
		events: { combatContact: CombatContact };
	}>()
	.withComponentTypes<{ projectile: Projectile }>()
	.withEventTypes<{ projectileSweep: ProjectileSweep }>()
	.install(function (systems) {
		systems.addSystem('projectile-move').inGroup(SIMULATION_GROUP).withRef(move)
			.inPhase('fixedUpdate').before(transformSystems.propagate)
			.setProcessEach(
				{ with: ['projectile', 'localTransform'], mutates: ['projectile', 'localTransform'] },
				function ({ entity, dt, ecs }) {
					if (ecs.getParent(entity.id) !== null) throw new Error('Projectiles must be root entities in world coordinates.');
					const { projectile, localTransform } = entity.components;
					const combatVolume = ecs.getComponent(entity.id, 'combatVolume');
					projectile.stepDuration = 0;
					projectile.previous = { x: localTransform.x, y: localTransform.y };
					if (!combatVolume || !ecs.getComponent(entity.id, 'aabbCollider') || !ecs.getEntity(combatVolume.ownerId)) {
						ecs.commands.removeEntity(entity.id);
						projectile.remainingLifetime = 0;
						return;
					}
					const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
					const rangeTime = projectile.remainingRange === undefined || speed === 0 ? Infinity : projectile.remainingRange / speed;
					const travelTime = Math.min(dt, Math.max(0, projectile.remainingLifetime), rangeTime);
					projectile.stepDuration = travelTime;
					localTransform.x += projectile.velocity.x * travelTime;
					localTransform.y += projectile.velocity.y * travelTime;
					if (projectile.remainingRange !== undefined) {
						const remaining = projectile.remainingRange - speed * travelTime;
						projectile.remainingRange = remaining <= 1e-9 ? 0 : remaining;
					}
					// Derive age from integer ticks instead of accumulating subtraction error.
					projectile.elapsedTicks += 1;
					const age = projectile.elapsedTicks * dt;
					const remaining = projectile.lifetime - age;
					const roundoff = Number.EPSILON * Math.max(projectile.lifetime, age) * 4;
					projectile.remainingLifetime = remaining <= roundoff ? 0 : remaining;
				},
			);
		systems.addSystem('projectile-sweep').inGroup(SIMULATION_GROUP)
			.inPhase('fixedUpdate').after(move, collisionSystems.detect)
			.addQuery('shots', { with: ['projectile', 'combatVolume', 'localTransform', 'aabbCollider'], mutates: [] })
			.addQuery('targets', { with: ['combatVolume', 'worldTransform', 'aabbCollider'], mutates: [] })
			.addQuery('solids', { with: ['rigidBody', 'worldTransform', 'aabbCollider'], mutates: [] })
			.setProcess(function ({ queries, ecs }) {
				for (const shot of queries.shots) {
					const { projectile, combatVolume, localTransform, aabbCollider: size } = shot.components;
					if (!ecs.getEntity(shot.id)) continue;
					if (projectile.stepDuration <= 0) { ecs.commands.removeEntity(shot.id); continue; }
					const contacts: ProjectileContact[] = [];
					const from = projectile.previous;
					const to = { x: localTransform.x, y: localTransform.y };
					const contactAt = function (fraction: number) {
						return { fraction, position: { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction } };
					};
					if (combatVolume.active && ecs.getEntity(combatVolume.ownerId)) {
						for (const target of queries.targets) {
							const contact = getCombatContact(ecs, shot.id, target.id);
							if (!contact) continue;
							const { worldTransform: p, aabbCollider: box } = target.components;
							const fraction = sweepAABB(from, to, size, { x: p.x + (box.offsetX ?? 0), y: p.y + (box.offsetY ?? 0), ...box });
							if (fraction !== undefined) contacts.push({ kind: 'target', ...contact, ...contactAt(fraction) });
						}
						for (const solid of queries.solids) {
							if (solid.components.rigidBody.type !== 'static') continue;
							const { worldTransform: p, aabbCollider: box } = solid.components;
							const fraction = sweepAABB(from, to, size, { x: p.x + (box.offsetX ?? 0), y: p.y + (box.offsetY ?? 0), ...box });
							if (fraction !== undefined) contacts.push({ kind: 'solid', attackId: shot.id, ownerId: combatVolume.ownerId, obstacleId: solid.id, ...contactAt(fraction) });
						}
					}
					// Exact ties: solid before target, then ascending collider entity ID.
					contacts.sort(function (a, b) {
						return a.fraction - b.fraction || Number(a.kind === 'target') - Number(b.kind === 'target')
							|| (a.kind === 'target' ? a.hurtboxId : a.obstacleId) - (b.kind === 'target' ? b.hurtboxId : b.obstacleId);
					});
					for (const contact of contacts) {
						if (contact.kind === 'target' && getCombatContact(ecs, shot.id, contact.hurtboxId)) {
							const { attackId, ownerId, hurtboxId, targetId } = contact;
							ecs.eventBus.publish('combatContact', { attackId, ownerId, hurtboxId, targetId });
						}
					}
					if (ecs.getEntity(shot.id) && ecs.getEntity(combatVolume.ownerId)) {
						ecs.eventBus.publish('projectileSweep', { attackId: shot.id, ownerId: combatVolume.ownerId, from, to, contacts });
					}
					if (projectile.remainingLifetime <= 0 || projectile.remainingRange === 0) ecs.commands.removeEntity(shot.id);
				}
			});
	});
