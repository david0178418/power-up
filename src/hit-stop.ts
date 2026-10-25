import { definePlugin } from 'ecspresso';
import { inputSystems } from 'ecspresso/plugins/input/input';

export const SIMULATION_GROUP = 'game-simulation';

// Consume paused ticks instead of accumulating a catch-up burst. The impact tick
// completes normally so damage, death and transforms are visible during the hold.
export const hitStop = definePlugin('hit-stop')
	.withResourceTypes<{ hitStop: { remaining: number } }>()
	.install(function (systems) {
		systems.addResource('hitStop', { remaining: 0 });
		systems.addSystem('hit-stop-clock')
			.inPhase('fixedUpdate').before(inputSystems.update)
			.setPriority(Number.MAX_SAFE_INTEGER)
			.withResources(['hitStop'])
			.setProcess(function ({ ecs, dt, resources: { hitStop } }) {
				if (hitStop.remaining > 1e-9) {
					ecs.disableSystemGroup(SIMULATION_GROUP);
					hitStop.remaining = Math.max(0, hitStop.remaining - dt);
				} else {
					ecs.enableSystemGroup(SIMULATION_GROUP);
				}
			});
	});
