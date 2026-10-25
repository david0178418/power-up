import type { Graphics } from 'pixi.js';
import type { Health } from 'ecspresso/plugins/combat/health';

export const drawHealthBar = function (drawing: Graphics, health: Readonly<Health>, x: number, y: number, width: number) {
	const fraction = health.max > 0 ? Math.max(0, Math.min(1, health.current / health.max)) : 0;
	drawing.rect(x - width / 2 - 1, y - 1, width + 2, 6).fill(0x101c2c);
	drawing.rect(x - width / 2, y, width, 4).fill(0x59738a);
	if (fraction > 0) drawing.rect(x - width / 2, y, width * fraction, 4).fill(0x65deeb);
};
