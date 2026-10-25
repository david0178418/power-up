import ECSpresso, { definePlugin, defineSystemRef, type ConfigOf } from 'ecspresso';
import { createInputPlugin, inputSystems, type InputPluginOptions } from 'ecspresso/plugins/input/input';
import { createPhysics2DPlugin, createRigidBody, physics2DSystems } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider, createCollisionPlugin } from 'ecspresso/plugins/physics/collision';
import { createTransform, createTransformPlugin, transformSystems } from 'ecspresso/plugins/spatial/transform';

import { combat, createCombatVolume, layers } from './combat';
import { projectiles } from './projectile';
import { beams } from './beam';
import { createTouchInput } from './touch-input';
import { createMeleeState, inMeleeCone, MELEE, type MeleeState, type HitReaction } from './melee';

// Simulation bounds are independent of the renderer's logical viewport.
export const LEVEL_BOUNDS = { left: 0, top: 0, right: 960, bottom: 540 } as const;
export const STEP = 1 / 60;
export const PLATFORM = { x: 480, y: 410, width: 640, height: 32 } as const;
export const PLAYER = { width: 32, height: 44, speed: 260, jumpSpeed: 520 } as const;
export const START = { x: 480, y: PLATFORM.y - PLATFORM.height / 2 - PLAYER.height / 2 } as const;

export const ENEMY = { width: 30, height: 40 } as const;
export const GROUND_ENEMY = { speed: 90, spawnInterval: 2, limit: 8 } as const;
export const ATTACK = { width: 56, height: 36, offset: 40 } as const;

type Action = 'left' | 'right' | 'jump' | 'attack';
const groundSpawn = defineSystemRef('gameplay.ground-spawn');
const fallReset = defineSystemRef('game.fall-reset');
const playerControl = defineSystemRef('game.player-control');
const meleeControl = defineSystemRef('game.melee-control');
const enemyReaction = defineSystemRef('game.enemy-reaction');
const pads = [0, 1, 2, 3];

const createBaseBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return ECSpresso.create()
		.withFixedTimestep(STEP)
		.withResource('touchInput', createTouchInput())
		.withScreens(function (screens) {
			return screens.add('test', { initialState: function () { return {}; } })
				.add('gameplay', { initialState: function () { return {}; } });
		})
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
	.withComponentTypes<{ player: { grounded: boolean; facing: -1 | 1 }; platform: true; enemy: true; groundChaser: true; fixtureAttack: true; melee: MeleeState; hitReaction: HitReaction }>()
	.withResourceTypes<{ groundSpawns: { remaining: number; spawned: number } }>()
	.install(function (systems, onCleanup) {
		let jumpHeld = false;
		onCleanup(systems.onScreenEnter('gameplay', function ({ ecs }) {
			const spawns = ecs.getResource('groundSpawns');
			spawns.remaining = 0;
			spawns.spawned = 0;
		}));
		systems.addResource('groundSpawns', { remaining: 0, spawned: 0 });
		systems.addSystem('ground-spawn').withRef(groundSpawn)
			.inScreens(['gameplay']).inPhase('fixedUpdate').before(physics2DSystems.integrate)
			.withResources(['groundSpawns'])
			.addQuery('enemies', { with: ['groundChaser'] })
			.runWhenEmpty()
			.setProcess(function ({ ecs, dt, resources: { groundSpawns }, queries }) {
				groundSpawns.remaining -= dt;
				if (groundSpawns.remaining > 1e-9) return;
				groundSpawns.remaining = GROUND_ENEMY.spawnInterval;
				if (queries.enemies.length >= GROUND_ENEMY.limit) return;
				const x = PLATFORM.x + (groundSpawns.spawned % 2 === 0 ? -1 : 1) * (PLATFORM.width / 2 - ENEMY.width);
				// Immediate visibility lets the child hurtbox and this tick's physics share the new owner.
				const enemy = ecs.spawn({
					enemy: true, groundChaser: true, hitReaction: { remaining: 0, push: 0 },
					...createTransform(x, PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2),
					...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
					velocity: { x: 0, y: 0 },
					...createAABBCollider(ENEMY.width, ENEMY.height), ...layers.groundEnemy(),
				});
				ecs.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
				groundSpawns.spawned++;
			});

		systems.addSystem('ground-chase')
			.inScreens(['gameplay']).inPhase('fixedUpdate').after(groundSpawn).before(enemyReaction).before(physics2DSystems.integrate)
			.addSingleton('target', { with: ['player', 'localTransform'] })
			.addQuery('enemies', { with: ['groundChaser', 'localTransform', 'velocity'], mutates: ['velocity'] })
			.setProcess(function ({ queries, dt, ecs }) {
				const target = queries.target;
				if (!target) return;
				const left = PLATFORM.x - PLATFORM.width / 2 + ENEMY.width / 2;
				const right = PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2;
				for (const { id, components: { localTransform, velocity } } of queries.enemies) {
					if ((ecs.getComponent(id, 'hitReaction')?.remaining ?? 0) > 0) continue;
					const distance = target.components.localTransform.x - localTransform.x;
					const travel = Math.sign(distance) * Math.min(GROUND_ENEMY.speed * dt, Math.max(0, Math.abs(distance) - (PLAYER.width + ENEMY.width) / 2));
					velocity.x = (Math.max(left, Math.min(right, localTransform.x + travel)) - localTransform.x) / dt;
				}
			});

		systems.addSystem('player-control').withRef(playerControl)
			.inPhase('fixedUpdate').after(inputSystems.update).before(physics2DSystems.integrate)
			.withResources(['inputState', 'touchInput'])
			.setProcessEach(
				{ with: ['player', 'velocity'], mutates: ['player', 'velocity'] },
				({ entity, resources: { inputState: input, touchInput } }) => {
					const { player, velocity } = entity.components;
					const digital = Number(input.actions.isActive('right')) - Number(input.actions.isActive('left'));
					const stick = input.gamepads.reduce(function (strongest, pad) {
						const x = pad.axis(0);
						return Math.abs(x) > Math.abs(strongest) ? x : strongest;
					}, 0);
					velocity.x = (digital || touchInput.move || stick) * PLAYER.speed;
					if (velocity.x !== 0) player.facing = velocity.x < 0 ? -1 : 1;
					const jump = input.actions.isActive('jump') || touchInput.jump;
					if (player.grounded && jump && !jumpHeld) velocity.y = -PLAYER.jumpSpeed;
					jumpHeld = jump;
					// Physics will re-establish contact after integration and resolution.
					player.grounded = false;
				},
			);

		systems.addSystem('melee-control').withRef(meleeControl)
			.inPhase('fixedUpdate').after(playerControl).before(physics2DSystems.integrate)
			.withResources(['inputState', 'touchInput'])
			.addQuery('targets', { with: ['enemy', 'localTransform'] })
			.addQuery('hurtboxes', { with: ['combatVolume'] })
			.addQuery('players', { with: ['player', 'melee', 'velocity', 'localTransform'], mutates: ['player', 'melee', 'velocity'] })
			.setProcess(function ({ queries, dt, resources: { inputState, touchInput } }) {
				const held = inputState.actions.isActive('attack') || touchInput.attack;
				for (const { components: { melee, player, velocity, localTransform: position } } of queries.players) {
					if (held && !melee.held) melee.queued = true;
					melee.held = held;
					melee.remaining = Math.max(0, melee.remaining - dt);
					if (melee.active && melee.remaining <= 1e-9) {
						melee.active = false;
						melee.remaining = melee.strike === 3 ? MELEE.finisherRecovery : MELEE.recovery;
					}
					if (!melee.active && melee.remaining <= 1e-9) {
						melee.idle += dt;
						if (melee.idle >= MELEE.reset) melee.strike = 0;
						if (held || melee.queued) {
							melee.strike = melee.strike % 3 + 1;
							melee.active = true;
							melee.remaining = MELEE.active;
							melee.idle = 0;
							melee.queued = false;
							melee.direction = player.facing;
							melee.hitTargets.clear();
							// Assist only toward the nearest live hurtbox inside the forward cone.
							const target = queries.targets.filter(function (candidate) {
								const p = candidate.components.localTransform;
								return inMeleeCone(p.x - position.x, p.y - position.y, player.facing)
									&& queries.hurtboxes.some(function (volume) {
										return volume.components.combatVolume.ownerId === candidate.id
											&& volume.components.combatVolume.kind === 'hurtbox' && volume.components.combatVolume.active;
									});
							}).sort(function (a, b) {
								const distance = function (p: { x: number; y: number }) { return Math.hypot(p.x - position.x, p.y - position.y); };
								return distance(a.components.localTransform) - distance(b.components.localTransform) || a.id - b.id;
							})[0];
							const gap = target ? Math.max(0, (target.components.localTransform.x - position.x) * melee.direction - (PLAYER.width + ENEMY.width) / 2) : Infinity;
							melee.lunge = Math.min(target ? MELEE.magnetismSpeed : MELEE.lungeSpeed, gap / MELEE.active);
						}
					}
					if (melee.active) {
						player.facing = melee.direction;
						velocity.x = melee.direction * melee.lunge;
					}
				}
			});

		systems.addSystem('fixture-attack')
			.inPhase('fixedUpdate').after(meleeControl).after(fallReset).before(transformSystems.propagate)
			.setProcessEach(
				{ with: ['fixtureAttack', 'combatVolume', 'localTransform'], mutates: ['combatVolume', 'localTransform'] },
				function ({ entity, ecs }) {
					const volume = entity.components.combatVolume;
					const melee = ecs.getComponent(volume.ownerId, 'melee');
					if (volume.kind !== 'attack' || !melee) return false;
					volume.active = melee.active;
					entity.components.localTransform.x = melee.direction * ATTACK.offset;
					return true;
				},
			);

		systems.addSystem('enemy-reaction').withRef(enemyReaction)
			.inPhase('fixedUpdate').after(groundSpawn).before(physics2DSystems.integrate)
			.setProcessEach(
				{ with: ['enemy', 'hitReaction', 'localTransform', 'velocity'], mutates: ['hitReaction', 'velocity'] },
				function ({ entity, dt }) {
					const { hitReaction: reaction, velocity, localTransform: position } = entity.components;
					if (reaction.remaining <= 0) {
						if (!entity.components.groundChaser) velocity.x = 0;
						return;
					}
					const left = PLATFORM.x - PLATFORM.width / 2 + ENEMY.width / 2;
					const right = PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2;
					const travel = reaction.push * Math.min(dt, reaction.remaining);
					velocity.x = (Math.max(left, Math.min(right, position.x + travel)) - position.x) / dt;
					reaction.remaining = Math.max(0, reaction.remaining - dt);
					reaction.push *= Math.exp(-12 * dt);
				},
			);

		systems.addSystem('melee-hit').setEventHandlers({
			combatContact({ data, ecs }) {
				if (!ecs.getComponent(data.attackId, 'fixtureAttack') || !ecs.getComponent(data.targetId, 'enemy')) return;
				const melee = ecs.getComponent(data.ownerId, 'melee');
				if (!melee?.active || melee.hitTargets.has(data.targetId) || !ecs.getComponent(data.targetId, 'hitReaction')) return;
				ecs.mutateComponent(data.ownerId, 'melee', function (state) { state.hitTargets.add(data.targetId); });
				ecs.mutateComponent(data.targetId, 'hitReaction', function (reaction) {
					reaction.remaining = melee.strike === 3 ? MELEE.finisherStun : MELEE.stun;
					reaction.push = melee.direction * (melee.strike === 3 ? MELEE.finisherPushSpeed : MELEE.pushSpeed);
				});
			},
		});

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
				{ with: ['player', 'melee', 'localTransform', 'velocity', 'force'], mutates: ['player', 'melee', 'localTransform', 'velocity', 'force'] },
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
					Object.assign(entity.components.melee, createMeleeState());
					return true;
				},
			);
});

