import ECSpresso, { definePlugin, defineSystemRef, type ConfigOf } from 'ecspresso';
import { createInputPlugin, inputSystems, type InputPluginOptions } from 'ecspresso/plugins/input/input';
import { createPhysics2DPlugin, createRigidBody, physics2DSystems } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider, createCollisionPlugin } from 'ecspresso/plugins/physics/collision';
import { createTransform, createTransformPlugin, transformSystems } from 'ecspresso/plugins/spatial/transform';
import { createHealth, createHealthPlugin } from 'ecspresso/plugins/combat/health';

import { combat, createCombatVolume, layers } from './combat';
import { FLYING_ENEMY, steerFlyer } from './flying-enemy';
import { createProjectile, projectiles, projectileSystems } from './projectile';
import { beams } from './beam';
import { hitStop, SIMULATION_GROUP } from './hit-stop';
import { createTouchInput } from './touch-input';
import { createMeleeState, inMeleeCone, MELEE, type MeleeState, type HitReaction } from './melee';

// Simulation bounds are independent of the renderer's logical viewport.
export const LEVEL_BOUNDS = { left: 0, top: 0, right: 960, bottom: 540 } as const;
export const STEP = 1 / 60;
export const PLATFORM = { x: 480, y: 410, width: 640, height: 32 } as const;
export const PLAYER = { width: 32, height: 44, speed: 260, jumpSpeed: 520 } as const;
export const START = { x: 480, y: PLATFORM.y - PLATFORM.height / 2 - PLAYER.height / 2 } as const;

export const ENEMY = { width: 30, height: 40, health: 3 } as const;
export const GROUND_ENEMY = { speed: 90, spawnInterval: 2, limit: 8 } as const;
export const RANGED = { speed: 700, cooldown: 0.15, gravityTail: 0.5, lifetime: 2, range: 900, coneHalfAngle: Math.PI / 3, size: 12 } as const;
export const ATTACK = { width: 56, height: 36, offset: 40 } as const;

type Action = 'left' | 'right' | 'jump' | 'attack' | 'shoot';
const flyingSpawn = defineSystemRef('gameplay.flying-spawn');
const groundSpawn = defineSystemRef('gameplay.ground-spawn');
const fallReset = defineSystemRef('game.fall-reset');
const playerControl = defineSystemRef('game.player-control');
const meleeControl = defineSystemRef('game.melee-control');
const rangedControl = defineSystemRef('game.ranged-control');
const enemyReaction = defineSystemRef('game.enemy-reaction');
const pads = [0, 1, 2, 3];

const createBaseBuilder = function (input: Pick<InputPluginOptions<Action>, 'target' | 'gamepad'> = {}) {
	return ECSpresso.create()
		.withFixedTimestep(STEP)
		.withResource('touchInput', createTouchInput())
		.withPlugin(hitStop)
		.withScreens(function (screens) {
			return screens.add('test', { initialState: function () { return {}; } })
				.add('gameplay', { initialState: function () { return {}; } });
		})
		.withPlugin(createTransformPlugin({ systemGroup: SIMULATION_GROUP, phase: 'fixedUpdate', after: [fallReset] }))
		.withPlugin(createPhysics2DPlugin({
			gravity: { x: 0, y: 1400 }, layers, systemGroup: SIMULATION_GROUP,
			before: [physics2DSystems.collide],
		}))
		.withPlugin(createCollisionPlugin({ systemGroup: SIMULATION_GROUP, layers, phase: 'fixedUpdate', after: [transformSystems.propagate] }))
		.withPlugin(combat)
		.withPlugin(projectiles)
		.withPlugin(beams)
		.withPlugin(createHealthPlugin())
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
				shoot: { keys: ['k', 'K'], gamepadButtons: pads.map(pad => ({ pad, button: 1 })) },
				jump: { keys: [' '], gamepadButtons: pads.map(pad => ({ pad, button: 0 })) },
			},
		}));
};

type BaseWorld = ReturnType<ReturnType<typeof createBaseBuilder>['build']>;

