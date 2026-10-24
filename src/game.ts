import ECSpresso, { definePlugin, type ConfigOf } from 'ecspresso';
import { createInputPlugin, inputSystems, type InputPluginOptions } from 'ecspresso/plugins/input/input';
import { createPhysics2DPlugin, createRigidBody, physics2DSystems } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider, defineCollisionLayers } from 'ecspresso/plugins/physics/collision';
import { createTransform, createTransformPlugin } from 'ecspresso/plugins/spatial/transform';

// Simulation bounds are independent of the renderer's logical viewport.
export const LEVEL_BOUNDS = { left: 0, top: 0, right: 960, bottom: 540 } as const;
export const STEP = 1 / 60;
export const PLATFORM = { x: 480, y: 410, width: 640, height: 32 } as const;
export const PLAYER = { width: 32, height: 44, speed: 260, jumpSpeed: 520 } as const;
export const START = { x: 480, y: PLATFORM.y - PLATFORM.height / 2 - PLAYER.height / 2 } as const;

type Action = 'left' | 'right' | 'jump';
const pads = [0, 1, 2, 3];
const layers = defineCollisionLayers({ player: ['platform'], platform: ['player'] });

const createBaseBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return ECSpresso.create()
		.withFixedTimestep(STEP)
		.withPlugin(createTransformPlugin())
		.withPlugin(createPhysics2DPlugin({
			gravity: { x: 0, y: 1400 }, layers,
			before: [physics2DSystems.collide],
		}))
		.withPlugin(createInputPlugin<Action>({
			...input,
			// Sample edges once per simulation tick: no lost edges on zero-step frames,
			// and no repeated edges when one rendered frame contains multiple ticks.
			phase: 'fixedUpdate',
			preventDefaultKeys: [' ', 'ArrowLeft', 'ArrowRight'],
			actions: {
				left: { keys: ['a', 'A', 'ArrowLeft'], gamepadButtons: pads.map(pad => ({ pad, button: 14 })) },
				right: { keys: ['d', 'D', 'ArrowRight'], gamepadButtons: pads.map(pad => ({ pad, button: 15 })) },
				jump: { keys: [' '], gamepadButtons: pads.map(pad => ({ pad, button: 0 })) },
			},
		}));
};

type BaseWorld = ReturnType<ReturnType<typeof createBaseBuilder>['build']>;

const gameplay = definePlugin('gameplay')
	.requires<ConfigOf<BaseWorld>>()
	.withComponentTypes<{ player: { grounded: boolean }; platform: true }>()
	.install(function (systems) {
		systems.addSystem('player-control')
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
					if (player.grounded && input.actions.justActivated('jump')) velocity.y = -PLAYER.jumpSpeed;
					// Physics will re-establish contact after integration and resolution.
					player.grounded = false;
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

		systems.addSystem('fall-reset')
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

type GameWorld = ReturnType<ReturnType<typeof createGameBuilder>['build']>;

export const spawnLevel = function (world: Pick<GameWorld, 'spawn'>) {
	const platform = world.spawn({
		platform: true,
		...createTransform(PLATFORM.x, PLATFORM.y),
		...createRigidBody('static'),
		...createAABBCollider(PLATFORM.width, PLATFORM.height),
		...layers.platform(),
	});
	const player = world.spawn({
		player: { grounded: true },
		...createTransform(START.x, START.y),
		...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
		velocity: { x: 0, y: 0 },
		...createAABBCollider(PLAYER.width, PLAYER.height),
		...layers.player(),
	});
	return { player, platform };
};
