import { Graphics } from 'pixi.js';
import { createRenderer2DPlugin } from 'ecspresso/plugins/rendering/renderer2D';
import { createGameBuilder, spawnLevel, PLATFORM, PLAYER, ENEMY } from './game';
import { createViewCamera, VIEWPORT } from './view';
import { attachCombatReview } from './combat-review';
import { attachCameraReview } from './camera-review';

const start = async function (container: HTMLElement) {
	const world = createGameBuilder()
		.withPlugin(createViewCamera())
		.withPlugin(createRenderer2DPlugin({
			container,
			background: '#101c2c',
			camera: true,
			screenScale: { ...VIEWPORT, mode: 'fit' },
			pixiInit: { antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2), preference: 'webgl' },
		}))
		.build();
	const graphics: Graphics[] = [];
	let stopReview = function () {};
	let stopCombat = function () {};
	const dispose = async function () {
		stopCombat();
		stopReview();
		try { await world.dispose(); }
		finally { graphics.forEach(function (shape) { shape.destroy(); }); }
	};
	try {
		await world.initialize();
		const level = spawnLevel(world);
		const platform = new Graphics().rect(-PLATFORM.width / 2, -PLATFORM.height / 2, PLATFORM.width, PLATFORM.height).fill(0xe6b566);
		const player = new Graphics().rect(-PLAYER.width / 2, -PLAYER.height / 2, PLAYER.width, PLAYER.height).fill(0x65deeb);
		graphics.push(platform, player);
		world.addComponent(level.platform.id, 'graphics', platform);
		world.addComponent(level.player.id, 'graphics', player);
		const enemyShapes = new Map<number, Graphics>();
		for (const { enemy } of level.enemies) {
			const shape = new Graphics().rect(-ENEMY.width / 2, -ENEMY.height / 2, ENEMY.width, ENEMY.height).fill(0xffffff)
				.rect(-8, -10, 4, 4).rect(4, -10, 4, 4).fill(0x101c2c);
			graphics.push(shape);
			enemyShapes.set(enemy.id, shape);
			world.addComponent(enemy.id, 'graphics', shape);
		}
		world.update(0);
		stopReview = attachCameraReview(world, level.player.components.localTransform);
		stopCombat = attachCombatReview(world, world.getResource('pixiApp'), world.getResource('rootContainer'), enemyShapes);
		// The input plugin owns listeners but does not clear held keys on blur.
		// Release its tracked keyboard inputs when focus leaves the game.
		const releaseKeys = function () {
			for (const key of ['a', 'A', 'd', 'D', 'ArrowLeft', 'ArrowRight', ' ', 'j', 'J']) {
				window.dispatchEvent(new KeyboardEvent('keyup', { key }));
			}
		};
		window.addEventListener('blur', releaseKeys);
		return async function () {
			window.removeEventListener('blur', releaseKeys);
			await dispose();
		};
	} catch (error) {
		await dispose();
		throw error;
	}
};

const container = document.getElementById('game');
if (!(container instanceof HTMLElement)) throw new Error('Game container is missing.');

try {
	const stop = await start(container);
	const onPageHide = function (event: PageTransitionEvent) {
		// Cached pages resume their existing world when restored with Back.
		if (!event.persisted) void shutdown();
	};
	const shutdown = async function () {
		window.removeEventListener('pagehide', onPageHide);
		await stop();
	};
	window.addEventListener('pagehide', onPageHide);
	if (import.meta.hot) import.meta.hot.dispose(shutdown);
} catch (error) {
	console.error(error);
	const message = document.getElementById('error');
	if (message) {
		message.hidden = false;
		message.textContent = 'Could not start the game. Reload to try again.';
	}
}
