import { createTransform } from 'ecspresso/plugins/spatial/transform';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createCombatVolume, layers } from './combat';
import { createBeam } from './beam';
import type { GameWorld } from './game';

export const BEAM_FIXTURE = { x: 240, y: 110, length: 600, width: 12, targetXs: [380, 700], wallX: 540, targetWidth: 4, targetHeight: 32 } as const;
export const spawnBeamFixture = function (world: Pick<GameWorld, 'spawn' | 'spawnChild'>) {
	const f = BEAM_FIXTURE;
	const owner = world.spawn({});
	const targets = f.targetXs.map(function (x) {
		const target = world.spawn({ ...createTransform(x, f.y) });
		const hurtbox = world.spawnChild(target.id, createCombatVolume(target.id, 'hurtbox', f.targetWidth, f.targetHeight));
		return { target, hurtbox };
	});
	const wall = world.spawn({ ...createTransform(f.wallX, f.y), ...createAABBCollider(8, 48), ...createRigidBody('static'), ...layers.platform() });
	const beam = world.spawn(createBeam(owner.id, { x: f.x, y: f.y }, { x: f.x + f.length, y: f.y }, f.width, false));
	return { owner, targets, wall, beam };
};
