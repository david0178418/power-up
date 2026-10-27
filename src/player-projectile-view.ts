import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';

export const attachPlayerProjectileView = function (
	world: Pick<GameWorld, 'getEntitiesWithQuery'>, app: Application, root: Container,
) {
	const drawing = new Graphics();
	root.addChild(drawing);
	const update = function () {
		drawing.clear();
		for (const { components: { worldTransform: p, projectile } } of world.getEntitiesWithQuery(['playerShot', 'worldTransform', 'projectile'])) {
			drawing.moveTo(projectile.previous.x, projectile.previous.y).lineTo(p.x, p.y).stroke({ color: 0x65deeb, width: 6, alpha: 0.4 });
			drawing.circle(p.x, p.y, 6).fill(0x65deeb).circle(p.x, p.y, 2).fill(0xffffff);
		}
	};
	app.ticker.add(update, undefined, -100);
	return function () {
		app.ticker.remove(update);
		drawing.removeFromParent();
		drawing.destroy();
	};
};
