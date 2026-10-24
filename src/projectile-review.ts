import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';
import { STEP } from './game';
import { launchFixtureProjectile, PROJECTILE_FIXTURE, spawnProjectileFixture } from './projectile-fixture';

type ReviewWorld = Pick<GameWorld, 'spawn' | 'spawnChild' | 'removeEntity' | 'getEntity' | 'getEntitiesWithQuery' | 'eventBus'>;

export const attachProjectileReview = function (world: ReviewWorld, app: Application, root: Container) {
	const fire = document.getElementById('projectile-launch');
	const clear = document.getElementById('projectile-clear');
	const speed = document.getElementById('projectile-speed');
	const lifetime = document.getElementById('projectile-lifetime');
	const miss = document.getElementById('projectile-miss');
	const status = document.getElementById('projectile-status');
	const history = document.getElementById('projectile-history');
	if (!(fire instanceof HTMLButtonElement) || !(clear instanceof HTMLButtonElement)
		|| !(speed instanceof HTMLInputElement) || !(lifetime instanceof HTMLInputElement)
		|| !(miss instanceof HTMLInputElement) || !status || !history) throw new Error('Projectile review controls are missing.');
	const fixture = spawnProjectileFixture(world);
	const f = PROJECTILE_FIXTURE;
	const drawing = new Graphics();
	root.addChild(drawing);
	let shotId: number | undefined;
	let contactCount = 0;
	const clearShot = function () {
		if (shotId !== undefined) world.removeEntity(shotId);
		shotId = undefined;
	};
	const launch = function () {
		if (!speed.reportValidity() || !lifetime.reportValidity()) return;
		clearShot();
		contactCount = 0;
		history.textContent = 'Last run: no contacts yet.';
		shotId = launchFixtureProjectile(world, fixture.owner.id, speed.valueAsNumber, lifetime.valueAsNumber, miss.checked).id;
	};
	const stopSweep = world.eventBus.subscribe('projectileSweep', function (sweep) {
		if (sweep.attackId !== shotId || sweep.contacts.length === 0) return;
		contactCount += sweep.contacts.length;
		history.textContent = `Last run: ${contactCount} contacts · ${sweep.contacts.map(function (c) {
			return c.kind === 'target'
				? `target ${c.targetId} / hurtbox ${c.hurtboxId} at x ${c.position.x.toFixed(1)}`
				: `solid ${c.obstacleId} at x ${c.position.x.toFixed(1)}`;
		}).join(' → ')}`;
	});
	const update = function () {
		drawing.clear();
		// Static fixture guides are separate from live projectile/debug state.
		drawing.moveTo(f.x, f.y).lineTo(840, f.y).stroke({ color: 0x59738a, width: 1 });
		drawing.circle(f.x, f.y, 5).stroke({ color: 0x65deeb, width: 2 });
		for (const x of f.targetXs) drawing.rect(x - f.targetWidth / 2, f.y - f.targetHeight / 2, f.targetWidth, f.targetHeight).fill(0xe76e80);
		drawing.rect(f.wallX - f.wallWidth / 2, f.y - f.wallHeight / 2, f.wallWidth, f.wallHeight).fill(0xe6b566);
		const shots = world.getEntitiesWithQuery(['projectile', 'combatVolume', 'worldTransform', 'aabbCollider'])
			.filter(function (shot) { return shot.components.combatVolume.ownerId === fixture.owner.id; });
		for (const { components: { projectile, worldTransform: p, aabbCollider: box } } of shots) {
			drawing.moveTo(projectile.previous.x, projectile.previous.y).lineTo(p.x, p.y).stroke({ color: 0x65deeb, width: box.height, alpha: 0.3 });
			drawing.rect(p.x - box.width / 2, p.y - box.height / 2, box.width, box.height).fill(0x65deeb);
		}
		status.textContent = `Active projectiles: ${shots.length} · ${Number.isFinite(speed.valueAsNumber) ? (speed.valueAsNumber * STEP).toFixed(1) : '—'} units/tick · targets are ${f.targetWidth} units wide`;
		if (shotId !== undefined && !world.getEntity(shotId)) shotId = undefined;
	};
	fire.addEventListener('click', launch);
	clear.addEventListener('click', clearShot);
	app.ticker.add(update, undefined, -100);
	update();
	return function () {
		fire.removeEventListener('click', launch);
		clear.removeEventListener('click', clearShot);
		stopSweep();
		app.ticker.remove(update);
		clearShot();
		world.removeEntity(fixture.owner.id);
		for (const { target } of fixture.targets) world.removeEntity(target.id);
		world.removeEntity(fixture.wall.id);
		drawing.removeFromParent();
		drawing.destroy();
	};
};
