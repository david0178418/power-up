import { Graphics } from 'pixi.js';
import { createRenderer2DPlugin } from 'ecspresso/plugins/rendering/renderer2D';
import { createGameBuilder, spawnLevel, PLATFORM, PLAYER, ENEMY } from './game';
import { createViewCamera, VIEWPORT } from './view';
import { attachBeamReview } from './beam-review';
import { attachProjectileReview } from './projectile-review';
import { attachCombatReview } from './combat-review';
import { attachCameraReview } from './camera-review';
import { attachGroundEnemyView } from './ground-enemy-view';
import { attachFullscreen } from './fullscreen';
import { attachTouchControls } from './touch-controls';

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
	const cleanups: (() => void)[] = [];
	let transition: Promise<void> | undefined;
	let shuttingDown = false;
	let touchControls: ReturnType<typeof attachTouchControls> | undefined;
	let detachFullscreen: (() => void) | undefined;
	const gameplayButton = document.getElementById('show-gameplay');
	const testButton = document.getElementById('show-test');
	const restartButton = document.getElementById('restart-gameplay');
	const gameplayControls = document.getElementById('gameplay-controls');
	const testControls = document.getElementById('test-controls');
	const description = document.getElementById('screen-description');
	const hint = document.getElementById('play-hint');
	if (!(gameplayButton instanceof HTMLButtonElement) || !(testButton instanceof HTMLButtonElement)
		|| !(restartButton instanceof HTMLButtonElement) || !gameplayControls || !testControls || !description || !hint) {
		throw new Error('Screen controls are missing.');
	}
	const clearScene = function () {
		for (const cleanup of cleanups.splice(0).reverse()) cleanup();
		for (const shape of graphics.splice(0)) { shape.removeFromParent(); shape.destroy(); }
	};
	const showScreen = async function (screen: 'test' | 'gameplay') {
		touchControls?.reset();
		clearScene();
		// Screen-scoped entities are removed by ECSpresso, including their child volumes.
		await world.setScreen(screen, {});
		const level = spawnLevel(world, screen);
		const camera = world.getResource('cameraState');
		camera.setPosition(VIEWPORT.width / 2, VIEWPORT.height / 2);
		const platform = new Graphics().rect(-PLATFORM.width / 2, -PLATFORM.height / 2, PLATFORM.width, PLATFORM.height).fill(0xe6b566);
		const player = new Graphics().rect(-PLAYER.width / 2, -PLAYER.height / 2, PLAYER.width, PLAYER.height).fill(0x65deeb);
		graphics.push(platform, player);
		world.addComponent(level.platform.id, 'graphics', platform);
		world.addComponent(level.player.id, 'graphics', player);
		const app = world.getResource('pixiApp');
		const root = world.getResource('rootContainer');
		if (screen === 'test') {
			const enemyShapes = new Map<number, Graphics>();
			for (const { enemy } of level.enemies) {
				const shape = new Graphics().rect(-ENEMY.width / 2, -ENEMY.height / 2, ENEMY.width, ENEMY.height).fill(0xffffff)
					.rect(-8, -10, 4, 4).rect(4, -10, 4, 4).fill(0x101c2c);
				graphics.push(shape);
				enemyShapes.set(enemy.id, shape);
				world.addComponent(enemy.id, 'graphics', shape);
			}
			cleanups.push(attachCameraReview(world, level.player.components.localTransform));
			cleanups.push(attachCombatReview(world, app, root, enemyShapes));
			cleanups.push(attachProjectileReview(world, app, root));
			cleanups.push(attachBeamReview(world, app, root));
		} else {
			cleanups.push(attachGroundEnemyView(world, app, root));
		}
		world.update(0);
		gameplayControls.hidden = screen !== 'gameplay';
		testControls.hidden = screen !== 'test';
		gameplayButton.setAttribute('aria-pressed', String(screen === 'gameplay'));
		testButton.setAttribute('aria-pressed', String(screen === 'test'));
		description.textContent = screen === 'gameplay' ? 'Ground enemy gameplay sandbox.' : 'Combat, projectile and beam tests.';
		hint.textContent = screen === 'gameplay'
			? 'Tap or hold Attack for a three-hit combo. Each strike angles its lunge and hitbox toward nearby enemies in the forward cone, dealing one damage and stunning and pushing every enemy hit. Enemies die after three hits; bars show remaining health. Fall off to return to the platform.'
			: 'Fall off? You’ll return to the platform.';
		container.setAttribute('aria-label', screen === 'gameplay'
			? 'Gameplay sandbox: cyan player on an amber platform. Rose ground enemies spawn and chase the player. Move, jump and tap or hold J for melee combos.'
			: 'Platformer test screen: cyan player on an amber platform with stationary rose targets and combat review fixtures.');
	};
	const requestScreen = function (screen: 'test' | 'gameplay') {
		if (transition || shuttingDown) return;
		for (const button of [gameplayButton, testButton, restartButton]) button.disabled = true;
		transition = showScreen(screen).catch(function (error: unknown) {
			console.error(error);
			const message = document.getElementById('error');
			if (message) { message.hidden = false; message.textContent = 'Could not switch screens. Reload to try again.'; }
		}).finally(function () {
			transition = undefined;
			for (const button of [gameplayButton, testButton, restartButton]) button.disabled = false;
		});
	};
	const showGameplay = function () { requestScreen('gameplay'); };
	const showTest = function () { requestScreen('test'); };
	const dispose = async function () {
		shuttingDown = true;
		touchControls?.dispose();
		detachFullscreen?.();
		gameplayButton.removeEventListener('click', showGameplay);
		testButton.removeEventListener('click', showTest);
		restartButton.removeEventListener('click', showGameplay);
		await transition;
		clearScene();
		await world.dispose();
	};
	try {
		await world.initialize();
		const playArea = document.getElementById('play-area');
		if (!(playArea instanceof HTMLElement)) throw new Error('Play area is missing.');
		touchControls = attachTouchControls(playArea, world.getResource('touchInput'));
		detachFullscreen = attachFullscreen(function () { world.getResource('pixiApp').resize(); });
		await showScreen('gameplay');
		gameplayButton.addEventListener('click', showGameplay);
		testButton.addEventListener('click', showTest);
		restartButton.addEventListener('click', showGameplay);
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