export const createGameBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return createBaseBuilder(input).withPlugin(gameplay);
};

export type GameWorld = ReturnType<ReturnType<typeof createGameBuilder>['build']>;

export const spawnLevel = function (world: Pick<GameWorld, 'spawn' | 'spawnChild'>, screen?: 'test' | 'gameplay') {
	const scope = { scope: screen ?? null };
	const platform = world.spawn({
		platform: true,
		...createTransform(PLATFORM.x, PLATFORM.y),
		...createRigidBody('static'),
		...createAABBCollider(PLATFORM.width, PLATFORM.height),
		...layers.platform(),
	}, scope);
	const player = world.spawn({
		player: { grounded: true, facing: 1 }, melee: createMeleeState(),
		...createTransform(START.x, START.y),
		...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
		velocity: { x: 0, y: 0 },
		...createAABBCollider(PLAYER.width, PLAYER.height),
		...layers.player(),
	}, scope);
	const attack = world.spawnChild(player.id, { fixtureAttack: true, ...createCombatVolume(player.id, 'attack', ATTACK.width, ATTACK.height, ATTACK.offset, 0, false) });
	const enemies = (screen === 'gameplay' ? [] : [540, 300, 710]).map(function (x) {
		const enemy = world.spawn({ enemy: true, hitReaction: { remaining: 0, push: 0 },
			...createTransform(x, PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2),
			...createRigidBody('dynamic', { restitution: 0, friction: 0 }), velocity: { x: 0, y: 0 },
			...createAABBCollider(ENEMY.width, ENEMY.height), ...layers.groundEnemy() }, scope);
		const hurtbox = world.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
		return { enemy, hurtbox };
	});
	return { player, platform, attack, enemies };
};
