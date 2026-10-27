import { joystickOffset, type TouchInput } from './touch-input';

export const attachTouchControls = function (area: HTMLElement, input: TouchInput) {
	const overlay = document.createElement('div');
	overlay.className = 'touch-controls';
	overlay.innerHTML = `
		<div class="touch-move" aria-label="Touch and drag to move">
			<span class="touch-move-hint">Touch + drag to move</span>
			<div class="touch-stick" hidden><div class="touch-stick-knob"></div></div>
		</div>
		<div class="touch-actions" role="group" aria-label="Touch actions">
			<button type="button" class="touch-action" data-action="attack" aria-pressed="false">Attack</button>
			<button type="button" class="touch-action" data-action="shoot" aria-pressed="false">Shoot</button>
			<button type="button" class="touch-action" data-action="jump" aria-pressed="false">Jump</button>
		</div>`;
	const zone = overlay.querySelector('.touch-move');
	const stick = overlay.querySelector('.touch-stick');
	const knob = overlay.querySelector('.touch-stick-knob');
	if (!(zone instanceof HTMLElement) || !(stick instanceof HTMLElement) || !(knob instanceof HTMLElement)) {
		throw new Error('Touch controls are missing.');
	}
	const buttons = Array.from(overlay.querySelectorAll('button'));
	const captures = new Map<number, HTMLElement>();
	const actions = new Map<number, 'jump' | 'attack' | 'shoot'>();
	let joystick: { id: number; x: number; y: number } | undefined;
	const syncActions = function () {
		for (const action of ['jump', 'attack', 'shoot'] as const) {
			input[action] = Array.from(actions.values()).includes(action);
			buttons.find(function (button) { return button.dataset['action'] === action; })?.setAttribute('aria-pressed', String(input[action]));
		}
	};
	const release = function (id: number) {
		const element = captures.get(id);
		captures.delete(id);
		if (joystick?.id === id) {
			joystick = undefined;
			input.move = 0;
			stick.hidden = true;
			zone.classList.remove('is-active');
		}
		actions.delete(id);
		syncActions();
		if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
	};
	const reset = function () {
		for (const id of Array.from(captures.keys())) release(id);
		input.move = 0;
		input.jump = false;
		input.attack = false;
		input.shoot = false;
	};
	const down = function (event: PointerEvent) {
		if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
		const button = event.target.closest('button');
		const action = button?.dataset['action'];
		let element: HTMLElement;
		if (button && (action === 'jump' || action === 'attack' || action === 'shoot')) {
			element = button;
			actions.set(event.pointerId, action);
			syncActions();
		} else if (zone.contains(event.target) && !joystick) {
			element = zone;
			const rect = zone.getBoundingClientRect();
			joystick = { id: event.pointerId, x: event.clientX, y: event.clientY };
			stick.style.left = `${event.clientX - rect.left}px`;
			stick.style.top = `${event.clientY - rect.top}px`;
			knob.style.transform = 'translate(-50%, -50%)';
			stick.hidden = false;
			zone.classList.add('is-active');
		} else return;
		event.preventDefault();
		event.stopPropagation();
		captures.set(event.pointerId, element);
		element.setPointerCapture(event.pointerId);
	};
	const move = function (event: PointerEvent) {
		if (joystick?.id !== event.pointerId) return;
		const offset = joystickOffset(event.clientX - joystick.x, event.clientY - joystick.y);
		input.move = offset.move;
		knob.style.transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`;
	};
	const up = function (event: PointerEvent) { release(event.pointerId); };
	const visibility = function () { if (document.hidden) reset(); };
	const observer = new ResizeObserver(reset);
	const touchDevice = window.matchMedia('(any-pointer: coarse)');
	const availability = function () {
		reset();
		overlay.hidden = !touchDevice.matches && navigator.maxTouchPoints === 0;
	};
	availability();
	area.append(overlay);
	observer.observe(area);
	overlay.addEventListener('pointerdown', down);
	overlay.addEventListener('pointermove', move);
	for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) overlay.addEventListener(name, up);
	window.addEventListener('blur', reset);
	document.addEventListener('visibilitychange', visibility);
	touchDevice.addEventListener('change', availability);
	return {
		reset,
		dispose: function () {
			reset();
			observer.disconnect();
			overlay.removeEventListener('pointerdown', down);
			overlay.removeEventListener('pointermove', move);
			for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) overlay.removeEventListener(name, up);
			window.removeEventListener('blur', reset);
			document.removeEventListener('visibilitychange', visibility);
			touchDevice.removeEventListener('change', availability);
			overlay.remove();
		},
	};
};
