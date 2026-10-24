export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface CanvasRect extends Size {
	readonly left: number;
	readonly top: number;
}

const assertFinite = function (value: number, name: string) {
	if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
};

const assertValidInputs = function (point: Point, camera: Point, viewport: Size, canvas: CanvasRect) {
	assertFinite(point.x, 'point.x');
	assertFinite(point.y, 'point.y');
	assertFinite(camera.x, 'camera.x');
	assertFinite(camera.y, 'camera.y');
	assertFinite(viewport.width, 'viewport.width');
	assertFinite(viewport.height, 'viewport.height');
	assertFinite(canvas.left, 'canvas.left');
	assertFinite(canvas.top, 'canvas.top');
	assertFinite(canvas.width, 'canvas.width');
	assertFinite(canvas.height, 'canvas.height');
	if (viewport.width <= 0 || viewport.height <= 0) throw new RangeError('viewport dimensions must be positive');
	if (canvas.width <= 0 || canvas.height <= 0) throw new RangeError('canvas dimensions must be positive');
};

const getCanvasTransform = function (viewport: Size, canvas: CanvasRect) {
	const scale = Math.min(canvas.width / viewport.width, canvas.height / viewport.height);
	const left = canvas.left + (canvas.width - viewport.width * scale) / 2;
	const top = canvas.top + (canvas.height - viewport.height * scale) / 2;
	return { scale, left, top };
};

export const worldToScreen = function (point: Point, camera: Point, viewport: Size, canvas: CanvasRect): Point {
	assertValidInputs(point, camera, viewport, canvas);
	const transform = getCanvasTransform(viewport, canvas);
	return {
		x: transform.left + (point.x - camera.x) * transform.scale,
		y: transform.top + (point.y - camera.y) * transform.scale,
	};
};

export const screenToWorld = function (point: Point, camera: Point, viewport: Size, canvas: CanvasRect): Point {
	assertValidInputs(point, camera, viewport, canvas);
	const transform = getCanvasTransform(viewport, canvas);
	return {
		x: (point.x - transform.left) / transform.scale + camera.x,
		y: (point.y - transform.top) / transform.scale + camera.y,
	};
};
