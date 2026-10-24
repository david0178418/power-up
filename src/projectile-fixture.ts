import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createCombatVolume, layers } from './combat';
import { createProjectile } from './projectile';
import type { GameWorld } from './game';

export const PROJECTILE_FIXTURE = {
	x: 240, y: 200, width: 8, height: 8, speed: 24000, lifetime: 0.35,
	targetWidth: 4, targetHeight: 40, targetXs: [380, 500], wallX: 620, wallWidth: 8, wallHeight: 60,
} as const;

export const spawnProjectileFixture = function (world: Pick<GameWorld, 'spawn' | 'spawnChild'>) {
	const f = PROJECTILE_FIXTURE;
	const owner = world.spawn({ ...createTransform(f.x, f.y) });
	const targets = f.targetXs.map(function (x) {
		const target = world.spawn({ ...createTransform(x, f.y) });
		const hurtbox = world.spawnChild(target.id, createCombatVolume(target.id, 'hurtbox', f.targetWidth, f.targetHeight));
		return { target, hurtbox };
	});
	const wall = world.spawn({ ...createTransform(f.wallX, f.y), ...createRigidBody('static'),
		...createAABBCollider(f.wallWidth, f.wallHeight), ...layers.platform() });
	return { owner, targets, wall };
};

export const launchFixtureProjectile = function (
	world: Pick<GameWorld, 'spawn'>, ownerId: number, speed: number, lifetime: number, nearMiss: boolean,
) {
	const f = PROJECTILE_FIXTURE;
	return world.spawn(createProjectile(ownerId, { x: f.x, y: f.y - (nearMiss ? 40 : 0) }, { x: speed, y: 0 }, f.width, f.height, lifetime));
};
