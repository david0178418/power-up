import { SIMULATION_GROUP } from './hit-stop';
import { definePlugin } from 'ecspresso';
import { beamOverlap, type Beam } from './rectangle-geometry';
import { collisionSystems, defineCollisionLayers, createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createTransform, type TransformWorldConfig } from 'ecspresso/plugins/spatial/transform';
import type { CollisionComponentTypes, CollisionEventTypes } from 'ecspresso/plugins/physics/collision';

export const layers = defineCollisionLayers({
	player: ['platform'], groundEnemy: ['platform', 'groundEnemy'], platform: ['player', 'groundEnemy'], attack: ['hurtbox'], hurtbox: ['attack'],
});
type Layer = keyof typeof layers;

export interface CombatRectangle { width: number; height: number; aim: { x: number; y: number } }

export const combatRectangleBeam = function (center: { x: number; y: number }, rectangle: CombatRectangle): Beam {
	const { aim, width, height } = rectangle;
	return {
		from: { x: center.x - aim.x * width / 2, y: center.y - aim.y * width / 2 },
		to: { x: center.x + aim.x * width / 2, y: center.y + aim.y * width / 2 },
		width: height,
	};
};

export const combatRectanglePoints = function (center: { x: number; y: number }, rectangle: CombatRectangle): number[] {
	const { aim, width, height } = rectangle;
	return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(function ([x = 0, y = 0]) {
		return [center.x + aim.x * x * width / 2 - aim.y * y * height / 2,
			center.y + aim.y * x * width / 2 + aim.x * y * height / 2];
	});
};

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

interface CombatLookup {
	getComponent(id: number, name: 'combatVolume'): CombatVolume | undefined;
	getEntity(id: number): unknown;
}

// Shared identity/activation boundary for endpoint and swept contacts.
export const getCombatContact = function (world: CombatLookup, attackId: number, hurtboxId: number): CombatContact | undefined {
	const attack = world.getComponent(attackId, 'combatVolume');
	const target = world.getComponent(hurtboxId, 'combatVolume');
	if (attack?.kind !== 'attack' || target?.kind !== 'hurtbox' || !attack.active || !target.active) return undefined;
	if (!world.getEntity(attack.ownerId) || !world.getEntity(target.ownerId)) return undefined;
	return { attackId, ownerId: attack.ownerId, hurtboxId, targetId: target.ownerId };
};

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
	.withComponentTypes<{ combatVolume: CombatVolume; combatRectangle: CombatRectangle }>()
	.withEventTypes<{ combatContact: CombatContact; combatScan: undefined }>()
	.install(function (systems) {
		systems.addSystem('combat-scan').inGroup(SIMULATION_GROUP)
			.inPhase('fixedUpdate').before(collisionSystems.detect)
			.setProcess(function ({ ecs }) { ecs.eventBus.publish('combatScan', undefined); });
		systems.addSystem('combat-contact').setEventHandlers({
			collision({ data, ecs }) {
				const attackId = data.layerA === 'attack' ? data.entityA : data.entityB;
				const hurtboxId = data.layerA === 'hurtbox' ? data.entityA : data.entityB;
				const contact = getCombatContact(ecs, attackId, hurtboxId);
				if (!contact) return;
				const rectangle = ecs.getComponent(attackId, 'combatRectangle');
				if (rectangle) {
					const center = ecs.getComponent(attackId, 'worldTransform');
					const target = ecs.getComponent(hurtboxId, 'worldTransform');
					const box = ecs.getComponent(hurtboxId, 'aabbCollider');
					if (!center || !target || !box || beamOverlap(combatRectangleBeam(center, rectangle), {
						...box, x: target.x + (box.offsetX ?? 0), y: target.y + (box.offsetY ?? 0),
					}) === undefined) return;
				}
				ecs.eventBus.publish('combatContact', contact);
			},
		});
	});
