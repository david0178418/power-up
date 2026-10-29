import { Graphics, type Application, type Container } from 'pixi.js';
import type { GameWorld } from './game';

export const attachPlayerBeamView = function (
	world: Pick<GameWorld, 'getEntitiesWithQuery'>, app: Application, root: Container,
) {
	const drawing = new Graphics();
	root.addChild(drawing);
	const update = function () {
		drawing.clear();
		for (const { components: { beam, combatVolume } } of world.getEntitiesWithQuery(['playerBeam', 'beam', 'combatVolume'])) {
			if (!combatVolume.active) continue;
			drawing.moveTo(beam.from.x, beam.from.y).lineTo(beam.to.x, beam.to.y).stroke({ color: 0xc59bff, width: beam.width, alpha: 0.6, cap: 'butt' });
			drawing.moveTo(beam.from.x, beam.from.y).lineTo(beam.to.x, beam.to.y).stroke({ color: 0xffffff, width: 3, cap: 'butt' });
		}
	};
	app.ticker.add(update, undefined, -100);
	return function () {
		app.ticker.remove(update);
		drawing.removeFromParent();
		drawing.destroy();
	};
};
