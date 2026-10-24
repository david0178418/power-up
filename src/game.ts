import ECSpresso, { definePlugin, defineSystemRef, type ConfigOf } from 'ecspresso';
import { createInputPlugin, inputSystems, type InputPluginOptions } from 'ecspresso/plugins/input/input';
import { createPhysics2DPlugin, createRigidBody, physics2DSystems } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider, createCollisionPlugin } from 'ecspresso/plugins/physics/collision';
import { createTransform, createTransformPlugin, transformSystems } from 'ecspresso/plugins/spatial/transform';

import { combat, createCombatVolume, layers } from './combat';
import { projectiles } from './projectile';
import { beams } from './beam';

// Simulation bounds are independent of the renderer's logical viewport.
export const LEVEL_BOUNDS = { left: 0, top: 0, right: 960, bottom: 540 } as const;
export const STEP = 1 / 60;
export const PLATFORM = { x: 480, y: 410, width: 640, height: 32 } as const;
export const PLAYER = { width: 32, height: 44, speed: 260, jumpSpeed: 520 } as const;
export const START = { x: 480, y: PLATFORM.y - PLATFORM.height / 2 - PLAYER.height / 2 } as const;

export const ENEMY = { width: 30, height: 40 } as const;
export const ATTACK = { width: 56, height: 36, offset: 40 } as const;

type Action = 'left' | 'right' | 'jump' | 'attack';
const fallReset = defineSystemRef('game.fall-reset');
const playerControl = defineSystemRef('game.player-control');
const pads = [0, 1, 2, 3];

const createBaseBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return ECSpresso.create()
		.withFixedTimestep(STEP)
		.withPlugin(createTransformPlugin({ phase: 'fixedUpdate', after: [fallReset] }))
		.withPlugin(createPhysics2DPlugin({
			gravity: { x: 0, y: 1400 }, layers,
			before: [physics2DSystems.collide],
		}))
		.withPlugin(createCollisionPlugin({ layers, phase: 'fixedUpdate', after: [transformSystems.propagate] }))
		.withPlugin(combat)
		.withPlugin(projectiles)
		.withPlugin(beams)
		.withPlugin(createInputPlugin<Action>({
			...input,
			// Sample edges once per simulation tick: no lost edges on zero-step frames,
			// and no repeated edges when one rendered frame contains multiple ticks.
			phase: 'fixedUpdate',
			preventDefaultKeys: [' ', 'ArrowLeft', 'ArrowRight'],
			actions: {
				left: { keys: ['a', 'A', 'ArrowLeft'], gamepadButtons: pads.map(pad => ({ pad, button: 14 })) },
				right: { keys: ['d', 'D', 'ArrowRight'], gamepadButtons: pads.map(pad => ({ pad, button: 15 })) },
				attack: { keys: ['j', 'J'], gamepadButtons: pads.map(pad => ({ pad, button: 2 })) },
				jump: { keys: [' '], gamepadButtons: pads.map(pad => ({ pad, button: 0 })) },
			},
		}));
};

type BaseWorld = ReturnType<ReturnType<typeof createBaseBuilder>['build']>;

const gameplay = definePlugin('gameplay')
	.requires<ConfigOf<BaseWorld>>()
	.withComponentTypes<{ player: { grounded: boolean; facing: -1 | 1 }; platform: true; enemy: true; fixtureAttack: true }>()
	.install(function (systems) {
		systems.addSystem('player-control').withRef(playerControl)
			.inPhase('fixedUpdate').after(inputSystems.update).before(physics2DSystems.integrate)
			.withResources(['inputState'])
			.setProcessEach(
				{ with: ['player', 'velocity'], mutates: ['player', 'velocity'] },
				({ entity, resources: { inputState: input } }) => {
					const { player, velocity } = entity.components;
					const digital = Number(input.actions.isActive('right')) - Number(input.actions.isActive('left'));
					const stick = input.gamepads.reduce(function (strongest, pad) {
						const x = pad.axis(0);
						return Math.abs(x) > Math.abs(strongest) ? x : strongest;
					}, 0);
					velocity.x = (digital || stick) * PLAYER.speed;
					if (velocity.x !== 0) player.facing = velocity.x < 0 ? -1 : 1;
					if (player.grounded && input.actions.justActivated('jump')) velocity.y = -PLAYER.jumpSpeed;
					// Physics will re-establish contact after integration and resolution.
					player.grounded = false;
				},
			);

		systems.addSystem('fixture-attack')
			.inPhase('fixedUpdate').after(playerControl).before(transformSystems.propagate)
			.withResources(['inputState'])
			.setProcessEach(
				{ with: ['fixtureAttack', 'combatVolume', 'localTransform'], mutates: ['combatVolume', 'localTransform'] },
				function ({ entity, ecs, resources: { inputState } }) {
					const volume = entity.components.combatVolume;
					const owner = ecs.getComponent(volume.ownerId, 'player');
					if (volume.kind !== 'attack' || !owner) return false;
					volume.active = inputState.actions.isActive('attack');
					entity.components.localTransform.x = owner.facing * ATTACK.offset;
					return true;
				},
			);

		systems.addSystem('ground-contact').setEventHandlers({
			physicsCollision({ data, ecs }) {
				const id = data.normalY > 0.5 ? data.entityA : data.normalY < -0.5 ? data.entityB : undefined;
				if (id === undefined) return;
				const player = ecs.getComponent(id, 'player');
				if (player) ecs.mutateComponent(id, 'player', function (state) { state.grounded = true; });
			},
		});

		systems.addSystem('fall-reset').withRef(fallReset)
			.inPhase('fixedUpdate').after(physics2DSystems.collide)
			.setProcessEach(
				{ with: ['player', 'localTransform', 'velocity', 'force'], mutates: ['player', 'localTransform', 'velocity', 'force'] },
				({ entity }) => {
					const { player, localTransform, velocity, force } = entity.components;
					if (localTransform.y < LEVEL_BOUNDS.bottom + PLAYER.height) return false;
					localTransform.x = START.x;
					localTransform.y = START.y;
					velocity.x = 0;
					velocity.y = 0;
					force.x = 0;
					force.y = 0;
					player.grounded = true;
					return true;
				},
			);
});

export const createGameBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return createBaseBuilder(input).withPlugin(gameplay);
};

export type GameWorld = ReturnType<ReturnType<typeof createGameBuilder>['build']>;

export const spawnLevel = function (world: Pick<GameWorld, 'spawn' | 'spawnChild'>) {
	const platform = world.spawn({
		platform: true,
		...createTransform(PLATFORM.x, PLATFORM.y),
		...createRigidBody('static'),
		...createAABBCollider(PLATFORM.width, PLATFORM.height),
		...layers.platform(),
	});
	const player = world.spawn({
		player: { grounded: true, facing: 1 },
		...createTransform(START.x, START.y),
		...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
		velocity: { x: 0, y: 0 },
		...createAABBCollider(PLAYER.width, PLAYER.height),
		...layers.player(),
	});
	const attack = world.spawnChild(player.id, { fixtureAttack: true, ...createCombatVolume(player.id, 'attack', ATTACK.width, ATTACK.height, ATTACK.offset, 0, false) });
	const enemies = [540, 300, 710].map(function (x) {
		const enemy = world.spawn({ enemy: true, ...createTransform(x, PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2) });
		const hurtbox = world.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
		return { enemy, hurtbox };
	});
	return { player, platform, attack, enemies };
};
