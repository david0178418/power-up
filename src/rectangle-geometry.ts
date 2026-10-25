export interface Point { readonly x: number; readonly y: number }
interface Box extends Point { readonly width: number; readonly height: number }
export interface Beam { from: Point; to: Point; width: number }

export const validateBeam = function (beam: Readonly<Beam>) {
	if (![beam.from.x, beam.from.y, beam.to.x, beam.to.y, beam.width].every(Number.isFinite)
		|| beam.width <= 0 || !Number.isFinite(Math.hypot(beam.to.x - beam.from.x, beam.to.y - beam.from.y))
		|| (beam.from.x === beam.to.x && beam.from.y === beam.to.y)) {
		throw new RangeError('Beams require finite distinct endpoints and a positive finite width.');
	}
};

// Flat-ended oriented rectangle against a world-axis AABB. Strict SAT rejects
// edge-only contact; clipping finds the nearest covered longitudinal position.
export const beamOverlap = function (beam: Readonly<Beam>, box: Box): number | undefined {
	validateBeam(beam);
	const dx = beam.to.x - beam.from.x;
	const dy = beam.to.y - beam.from.y;
	const length = Math.hypot(dx, dy);
	const ux = dx / length;
	const uy = dy / length;
	const half = beam.width / 2;
	const cx = box.x - (beam.from.x + dx / 2);
	const cy = box.y - (beam.from.y + dy / 2);
	const hx = box.width / 2;
	const hy = box.height / 2;
	if (Math.abs(cx) >= Math.abs(ux) * length / 2 + Math.abs(uy) * half + hx
		|| Math.abs(cy) >= Math.abs(uy) * length / 2 + Math.abs(ux) * half + hy
		|| Math.abs(cx * ux + cy * uy) >= length / 2 + Math.abs(ux) * hx + Math.abs(uy) * hy
		|| Math.abs(-cx * uy + cy * ux) >= half + Math.abs(uy) * hx + Math.abs(ux) * hy) return undefined;
	let polygon = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(function ([x = 0, y = 0]) {
		const px = box.x + x - beam.from.x;
		const py = box.y + y - beam.from.y;
		return { x: px * ux + py * uy, y: -px * uy + py * ux };
	});
	for (const [axis, boundary, direction] of [['x', 0, 1], ['x', length, -1], ['y', -half, 1], ['y', half, -1]] as const) {
		const input = polygon;
		polygon = [];
		for (const [index, current] of input.entries()) {
			const previous = input[(index + input.length - 1) % input.length];
			if (!previous) continue;
			const a = (previous[axis] - boundary) * direction;
			const b = (current[axis] - boundary) * direction;
			if ((a >= 0) !== (b >= 0)) {
				const t = a / (a - b);
				polygon.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
			}
			if (b >= 0) polygon.push(current);
		}
	}
	return polygon.length ? Math.max(0, Math.min(...polygon.map(function (p) { return p.x; })) / length) : undefined;
};
