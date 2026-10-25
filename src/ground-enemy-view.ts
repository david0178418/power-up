import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';
import { ENEMY, GROUND_ENEMY, PLAYER } from './game';
import { VIEWPORT } from './view';
import { drawHealthBar } from './health-view';

// Presentation follows live ECS entities; no second spawn timer or movement loop.
export const attachGroundEnemyView = function (
	world: Pick<GameWorld, 'getEntitiesWithQuery' | 'eventBus'>, app: Application, root: Container,
) {
	const status = document.getElementById('gameplay-status');
	if (!status || !root.parent) throw new Error('Gameplay view setup is missing.');
	const viewport = root.parent;
	const mask = new Graphics().rect(0, 0, VIEWPORT.width, VIEWPORT.height).fill(0xffffff);
	viewport.addChild(mask);
	root.mask = mask;
	const drawing = new Graphics();
	root.addChild(drawing);
	const contacts = new Set<number>();
	const stopScan = world.eventBus.subscribe('combatScan', function () { contacts.clear(); });
	const stopContact = world.eventBus.subscribe('combatContact', function (contact) { contacts.add(contact.targetId); });
	const update = function () {
		drawing.clear();
		const enemies = world.getEntitiesWithQuery(['groundChaser', 'hitReaction', 'health', 'worldTransform']);
		const player = world.getEntitiesWithQuery(['player', 'worldTransform'])[0];
		for (const { id, components: { worldTransform: position, hitReaction, health } } of enemies) {
			drawing.rect(position.x - ENEMY.width / 2, position.y - ENEMY.height / 2, ENEMY.width, ENEMY.height)
				.fill(hitReaction.remaining > 0 || contacts.has(id) ? 0xffe08a : 0xe76e80);
			const facing = player && player.components.worldTransform.x < position.x ? -1 : 1;
			drawing.rect(position.x + facing * 6 - 2, position.y - 10, 4, 4).fill(0x101c2c);
			drawHealthBar(drawing, health, position.x, position.y - ENEMY.height / 2 - 9, ENEMY.width);
		}
		for (const { components: { fixtureAttack, combatVolume, worldTransform: p, aabbCollider: box } } of world.getEntitiesWithQuery(['fixtureAttack', 'combatVolume', 'worldTransform', 'aabbCollider'])) {
			if (fixtureAttack && combatVolume.active) drawing.rect(p.x - box.width / 2, p.y - box.height / 2, box.width, box.height)
				.fill({ color: 0xffe08a, alpha: 0.25 }).stroke({ color: 0xffe08a, width: 2 });
		}
		const melee = player?.components.melee;
		status.textContent = `Combo ${melee?.strike ?? 0}/3 · ${melee?.active ? 'strike' : (melee?.remaining ?? 0) > 0 ? 'recovering' : 'ready'} · Ground enemies: ${enemies.length} / ${GROUND_ENEMY.limit} · one every ${GROUND_ENEMY.spawnInterval}s · chase speed ${GROUND_ENEMY.speed} (player ${PLAYER.speed})`;
	};
	app.ticker.add(update, undefined, -100);
	update();
	return function () {
		app.ticker.remove(update);
		stopScan();
		stopContact();
		root.mask = null;
		for (const shape of [drawing, mask]) { shape.removeFromParent(); shape.destroy(); }
	};
};
