import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';
import type { CombatContact } from './combat';

export const attachCombatReview = function (
	world: Pick<GameWorld, 'eventBus' | 'getComponent' | 'getEntity' | 'getEntitiesWithQuery'>, app: Application, root: Container, enemies: ReadonlyMap<number, Graphics>,
) {
	const toggle = document.getElementById('combat-outlines');
	const status = document.getElementById('combat-status');
	if (!(toggle instanceof HTMLInputElement) || !status) throw new Error('Combat review controls are missing.');
	const outlines = new Graphics();
	root.addChild(outlines);
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
		for (const [id, shape] of enemies) shape.tint = targets.has(id) ? 0xffe08a : 0xe76e80;
		outlines.clear();
		const volumes = world.getEntitiesWithQuery(['combatVolume', 'worldTransform', 'aabbCollider']);
		const active = volumes.some(function (entity) { return entity.components.combatVolume.kind === 'attack' && entity.components.combatVolume.active; });
		status.textContent = live.length > 0
			? live.map(function (contact) { return `Contact: attack ${contact.attackId} · owner ${contact.ownerId} → enemy ${contact.targetId} · hurtbox ${contact.hurtboxId}`; }).join(' | ')
			: active ? 'Attack active · no contact' : 'Attack inactive · hold J or gamepad button 2';
		if (!toggle.checked) return;
		for (const { components: { combatVolume: volume, worldTransform: position, aabbCollider: box } } of volumes) {
			if (!volume.active || !world.getEntity(volume.ownerId)) continue;
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
	};
};
