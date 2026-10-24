import { definePlugin } from 'ecspresso';
import { collisionSystems, defineCollisionLayers, createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createTransform, type TransformWorldConfig } from 'ecspresso/plugins/spatial/transform';
import type { CollisionComponentTypes, CollisionEventTypes } from 'ecspresso/plugins/physics/collision';

export const layers = defineCollisionLayers({
	player: ['platform'], platform: ['player'], attack: ['hurtbox'], hurtbox: ['attack'],
});
type Layer = keyof typeof layers;

export interface CombatVolume {
	ownerId: number;
	kind: 'attack' | 'hurtbox';
	active: boolean;
}

export interface CombatContact {
	attackId: number;
	ownerId: number;
	hurtboxId: number;
	targetId: number;
}

// Separate entities carry these colliders; they never carry rigidBody.
export const createCombatVolume = function (
	ownerId: number, kind: CombatVolume['kind'], width: number, height: number,
	x = 0, y = 0, active = true,
) {
	if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new RangeError('Combat volumes require finite offsets and positive dimensions.');
	}
	return {
		combatVolume: { ownerId, kind, active },
		...createTransform(x, y),
		...createAABBCollider(width, height),
		...layers[kind === 'attack' ? 'attack' : 'hurtbox'](),
	};
};

export const combat = definePlugin('combat')
	.requires<TransformWorldConfig & {
		components: CollisionComponentTypes<Layer>;
		events: CollisionEventTypes<Layer>;
	}>()
	.withComponentTypes<{ combatVolume: CombatVolume }>()
	.withEventTypes<{ combatContact: CombatContact; combatScan: undefined }>()
	.install(function (systems) {
		systems.addSystem('combat-scan')
			.inPhase('fixedUpdate').before(collisionSystems.detect)
			.setProcess(function ({ ecs }) { ecs.eventBus.publish('combatScan', undefined); });
		systems.addSystem('combat-contact').setEventHandlers({
			collision({ data, ecs }) {
				const attackId = data.layerA === 'attack' ? data.entityA : data.entityB;
				const hurtboxId = data.layerA === 'hurtbox' ? data.entityA : data.entityB;
				const attack = ecs.getComponent(attackId, 'combatVolume');
				const target = ecs.getComponent(hurtboxId, 'combatVolume');
				if (attack?.kind !== 'attack' || target?.kind !== 'hurtbox' || !attack.active || !target.active) return;
				if (!ecs.getEntity(attack.ownerId) || !ecs.getEntity(target.ownerId)) return;
				ecs.eventBus.publish('combatContact', { attackId, ownerId: attack.ownerId, hurtboxId, targetId: target.ownerId });
			},
		});
	});
