export interface TouchInput {
	move: number;
	jump: boolean;
	attack: boolean;
	shoot: boolean;
}

export const createTouchInput = function (): TouchInput {
	return { move: 0, jump: false, attack: false, shoot: false };
};

export const JOYSTICK_RADIUS = 48;
const DEADZONE = 0.15;

export const joystickOffset = function (dx: number, dy: number) {
	const scale = Math.min(1, JOYSTICK_RADIUS / (Math.hypot(dx, dy) || 1));
	const x = dx * scale;
	const y = dy * scale;
	const axis = x / JOYSTICK_RADIUS;
	return { x, y, move: Math.abs(axis) <= DEADZONE ? 0 : Math.sign(axis) * (Math.abs(axis) - DEADZONE) / (1 - DEADZONE) };
};
