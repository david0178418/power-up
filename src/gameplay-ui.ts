import type { Application } from 'pixi.js';
import type { GameWorld } from './game';

type InputMode = 'keyboard' | 'gamepad' | 'touch';
type Screen = 'gameplay' | 'test';
const gameKeys = ['a', 'A', 'd', 'D', 'ArrowLeft', 'ArrowRight', ' ', 'j', 'J', 'k', 'K', 'l', 'L'] as const;
const bindings = {
	keyboard: [['Move', 'A / D', 'A / D or ← / →'], ['Jump', 'Space', 'Press Space'], ['Attack', 'J', 'Tap or hold J'], ['Shoot', 'K', 'Tap or hold K'], ['Beam', 'L', 'Hold L']],
	gamepad: [['Move', 'Stick', 'Left stick or D-pad'], ['Jump', 'Bottom', 'Bottom face button (0)'], ['Attack', 'Left', 'Tap / hold left face button (2)'], ['Shoot', 'Right', 'Tap / hold right face button (1)'], ['Beam', 'Top', 'Hold top face button (3)']],
	touch: [['Move', 'Drag', 'Drag anywhere on the left'], ['Jump', 'Tap', 'Tap Jump'], ['Attack', 'Hold', 'Tap or hold Attack'], ['Shoot', 'Hold', 'Tap or hold Shoot'], ['Beam', 'Hold', 'Hold Beam']],
} as const;

