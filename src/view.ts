import { createCameraPlugin } from 'ecspresso/plugins/spatial/camera';

export const VIEWPORT = { width: 960, height: 540 } as const;
export const REVIEW_FIXTURE = { x: 1120, y: 270 } as const;

// ECSpresso stores the camera center; coordinate helpers use its top-left.
export const createViewCamera = function () {
	return createCameraPlugin({
		viewportWidth: VIEWPORT.width,
		viewportHeight: VIEWPORT.height,
		initial: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
	});
};
