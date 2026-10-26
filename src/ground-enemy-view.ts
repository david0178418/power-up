import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';
import { ENEMY, GROUND_ENEMY } from './game';
import { FLYING_ENEMY } from './flying-enemy';
import { VIEWPORT } from './view';
import { combatRectanglePoints } from './combat';
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
		const flyers = world.getEntitiesWithQuery(['flyingChaser', 'hitReaction', 'health', 'worldTransform']);
		for (const { id, components: { worldTransform: p, hitReaction, health, flyingChaser } } of flyers) {
			const flap = Math.sin(app.ticker.lastTime / 85 + flyingChaser.slot) * 10;
			const color = hitReaction.remaining > 0 || contacts.has(id) ? 0xffe08a : 0xbba0ff;
			drawing.poly([p.x - 10, p.y, p.x - 30, p.y - 12 + flap, p.x - 23, p.y + 10, p.x - 8, p.y + 8]).fill(color);
			drawing.poly([p.x + 10, p.y, p.x + 30, p.y - 12 + flap, p.x + 23, p.y + 10, p.x + 8, p.y + 8]).fill(color);
			drawing.ellipse(p.x, p.y, ENEMY.width / 2, ENEMY.height / 2).fill(color);
			drawing.rect(p.x - 8, p.y - 5, 5, 5).rect(p.x + 3, p.y - 5, 5, 5).fill(0x101c2c);
			drawHealthBar(drawing, health, p.x, p.y - ENEMY.height / 2 - 9, ENEMY.width);
		}
		for (const { components: { fixtureAttack, combatVolume, worldTransform: p, combatRectangle: rectangle } } of world.getEntitiesWithQuery(['fixtureAttack', 'combatVolume', 'worldTransform', 'combatRectangle'])) {
			if (fixtureAttack && combatVolume.active) drawing.poly(combatRectanglePoints(p, rectangle))
				.fill({ color: 0xffe08a, alpha: 0.25 }).stroke({ color: 0xffe08a, width: 2 });
		}
		const melee = player?.components.melee;
		status.textContent = `Combo ${melee?.strike ?? 0}/3 · ${melee?.active ? 'strike' : (melee?.remaining ?? 0) > 0 ? 'recovering' : 'ready'} · Ground enemies: ${enemies.length} / ${GROUND_ENEMY.limit} · Flying enemies: ${flyers.length} / ${FLYING_ENEMY.limit}`;
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