const element = function (id: string) {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing interface element: ${id}`);
	return found;
};

export const attachGameplayUi = function (world: Pick<GameWorld, 'getResource' | 'getEntitiesWithQuery'>, app: Application, options: {
	resetTouch: () => void;
	changeScreen: (screen: Screen) => Promise<void>;
}) {
	const dialog = element('game-menu');
	if (!(dialog instanceof HTMLDialogElement)) throw new Error('Game menu must be a dialog.');
	const game = element('game');
	const area = element('play-area');
	const legend = element('input-legend');
	const instructions = element('control-instructions');
	const combo = element('combat-hud');
	const comboValue = element('combo-value');
	const segments = Array.from(combo.querySelectorAll('i'));
	const airJump = element('air-jump-hint');
	const airBinding = element('air-jump-binding');
	const hint = element('first-play-hint');
	const inputLabel = element('input-device');
	const pause = world.getResource('gamePause');
	const input = world.getResource('inputState');
	const inputTabs = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-input]'));
	let mode: InputMode = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
	let screen: Screen = 'gameplay';
	let hintAge = 0;
	let busy = false;
	let disposed = false;
	let previousPadButtons = new Set<number>();
	let previousPadAxis = 0;
	let previousCombo = '';
	let previousAirJump = false;
	const removers: (() => void)[] = [];
	const listen = function (target: HTMLElement, handler: () => void) {
		target.addEventListener('click', handler);
		removers.push(function () { target.removeEventListener('click', handler); });
	};
	const help = function (next: InputMode) {
		instructions.replaceChildren(...bindings[next].map(function ([action, , text]) {
			const row = document.createElement('div');
			const term = document.createElement('dt');
			term.textContent = action;
			const definition = document.createElement('dd');
			definition.textContent = text;
			row.append(term, definition);
			return row;
		}));
		for (const tab of inputTabs) tab.setAttribute('aria-pressed', String(tab.dataset['input'] === next));
	};
	const setMode = function (next: InputMode) {
		mode = next;
		legend.replaceChildren(...bindings[next].map(function ([action, key]) {
			const binding = document.createElement('span');
			const glyph = document.createElement('kbd');
			glyph.textContent = key;
			binding.append(glyph, ` ${action}`);
			return binding;
		}));
		inputLabel.textContent = next.toUpperCase();
		area.dataset['input'] = next;
		hint.textContent = next === 'keyboard' ? 'Hold J to chain a three-hit combo' : next === 'gamepad' ? 'Hold the left face button for a three-hit combo' : 'Hold Attack to chain a three-hit combo';
		airBinding.textContent = next === 'keyboard' ? 'Release Jump, then press Space again' : next === 'gamepad' ? 'Release Jump, then press the bottom face button' : 'Release Jump, then tap again';
	};
	const releaseKeys = function () {
		for (const key of gameKeys) window.dispatchEvent(new KeyboardEvent('keyup', { key }));
	};
	const openMenu = function () {
		if (dialog.open || disposed) return;
		options.resetTouch();
		releaseKeys();
		pause.paused = true;
		pause.awaitingRelease = true;
		help(mode);
		dialog.showModal();
	};
	const closeMenu = function () {
		if (busy) return;
		options.resetTouch();
		dialog.close();
		releaseKeys();
		pause.paused = false;
		game.focus({ preventScroll: true });
	};
	const changeScreen = async function (next: Screen) {
		if (busy) return;
		busy = true;
		const buttons = Array.from(dialog.querySelectorAll('button'));
		for (const button of buttons) button.disabled = true;
		try {
			await options.changeScreen(next);
			if (!disposed) { busy = false; closeMenu(); }
		} catch (error: unknown) {
			console.error(error);
			const message = element('error');
			message.hidden = false;
			message.textContent = 'Could not switch screens. Reload to try again.';
		} finally {
			busy = false;
			for (const button of buttons) button.disabled = false;
		}
	};
	listen(element('open-controls'), openMenu);
	listen(element('open-menu'), openMenu);
	listen(element('resume-game'), closeMenu);
	listen(element('close-menu'), closeMenu);
	listen(element('restart-gameplay'), function () { void changeScreen('gameplay'); });
	listen(element('show-gameplay'), function () { void changeScreen('gameplay'); });
	listen(element('show-test'), function () { void changeScreen('test'); });
	for (const tab of inputTabs) listen(tab, function () {
		const next = tab.dataset['input'];
		if (next === 'keyboard' || next === 'gamepad' || next === 'touch') help(next);
	});
	const onKey = function (event: KeyboardEvent) {
		if (event.key === 'Escape' && !event.repeat) {
			// Preserve Escape-to-exit for the existing viewport fullscreen fallback.
			if (!dialog.open && area.classList.contains('is-expanded')) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (dialog.open) closeMenu(); else openMenu();
			return;
		}
		if (dialog.open) { event.stopImmediatePropagation(); return; }
		if (gameKeys.some(function (key) { return key === event.key; }) && mode !== 'keyboard') setMode('keyboard');
	};
	const onPointer = function (event: PointerEvent) {
		if (event.pointerType === 'touch' && !dialog.open && mode !== 'touch') setMode('touch');
	};
	const onKeyUp = function (event: KeyboardEvent) {
		// Preserve native Space activation on buttons and disclosure controls.
		if (dialog.open) event.stopImmediatePropagation();
	};
	const cancel = function (event: Event) { event.preventDefault(); closeMenu(); };
	const visibility = function () { if (document.hidden) openMenu(); };
	const blur = function () { releaseKeys(); options.resetTouch(); openMenu(); };
	window.addEventListener('keydown', onKey, true);
	window.addEventListener('keyup', onKeyUp, true);
	window.addEventListener('pointerdown', onPointer, true);
	window.addEventListener('blur', blur);
	document.addEventListener('visibilitychange', visibility);
	dialog.addEventListener('cancel', cancel);
	const update = function () {
		const buttons = new Set<number>();
		let axis = 0;
		for (const pad of input.gamepads) {
			for (const button of [0, 1, 2, 3, 9, 12, 13, 14, 15]) if (pad.isDown(button)) buttons.add(button);
			if (Math.abs(pad.axis(1)) > Math.abs(axis)) axis = pad.axis(1);
			if (!dialog.open && pad.axis(0) !== 0 && mode !== 'gamepad') setMode('gamepad');
		}
		const pressed = function (button: number) { return buttons.has(button) && !previousPadButtons.has(button); };
		if (Array.from(buttons).some(pressed) && mode !== 'gamepad') setMode('gamepad');
		if (pressed(9)) { if (dialog.open) closeMenu(); else openMenu(); }
		else if (dialog.open && !busy) {
			if (pressed(1)) closeMenu();
			else {
				const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary')).filter(function (item) { return item.getClientRects().length > 0; });
				const direction = pressed(13) || (axis > 0.5 && previousPadAxis <= 0.5) ? 1 : pressed(12) || (axis < -0.5 && previousPadAxis >= -0.5) ? -1 : 0;
				if (direction !== 0) {
					const current = focusable.findIndex(function (item) { return item === document.activeElement; });
					focusable[(current + direction + focusable.length) % focusable.length]?.focus();
				}
				if (pressed(0) && document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) document.activeElement.click();
			}
		}
		previousPadButtons = buttons;
		previousPadAxis = axis;
		if (!pause.paused) hintAge += app.ticker.deltaMS / 1000;
		const player = world.getEntitiesWithQuery(['player', 'melee'])[0];
		const melee = player?.components.melee;
		const active = screen === 'gameplay' && melee !== undefined;
		const chain = active && melee.strike > 0 ? String(melee.strike) : '';
		if (chain !== previousCombo) {
			combo.hidden = chain === '';
			comboValue.textContent = `${chain} / 3`;
			segments.forEach(function (segment, index) { segment.classList.toggle('is-lit', index < (melee?.strike ?? 0)); });
			previousCombo = chain;
		}
		const earned = active && melee.airJumpAvailable;
		if (earned !== previousAirJump) { airJump.hidden = !earned; previousAirJump = earned; }
		combo.hidden = chain === '' || earned;
		hint.hidden = !active || hintAge > 8 || chain !== '' || earned;
	};
	setMode(mode);
	help(mode);
	app.ticker.add(update, undefined, -200);
	return {
		setScreen: function (next: Screen) {
			screen = next;
			area.dataset['screen'] = next;
			element('screen-description').textContent = next === 'gameplay' ? 'Sandbox' : 'Test screen';
			element('test-controls').hidden = next !== 'test';
			for (const name of ['gameplay', 'test'] as const) element(`show-${name}`).setAttribute('aria-pressed', String(name === next));
		},
		dispose: function () {
			disposed = true;
			app.ticker.remove(update);
			for (const remove of removers) remove();
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('keyup', onKeyUp, true);
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('blur', blur);
			document.removeEventListener('visibilitychange', visibility);
			dialog.removeEventListener('cancel', cancel);
			dialog.close();
			pause.paused = false;
		},
	};
};
