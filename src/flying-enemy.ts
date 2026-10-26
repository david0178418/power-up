export const FLYING_ENEMY = { speed: 150, initialDelay: 0.8, spawnInterval: 4, waveSize: 3, limit: 9, radius: 60 } as const;

interface Point { readonly x: number; readonly y: number }

// Stable slots give the flock room around its target; local repulsion keeps
// converging paths from collapsing into a single pile during the descent.
export const steerFlyer = function (position: Point, target: Point, slot: number, neighbors: readonly Point[], dt: number): Point {
	const angle = slot % FLYING_ENEMY.limit / FLYING_ENEMY.limit * Math.PI * 2;
	const destination = { x: target.x + Math.cos(angle) * FLYING_ENEMY.radius, y: target.y - 24 + Math.sin(angle) * FLYING_ENEMY.radius };
	let x = (destination.x - position.x) * 3;
	let y = (destination.y - position.y) * 3;
	for (const other of neighbors) {
		if (other === position) continue;
		const dx = position.x - other.x;
		const dy = position.y - other.y;
		const distance = Math.hypot(dx, dy);
		if (distance <= 0 || distance >= 48) continue;
		const repulsion = (48 - distance) * 5 / distance;
		x += dx * repulsion;
		y += dy * repulsion;
	}
	const speed = Math.hypot(x, y);
	const scale = speed > 0 ? Math.min(1, FLYING_ENEMY.speed / speed, 1 / (3 * dt)) : 0;
	return { x: x * scale, y: y * scale };
};
