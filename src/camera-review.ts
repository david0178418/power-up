import type { Application, Container } from 'pixi.js';
import { Graphics } from 'pixi.js';
import type { CameraState } from 'ecspresso/plugins/spatial/camera';
import { screenToWorld, worldToScreen, type Point } from './coordinates';
import { REVIEW_FIXTURE, VIEWPORT } from './view';

// Temporary review UI: no gameplay input bindings, simulation writes, or camera feel policy.
export const attachCameraReview = function (
	world: { getResource(name: 'cameraState'): CameraState; getResource(name: 'pixiApp'): Application; getResource(name: 'rootContainer'): Container },
	player: Readonly<Point>,
) {
	const camera = world.getResource('cameraState');
	const app = world.getResource('pixiApp');
	const root = world.getResource('rootContainer');
	const panel = document.getElementById('camera-review');
	const status = document.getElementById('camera-status');
	const mapping = document.getElementById('coordinate-status');
	if (!panel || !status || !mapping || !root.parent) throw new Error('Camera review setup is missing.');
	const viewport = root.parent;
	const mask = new Graphics().rect(0, 0, VIEWPORT.width, VIEWPORT.height).fill(0xffffff);
	viewport.addChild(mask);
	root.mask = mask;
	const fixture = new Graphics().rect(-18, -18, 36, 36).stroke({ color: 0xcd9cff, width: 3 })
		.moveTo(-26, 0).lineTo(26, 0).moveTo(0, -26).lineTo(0, 26).stroke({ color: 0xcd9cff, width: 2 });
	fixture.position.set(REVIEW_FIXTURE.x, REVIEW_FIXTURE.y);
	const cursor = new Graphics().circle(0, 0, 8).stroke({ color: 0xffffff, width: 2 });
	cursor.visible = false;
	root.addChild(fixture, cursor);
	let pointer: Point | undefined;
	const origin = function () { return { x: camera.x - VIEWPORT.width / 2, y: camera.y - VIEWPORT.height / 2 }; };
	const onClick = function (event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof HTMLButtonElement)) return;
		const pan = target.dataset['pan'];
		const offsets: Readonly<Record<string, Point>> = {
			left: { x: -160, y: 0 }, right: { x: 160, y: 0 }, up: { x: 0, y: -90 }, down: { x: 0, y: 90 },
		};
		const offset = pan === undefined ? undefined : offsets[pan];
		if (offset) camera.setPosition(camera.x + offset.x, camera.y + offset.y);
		if (pan === 'reset') camera.setPosition(VIEWPORT.width / 2, VIEWPORT.height / 2);
	};
	const onPointer = function (event: PointerEvent) { pointer = { x: event.clientX, y: event.clientY }; };
	const clearPointer = function () { pointer = undefined; cursor.visible = false; mapping.textContent = 'Point at the canvas to inspect world coordinates.'; };
	const update = function () {
		const topLeft = origin();
		status.textContent = `Camera origin: ${topLeft.x.toFixed(0)}, ${topLeft.y.toFixed(0)} · Player world: ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`;
		const rect = app.canvas.getBoundingClientRect();
		if (!pointer || rect.width <= 0 || rect.height <= 0) return;
		const point = screenToWorld(pointer, topLeft, VIEWPORT, rect);
		const screen = worldToScreen(point, topLeft, VIEWPORT, rect);
		cursor.position.set(point.x, point.y);
		cursor.visible = true;
		mapping.textContent = `World: ${point.x.toFixed(1)}, ${point.y.toFixed(1)} · Client: ${screen.x.toFixed(1)}, ${screen.y.toFixed(1)}`;
	};
	panel.addEventListener('click', onClick);
	app.canvas.addEventListener('pointermove', onPointer);
	app.canvas.addEventListener('pointerleave', clearPointer);
	window.addEventListener('blur', clearPointer);
	// After the managed world's tick and camera sync; no second animation loop.
	app.ticker.add(update, undefined, -100);
	update();
	return function () {
		panel.removeEventListener('click', onClick);
		app.canvas.removeEventListener('pointermove', onPointer);
		app.canvas.removeEventListener('pointerleave', clearPointer);
		window.removeEventListener('blur', clearPointer);
		app.ticker.remove(update);
		root.mask = null;
		[mask, fixture, cursor].forEach(function (shape) { shape.removeFromParent(); shape.destroy(); });
	};
};
