import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';
import { combatRectanglePoints, type CombatContact } from './combat';
import { ENEMY } from './game';
import { drawHealthBar } from './health-view';

export const attachCombatReview = function (
	world: Pick<GameWorld, 'eventBus' | 'getComponent' | 'getEntity' | 'getEntitiesWithQuery'>, app: Application, root: Container, enemies: ReadonlyMap<number, Graphics>,
) {
	const toggle = document.getElementById('combat-outlines');
	const status = document.getElementById('combat-status');
	if (!(toggle instanceof HTMLInputElement) || !status) throw new Error('Combat review controls are missing.');
	const outlines = new Graphics();
	root.addChild(outlines);
	const healthBars = new Graphics();
	root.addChild(healthBars);
	let contacts: CombatContact[] = [];
	const stopScan = world.eventBus.subscribe('combatScan', function () { contacts = []; });
	const stopContact = world.eventBus.subscribe('combatContact', function (contact) { contacts.push(contact); });
	const update = function () {
		// Validate identities on presentation too: removal/disable between ticks cannot leave feedback behind.
		const live = contacts.filter(function (contact) {
			return world.getComponent(contact.attackId, 'combatVolume')?.active
				&& world.getComponent(contact.hurtboxId, 'combatVolume')?.active
				&& world.getEntity(contact.ownerId) && world.getEntity(contact.targetId);
		});
		const targets = new Set(live.map(function (contact) { return contact.targetId; }));
		healthBars.clear();
		for (const [id, shape] of enemies) {
			if (shape.destroyed) continue;
			shape.visible = world.getEntity(id) !== undefined;
			shape.tint = (world.getComponent(id, 'hitReaction')?.remaining ?? 0) > 0 || targets.has(id) ? 0xffe08a : 0xe76e80;
			const health = world.getComponent(id, 'health');
			const position = world.getComponent(id, 'worldTransform');
			if (shape.visible && health && position) drawHealthBar(healthBars, health, position.x, position.y - ENEMY.height / 2 - 9, ENEMY.width);
		}
		outlines.clear();
		const volumes = world.getEntitiesWithQuery(['combatVolume', 'worldTransform', 'aabbCollider']);
		const active = volumes.some(function (entity) { return entity.components.combatVolume.kind === 'attack' && entity.components.combatVolume.active; });
		status.textContent = live.length > 0
			? live.map(function (contact) { return `Contact: attack ${contact.attackId} · owner ${contact.ownerId} → enemy ${contact.targetId} · hurtbox ${contact.hurtboxId}`; }).join(' | ')
			: active ? 'Attack active · no contact' : 'Between strikes · tap or hold J / gamepad button 2';
		if (!toggle.checked) return;
		for (const { components: { combatVolume: volume, worldTransform: position, aabbCollider: box, combatRectangle: rectangle } } of volumes) {
			if (!volume.active || !world.getEntity(volume.ownerId)) continue;
			if (rectangle) {
				outlines.poly(combatRectanglePoints(position, rectangle)).stroke({ color: 0xffe08a, width: 2 });
				continue;
			}
			// Match ECSpresso's world-axis AABB exactly, including its unscaled dimensions.
			outlines.rect(position.x + (box.offsetX ?? 0) - box.width / 2, position.y + (box.offsetY ?? 0) - box.height / 2, box.width, box.height)
				.stroke({ color: volume.kind === 'attack' ? 0xffe08a : 0xff8f9c, width: 2 });
		}
	};
	app.ticker.add(update, undefined, -100);
	update();
	return function () {
		stopScan();
		stopContact();
		app.ticker.remove(update);
		outlines.removeFromParent();
		outlines.destroy();
		healthBars.removeFromParent();
		healthBars.destroy();
	};
};
