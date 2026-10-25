import { expect, test } from 'bun:test';
import { joystickOffset } from '../src/touch-input';

test('floating joystick has a deadzone, proportional motion and clamped diagonal travel', () => {
	expect(joystickOffset(0, 0)).toEqual({ x: 0, y: 0, move: 0 });
	expect(joystickOffset(7, 0).move).toBe(0);
	expect(joystickOffset(24, 0).move).toBeCloseTo((0.5 - 0.15) / 0.85);
	expect(joystickOffset(200, 0)).toEqual({ x: 48, y: 0, move: 1 });
	expect(joystickOffset(-200, 0).move).toBe(-1);
	const diagonal = joystickOffset(120, 120);
	expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(48);
	expect(diagonal.move).toBeGreaterThan(0);
	expect(diagonal.move).toBeLessThan(1);
	expect(joystickOffset(0, 120).move).toBe(0);
});