const gameplay = definePlugin('gameplay')
	.requires<ConfigOf<BaseWorld>>()
	.withComponentTypes<{ player: { grounded: boolean; facing: -1 | 1 }; platform: true; enemy: true; groundChaser: true; flyingChaser: { slot: number }; fixtureAttack: true; playerShot: true; homingTarget: { id: number | undefined }; ranged: { remaining: number; held: boolean; queued: boolean; gravityTail: number }; melee: MeleeState; hitReaction: HitReaction }>()
	.withResourceTypes<{ groundSpawns: { remaining: number; spawned: number }; flyingSpawns: { remaining: number; spawned: number } }>()
	.install(function (systems, onCleanup) {
		let jumpHeld = false;
		let jumpQueued = false;
		const resetInputAndHitStop = function () {
			jumpHeld = false;
			jumpQueued = false;
			systems.getResource('hitStop').remaining = 0;
			systems.enableSystemGroup(SIMULATION_GROUP);
		};
		onCleanup(systems.onScreenEnter('test', resetInputAndHitStop));
		onCleanup(systems.onScreenEnter('gameplay', function ({ ecs }) {
			resetInputAndHitStop();
			const spawns = ecs.getResource('groundSpawns');
			spawns.remaining = 0;
			spawns.spawned = 0;
			Object.assign(ecs.getResource('flyingSpawns'), { remaining: FLYING_ENEMY.initialDelay, spawned: 0 });
		}));
		systems.addResource('groundSpawns', { remaining: 0, spawned: 0 });
		systems.addResource('flyingSpawns', { remaining: FLYING_ENEMY.initialDelay, spawned: 0 });
		systems.addSystem('flying-spawn').inGroup(SIMULATION_GROUP).withRef(flyingSpawn)
			.inScreens(['gameplay']).inPhase('fixedUpdate').before(physics2DSystems.integrate)
			.withResources(['flyingSpawns'])
			.addQuery('enemies', { with: ['flyingChaser'] }).runWhenEmpty()
			.setProcess(function ({ ecs, dt, resources: { flyingSpawns }, queries }) {
				flyingSpawns.remaining -= dt;
				if (flyingSpawns.remaining > 1e-9) return;
				flyingSpawns.remaining = FLYING_ENEMY.spawnInterval;
				const count = Math.min(FLYING_ENEMY.waveSize, FLYING_ENEMY.limit - queries.enemies.length);
				for (let index = 0; index < count; index++) {
					const occupied = new Set(ecs.getEntitiesWithQuery(['flyingChaser']).map(function (enemy) { return enemy.components.flyingChaser.slot; }));
					const slot = Array.from({ length: FLYING_ENEMY.limit }, function (_, value) { return value; }).find(function (value) { return !occupied.has(value); });
					if (slot === undefined) break;
					flyingSpawns.spawned++;
					const enemy = ecs.spawn({
						enemy: true, flyingChaser: { slot }, hitReaction: { remaining: 0, push: 0 },
						...createHealth(ENEMY.health),
						...createTransform(120 + (slot * 173) % 720, -ENEMY.height / 2 - index * 36),
						...createRigidBody('dynamic', { gravityScale: 0, restitution: 0, friction: 0 }),
						velocity: { x: 0, y: 0 },
					});
					ecs.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
				}
			});
		systems.addSystem('flying-chase').inGroup(SIMULATION_GROUP)
			.inScreens(['gameplay']).inPhase('fixedUpdate').after(flyingSpawn).before(enemyReaction).before(physics2DSystems.integrate)
			.addSingleton('target', { with: ['player', 'localTransform'] })
			.addQuery('enemies', { with: ['flyingChaser', 'localTransform', 'velocity', 'hitReaction'], mutates: ['velocity'] })
			.setProcess(function ({ queries, dt }) {
				if (!queries.target) return;
				const positions = queries.enemies.map(function (enemy) { return enemy.components.localTransform; });
				for (const { components: { flyingChaser, localTransform, velocity, hitReaction } } of queries.enemies) {
					if (hitReaction.remaining > 0) { velocity.y = 0; continue; }
					Object.assign(velocity, steerFlyer(localTransform, queries.target.components.localTransform, flyingChaser.slot, positions, dt));
				}
			});

		systems.addSystem('ground-spawn').inGroup(SIMULATION_GROUP).withRef(groundSpawn)
			.inScreens(['gameplay']).inPhase('fixedUpdate').before(physics2DSystems.integrate)
			.withResources(['groundSpawns'])
			.addQuery('enemies', { with: ['groundChaser', 'localTransform'] })
			.runWhenEmpty()
			.setProcess(function ({ ecs, dt, resources: { groundSpawns }, queries }) {
				groundSpawns.remaining -= dt;
				if (groundSpawns.remaining > 1e-9) return;
				groundSpawns.remaining = GROUND_ENEMY.spawnInterval;
				if (queries.enemies.length >= GROUND_ENEMY.limit) return;
				const x = PLATFORM.x + (groundSpawns.spawned % 2 === 0 ? -1 : 1) * (PLATFORM.width / 2 - ENEMY.width);
				// Wait for room rather than creating intersecting solid bodies at a crowded edge.
				if (queries.enemies.some(function ({ components: { localTransform } }) {
					return Math.abs(localTransform.x - x) < ENEMY.width;
				})) return;
				// Immediate visibility lets the child hurtbox and this tick's physics share the new owner.
				const enemy = ecs.spawn({
					enemy: true, groundChaser: true, hitReaction: { remaining: 0, push: 0 },
					...createHealth(ENEMY.health),
					...createTransform(x, PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2),
					...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
					velocity: { x: 0, y: 0 },
					...createAABBCollider(ENEMY.width, ENEMY.height), ...layers.groundEnemy(),
				});
				ecs.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
				groundSpawns.spawned++;
			});

		systems.addSystem('ground-chase').inGroup(SIMULATION_GROUP)
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

		// Continue sampling edges during hit stop; short taps survive until simulation resumes.
		systems.addSystem('combat-input')
			.inPhase('fixedUpdate').after(inputSystems.update).before(playerControl).before(meleeControl).before(rangedControl)
			.withResources(['inputState', 'touchInput'])
			.addQuery('players', { with: ['melee', 'ranged'], mutates: ['melee', 'ranged'] })
			.setProcess(function ({ queries, resources: { inputState, touchInput } }) {
				const jump = inputState.actions.isActive('jump') || touchInput.jump;
				if (jump && !jumpHeld) jumpQueued = true;
				jumpHeld = jump;
				const held = inputState.actions.isActive('attack') || touchInput.attack;
				const shoot = inputState.actions.isActive('shoot') || touchInput.shoot;
				for (const { components: { melee, ranged } } of queries.players) {
					if (shoot && !ranged.held) ranged.queued = true;
					ranged.held = shoot;
					if (held && !melee.held) melee.queued = true;
					melee.held = held;
				}
			});

		systems.addSystem('player-control').inGroup(SIMULATION_GROUP).withRef(playerControl)
			.inPhase('fixedUpdate').after(inputSystems.update).before(physics2DSystems.integrate)
			.withResources(['inputState', 'touchInput'])
			.setProcessEach(
				{ with: ['player', 'velocity', 'melee'], mutates: ['player', 'velocity', 'melee'] },
				({ entity, resources: { inputState: input, touchInput } }) => {
					const { player, velocity, melee } = entity.components;
					const digital = Number(input.actions.isActive('right')) - Number(input.actions.isActive('left'));
					const stick = input.gamepads.reduce(function (strongest, pad) {
						const x = pad.axis(0);
						return Math.abs(x) > Math.abs(strongest) ? x : strongest;
					}, 0);
					velocity.x = (digital || touchInput.move || stick) * PLAYER.speed;
					if (velocity.x !== 0) player.facing = velocity.x < 0 ? -1 : 1;
					if (jumpQueued && (player.grounded || melee.airJumpAvailable)) {
						velocity.y = -PLAYER.jumpSpeed;
						if (melee.airJumpAvailable) {
							// End the burst so its stop cannot erase the jump impulse.
							if (melee.active) melee.remaining = melee.strike === 3 ? MELEE.finisherRecovery : MELEE.recovery;
							melee.active = false;
							melee.lunge = 0;
							melee.gravityTail = 0;
						}
						melee.airJumpAvailable = false;
					}
					if (player.grounded) melee.airJumpAvailable = false;
					jumpQueued = false;
					// Physics will re-establish contact after integration and resolution.
					player.grounded = false;
				},
			);

		systems.addSystem('melee-control').inGroup(SIMULATION_GROUP).withRef(meleeControl)
			.inPhase('fixedUpdate').after(playerControl).before(physics2DSystems.integrate)
			.addQuery('targets', { with: ['enemy', 'localTransform'] })
			.addQuery('hurtboxes', { with: ['combatVolume'] })
			.addQuery('players', { with: ['player', 'melee', 'velocity', 'localTransform'], mutates: ['player', 'melee', 'velocity'] })
			.setProcess(function ({ queries, dt }) {
				for (const { components: { melee, player, velocity, localTransform: position } } of queries.players) {
					melee.gravityTail = Math.max(0, melee.gravityTail - dt);
					melee.remaining = Math.max(0, melee.remaining - dt);
					if (melee.active && melee.remaining <= 1e-9) {
						melee.active = false;
						if (melee.lunge > 0) {
							velocity.x = 0;
							velocity.y = 0;
							melee.gravityTail = MELEE.gravityTail;
						}
						melee.remaining = melee.strike === 3 ? MELEE.finisherRecovery : MELEE.recovery;
					}
					if (!melee.active && melee.remaining <= 1e-9) {
						melee.idle += dt;
						if (melee.idle >= MELEE.reset) melee.strike = 0;
						if (melee.held || melee.queued) {
							melee.strike = melee.strike % 3 + 1;
							melee.active = true;
							melee.remaining = MELEE.active;
							melee.idle = 0;
							melee.queued = false;
							melee.direction = player.facing;
							melee.hitTargets.clear();
							// Assist only toward the nearest live hurtbox in any direction within range.
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
							const dx = target ? target.components.localTransform.x - position.x : melee.direction;
							const dy = target ? target.components.localTransform.y - position.y : 0;
							const distance = Math.hypot(dx, dy);
							melee.aim = { x: dx / distance, y: dy / distance };
							if (dx !== 0) melee.direction = dx < 0 ? -1 : 1;
							// Stop when the two physical boxes meet along the chosen ray.
							const clearance = Math.min(
								(PLAYER.width + ENEMY.width) / 2 / Math.abs(melee.aim.x),
								(PLAYER.height + ENEMY.height) / 2 / Math.abs(melee.aim.y),
							);
							const gap = Math.max(0, distance - clearance);
							melee.lunge = target ? Math.min(MELEE.magnetismSpeed, gap / MELEE.active) : 0;
							// Add vertical assistance once so attacks preserve jump/fall momentum.
							velocity.y += melee.aim.y * melee.lunge;
						}
					}
					if (melee.active) {
						player.facing = melee.direction;
						if (melee.lunge > 0) velocity.x = melee.aim.x * melee.lunge;
					}
				}
			});

		systems.addSystem('ranged-control').inGroup(SIMULATION_GROUP).withRef(rangedControl)
			.inScreens(['gameplay', 'test']).inPhase('fixedUpdate').after(meleeControl).before(physics2DSystems.integrate).before(projectileSystems.move)
			.addQuery('players', { with: ['player', 'ranged', 'localTransform', 'velocity'], mutates: ['ranged', 'velocity'] })
			.addQuery('targets', { with: ['enemy', 'health', 'localTransform'], mutates: [] })
			.addQuery('hurtboxes', { with: ['combatVolume'], mutates: [] })
			.addQuery('shots', { with: ['homingTarget', 'projectile', 'localTransform'], mutates: ['homingTarget', 'projectile'] })
			.setProcess(function ({ queries, ecs, dt }) {
				const targets = queries.targets.filter(function (target) {
					return target.components.health.current > 0 && queries.hurtboxes.some(function ({ components: { combatVolume } }) {
						return combatVolume.ownerId === target.id && combatVolume.kind === 'hurtbox' && combatVolume.active;
					});
				});
				for (const { components: { homingTarget, projectile, localTransform: position } } of queries.shots) {
					if (homingTarget.id === undefined) continue;
					const target = targets.find(function (candidate) { return candidate.id === homingTarget.id; });
					if (!target) { homingTarget.id = undefined; continue; }
					const dx = target.components.localTransform.x - position.x;
					const dy = target.components.localTransform.y - position.y;
					const distance = Math.hypot(dx, dy);
					const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
					if (distance === 0 || speed === 0) continue;
					const alignment = (dx * projectile.velocity.x + dy * projectile.velocity.y) / (distance * speed);
					if (alignment < Math.cos(RANGED.coneHalfAngle) - 1e-9) { homingTarget.id = undefined; continue; }
					projectile.velocity = { x: dx / distance * speed, y: dy / distance * speed };
				}
				for (const { id, components: { ranged, localTransform: position, velocity: playerVelocity } } of queries.players) {
					ranged.gravityTail = Math.max(0, ranged.gravityTail - dt);
					ranged.remaining = Math.max(0, ranged.remaining - dt);
					if (ranged.remaining > 1e-9 || (!ranged.held && !ranged.queued)) continue;
					ranged.queued = false;
					const distance = function (p: { x: number; y: number }) { return Math.hypot(p.x - position.x, p.y - position.y); };
					const target = targets.slice().sort(function (a, b) {
						return distance(a.components.localTransform) - distance(b.components.localTransform) || a.id - b.id;
					})[0];
					if (!target) continue;
					const dx = target.components.localTransform.x - position.x;
					const dy = target.components.localTransform.y - position.y;
					const length = Math.hypot(dx, dy);
					const velocity = length > 0 ? { x: dx / length * RANGED.speed, y: dy / length * RANGED.speed } : { x: RANGED.speed, y: 0 };
					ecs.commands.spawn({ playerShot: true, homingTarget: { id: target.id },
						...createProjectile(id, position, velocity, RANGED.size, RANGED.size, RANGED.lifetime, RANGED.range) });
					ranged.remaining = RANGED.cooldown;
					ranged.gravityTail = RANGED.gravityTail;
					playerVelocity.x = 0;
					playerVelocity.y = 0;
				}
			});

		// Share gravity cancellation so overlapping melee/ranged pauses never double it.
		systems.addSystem('player-gravity-control').inGroup(SIMULATION_GROUP)
			.inPhase('fixedUpdate').after(meleeControl, rangedControl).before(physics2DSystems.integrate)
			.withResources(['physicsConfig'])
			.setProcessEach(
				{ with: ['player', 'melee', 'ranged', 'force', 'rigidBody'], mutates: ['force'] },
				function ({ entity, resources: { physicsConfig } }) {
					const { melee, ranged, force, rigidBody } = entity.components;
					if (!((melee.active && melee.lunge > 0) || melee.gravityTail > 1e-9 || ranged.gravityTail > 1e-9)) return false;
					force.x -= physicsConfig.gravity.x * rigidBody.mass * rigidBody.gravityScale;
					force.y -= physicsConfig.gravity.y * rigidBody.mass * rigidBody.gravityScale;
					return true;
				},
			);

		systems.addSystem('fixture-attack').inGroup(SIMULATION_GROUP)
			.inPhase('fixedUpdate').after(meleeControl).after(fallReset).before(transformSystems.propagate)
			.setProcessEach(
				{ with: ['fixtureAttack', 'combatVolume', 'localTransform', 'aabbCollider', 'combatRectangle'], mutates: ['combatVolume', 'localTransform', 'aabbCollider', 'combatRectangle'] },
				function ({ entity, ecs }) {
					const volume = entity.components.combatVolume;
					const melee = ecs.getComponent(volume.ownerId, 'melee');
					if (volume.kind !== 'attack' || !melee) return false;
					volume.active = melee.active;
					const { aim } = melee;
					entity.components.localTransform.x = aim.x * ATTACK.offset;
					entity.components.localTransform.y = aim.y * ATTACK.offset;
					entity.components.combatRectangle.aim = { ...aim };
					// Broad phase encloses the rotated rectangle; combat filters its corners.
					entity.components.aabbCollider.width = Math.abs(aim.x) * ATTACK.width + Math.abs(aim.y) * ATTACK.height;
					entity.components.aabbCollider.height = Math.abs(aim.y) * ATTACK.width + Math.abs(aim.x) * ATTACK.height;
					return true;
				},
			);

		systems.addSystem('enemy-reaction').inGroup(SIMULATION_GROUP).withRef(enemyReaction)
			.inPhase('fixedUpdate').after(groundSpawn).after(flyingSpawn).before(physics2DSystems.integrate)
			.setProcessEach(
				{ with: ['enemy', 'hitReaction', 'localTransform', 'velocity'], mutates: ['hitReaction', 'velocity'] },
				function ({ entity, dt }) {
					const { hitReaction: reaction, velocity, localTransform: position } = entity.components;
					if (reaction.remaining <= 0) {
						if (!entity.components.groundChaser && !entity.components.flyingChaser) velocity.x = 0;
						return;
					}
					const left = entity.components.flyingChaser ? LEVEL_BOUNDS.left + ENEMY.width / 2 : PLATFORM.x - PLATFORM.width / 2 + ENEMY.width / 2;
					const right = entity.components.flyingChaser ? LEVEL_BOUNDS.right - ENEMY.width / 2 : PLATFORM.x + PLATFORM.width / 2 - ENEMY.width / 2;
					const travel = reaction.push * Math.min(dt, reaction.remaining);
					velocity.x = (Math.max(left, Math.min(right, position.x + travel)) - position.x) / dt;
					reaction.remaining = Math.max(0, reaction.remaining - dt);
					reaction.push *= Math.exp(-12 * dt);
				},
			);

		// Reserve each body's travel against the other solid enemy boxes. The physics
		// solver resolves individual pairs, but cannot fully separate a compressed crowd
		// in one pass. Preventing penetration also keeps edge guards intact under pressure.
		systems.addSystem('enemy-spacing').inGroup(SIMULATION_GROUP)
			.inPhase('fixedUpdate').after(enemyReaction).before(physics2DSystems.integrate)
			.addQuery('enemies', { with: ['enemy', 'localTransform', 'velocity', 'aabbCollider'], mutates: ['velocity'] })
			.setProcess(function ({ queries, dt }) {
				const bodies = queries.enemies.map(function ({ components }) {
					return { ...components, x: components.localTransform.x + (components.aabbCollider.offsetX ?? 0) };
				});
				for (const body of bodies) {
					const { velocity, localTransform: position, aabbCollider: box } = body;
					let travel = velocity.x * dt;
					for (const other of bodies) {
						if (other === body) continue;
						const verticalGap = Math.abs(position.y + (box.offsetY ?? 0)
							- other.localTransform.y - (other.aabbCollider.offsetY ?? 0));
						if (verticalGap >= (box.height + other.aabbCollider.height) / 2) continue;
						const distance = other.x - body.x;
						const gap = Math.max(0, Math.abs(distance) - (box.width + other.aabbCollider.width) / 2);
						if (distance > 0) travel = Math.min(travel, gap);
						if (distance < 0) travel = Math.max(travel, -gap);
					}
					velocity.x = travel / dt;
					// Later bodies see this body's reserved endpoint; earlier bodies saw its start.
					body.x += travel;
				}
			});

		systems.addSystem('melee-hit').setEventHandlers({
			combatContact({ data, ecs }) {
				if (!ecs.getComponent(data.attackId, 'fixtureAttack') || !ecs.getComponent(data.targetId, 'enemy')) return;
				const melee = ecs.getComponent(data.ownerId, 'melee');
				const health = ecs.getComponent(data.targetId, 'health');
				if (!health || health.current <= 0) return;
				if (!melee?.active || melee.hitTargets.has(data.targetId) || !ecs.getComponent(data.targetId, 'hitReaction')) return;
				if (melee.lunge === 0 && melee.hitTargets.size === 0) {
					ecs.mutateComponent(data.ownerId, 'velocity', function (velocity) {
						velocity.x = 0;
						velocity.y = 0;
					});
					ecs.mutateComponent(data.ownerId, 'melee', function (state) { state.gravityTail = MELEE.gravityTail; });
				}
				ecs.mutateComponent(data.ownerId, 'melee', function (state) {
					if (state.strike === 3 && state.hitTargets.size === 0) state.airJumpAvailable = true;
					state.hitTargets.add(data.targetId);
				});
				ecs.mutateComponent(data.targetId, 'hitReaction', function (reaction) {
					reaction.remaining = melee.strike === 3 ? MELEE.finisherStun : MELEE.stun;
					reaction.push = melee.direction * (melee.strike === 3 ? MELEE.finisherPushSpeed : MELEE.pushSpeed);
				});
				const stop = ecs.getResource('hitStop');
				stop.remaining = Math.max(stop.remaining, melee.strike === 3 ? MELEE.finisherHitStop : MELEE.hitStop);
				ecs.eventBus.publish('damage', { entityId: data.targetId, amount: 1, sourceId: data.ownerId });
			},
		});

		// Resolve the ordered sweep once; ordinary combatContact reports all swept targets.
		systems.addSystem('player-projectile-hit').setEventHandlers({
			projectileSweep({ data, ecs }) {
				if (!ecs.getComponent(data.attackId, 'playerShot')) return;
				const contact = data.contacts.find(function (candidate) {
					return candidate.kind === 'solid' || (ecs.getComponent(candidate.targetId, 'enemy')
						&& (ecs.getComponent(candidate.targetId, 'health')?.current ?? 0) > 0);
				});
				if (!contact) return;
				if (contact.kind === 'target') ecs.eventBus.publish('damage', { entityId: contact.targetId, amount: 1, sourceId: data.ownerId });
				ecs.commands.removeEntity(data.attackId);
			},
		});

		systems.addSystem('enemy-death').setEventHandlers({
			entityDied({ data, ecs }) {
				if (!ecs.getComponent(data.entityId, 'enemy')) return;
				// Disable immediately: other contacts in this phase must not hit a dead owner.
				for (const volume of ecs.getEntitiesWithQuery(['combatVolume'])) {
					if (volume.components.combatVolume.ownerId !== data.entityId) continue;
					ecs.mutateComponent(volume.id, 'combatVolume', function (state) { state.active = false; });
				}
				// Removing the owner also removes child hurtboxes at the phase boundary.
				ecs.commands.removeEntity(data.entityId);
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

		systems.addSystem('fall-reset').inGroup(SIMULATION_GROUP).withRef(fallReset)
			.inPhase('fixedUpdate').after(physics2DSystems.collide)
			.setProcessEach(
				{ with: ['player', 'melee', 'ranged', 'localTransform', 'velocity', 'force'], mutates: ['player', 'melee', 'ranged', 'localTransform', 'velocity', 'force'] },
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
					entity.components.ranged.gravityTail = 0;
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
		player: { grounded: true, facing: 1 }, ranged: { remaining: 0, held: false, queued: false, gravityTail: 0 }, melee: createMeleeState(),
		...createTransform(START.x, START.y),
		...createRigidBody('dynamic', { restitution: 0, friction: 0 }),
		velocity: { x: 0, y: 0 },
		...createAABBCollider(PLAYER.width, PLAYER.height),
		...layers.player(),
	}, scope);
	const attack = world.spawnChild(player.id, { fixtureAttack: true, combatRectangle: { width: ATTACK.width, height: ATTACK.height, aim: { x: 1, y: 0 } }, ...createCombatVolume(player.id, 'attack', ATTACK.width, ATTACK.height, ATTACK.offset, 0, false) });
	const enemies = (screen === 'gameplay' ? [] : [540, 300, 710]).map(function (x) {
		const enemy = world.spawn({ enemy: true, hitReaction: { remaining: 0, push: 0 },
			...createHealth(ENEMY.health),
			...createTransform(x, PLATFORM.y - PLATFORM.height / 2 - ENEMY.height / 2),
			...createRigidBody('dynamic', { restitution: 0, friction: 0 }), velocity: { x: 0, y: 0 },
			...createAABBCollider(ENEMY.width, ENEMY.height), ...layers.groundEnemy() }, scope);
		const hurtbox = world.spawnChild(enemy.id, createCombatVolume(enemy.id, 'hurtbox', ENEMY.width, ENEMY.height));
		return { enemy, hurtbox };
	});
	return { player, platform, attack, enemies };
};
