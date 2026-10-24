import { expect, test } from 'bun:test';
import { screenToWorld, worldToScreen } from '../src/coordinates';

test('worldToScreen offsets points by the camera position', () => {
	expect(worldToScreen(
		{ x: 150, y: 90 },
		{ x: 100, y: 50 },
		{ width: 640, height: 360 },
		{ left: 0, top: 0, width: 640, height: 360 },
	)).toEqual({ x: 50, y: 40 });
});

test('worldToScreen includes the canvas client-space placement', () => {
	expect(worldToScreen(
		{ x: 20, y: 35 },
		{ x: 0, y: 0 },
		{ width: 100, height: 80 },
		{ left: 120, top: 75, width: 100, height: 80 },
	)).toEqual({ x: 140, y: 110 });
});

test('worldToScreen centers the logical viewport in a desktop canvas', () => {
	const screen = worldToScreen(
		{ x: 50, y: 50 },
		{ x: 0, y: 0 },
		{ width: 100, height: 100 },
		{ left: 10, top: 20, width: 300, height: 200 },
	);
	expect(screen).toEqual({ x: 160, y: 120 });

	// The unused horizontal margin remains outside the rendered viewport.
	expect(screenToWorld(
		{ x: 20, y: 120 },
		{ x: 0, y: 0 },
		{ width: 100, height: 100 },
		{ left: 10, top: 20, width: 300, height: 200 },
	)).toEqual({ x: -20, y: 50 });
});

test('worldToScreen centers the logical viewport in a portrait canvas', () => {
	expect(worldToScreen(
		{ x: 80, y: 45 },
		{ x: 0, y: 0 },
		{ width: 160, height: 90 },
		{ left: 12, top: 24, width: 180, height: 320 },
	)).toEqual({ x: 102, y: 184 });
});

test('worldToScreen and screenToWorld round-trip with camera, offset canvas, and letterboxing', () => {
	const camera = { x: 230, y: 140 };
	const viewport = { width: 1280, height: 720 };
	const canvas = { left: 30, top: 60, width: 800, height: 600 };
	const world = { x: 890, y: 530 };
	const screen = worldToScreen(world, camera, viewport, canvas);
	const restored = screenToWorld(screen, camera, viewport, canvas);

	expect(restored.x).toBeCloseTo(world.x);
	expect(restored.y).toBeCloseTo(world.y);
});

test('coordinate conversions reject non-finite inputs', () => {
	const viewport = { width: 100, height: 80 };
	const canvas = { left: 0, top: 0, width: 100, height: 80 };

	expect(() => worldToScreen({ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, viewport, canvas)).toThrow(RangeError);
	expect(() => screenToWorld({ x: 0, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }, viewport, canvas)).toThrow(RangeError);
	expect(() => worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0 }, { width: Number.POSITIVE_INFINITY, height: 80 }, canvas)).toThrow(RangeError);
	expect(() => screenToWorld({ x: 0, y: 0 }, { x: 0, y: 0 }, viewport, { left: 0, top: Number.NaN, width: 100, height: 80 })).toThrow(RangeError);
});

test('coordinate conversions reject non-positive viewport and canvas dimensions', () => {
	const point = { x: 0, y: 0 };
	const camera = { x: 0, y: 0 };

	expect(() => worldToScreen(point, camera, { width: 0, height: 80 }, { left: 0, top: 0, width: 100, height: 80 })).toThrow(RangeError);
	expect(() => screenToWorld(point, camera, { width: 100, height: 80 }, { left: 0, top: 0, width: 100, height: -1 })).toThrow(RangeError);
});
