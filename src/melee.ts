// Timing is simulation time; a held attack repeats the three-strike chain.
export const MELEE = {
	active: 0.12, recovery: 0.14, finisherRecovery: 0.28, reset: 0.45,
	lungeSpeed: 180, magnetismSpeed: 260, magnetismRange: 110, coneHalfAngle: Math.PI / 4,
	stun: 0.24, finisherStun: 0.38, pushSpeed: 150, finisherPushSpeed: 230,
} as const;

export interface MeleeState {
	strike: number;
	remaining: number;
	idle: number;
	active: boolean;
	queued: boolean;
	held: boolean;
	direction: -1 | 1;
	lunge: number;
	aim: { x: number; y: number };
	hitTargets: Set<number>;
}

export const createMeleeState = function (): MeleeState {
	return { strike: 0, remaining: 0, idle: 0, active: false, queued: false, held: false, direction: 1, lunge: 0, aim: { x: 1, y: 0 }, hitTargets: new Set() };
};

export interface HitReaction { remaining: number; push: number }

export const inMeleeCone = function (dx: number, dy: number, facing: -1 | 1): boolean {
	const distance = Math.hypot(dx, dy);
	return distance > 0 && distance <= MELEE.magnetismRange && dx * facing / distance >= Math.cos(MELEE.coneHalfAngle);
};
