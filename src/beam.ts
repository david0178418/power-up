import { SIMULATION_GROUP } from './hit-stop';
import { definePlugin } from 'ecspresso';
import { collisionSystems, type CollisionComponentTypes } from 'ecspresso/plugins/physics/collision';
import type { Physics2DOwnComponentTypes } from 'ecspresso/plugins/physics/physics2D';
import type { TransformWorldConfig } from 'ecspresso/plugins/spatial/transform';
import { getCombatContact, layers, type CombatContact, type CombatVolume } from './combat';

import { beamOverlap, validateBeam, type Beam, type Point } from './rectangle-geometry';
export { beamOverlap, validateBeam, type Beam } from './rectangle-geometry';

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
		systems.addSystem('beam-scan').inGroup(SIMULATION_GROUP).inPhase('fixedUpdate').after(collisionSystems.detect)
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
