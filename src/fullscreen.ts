// Keep the canvas and its exit control together in native and viewport fullscreen.
export const attachFullscreen = function (resize: () => void) {
	const area = document.getElementById('play-area');
	const game = document.getElementById('game');
	const button = document.getElementById('toggle-fullscreen');
	const status = document.getElementById('fullscreen-status');
	if (!(area instanceof HTMLElement) || !(game instanceof HTMLElement)
		|| !(button instanceof HTMLButtonElement) || !status) {
		throw new Error('Fullscreen controls are missing.');
	}
	let expanded = false;
	let disposed = false;
	const siblings = Array.from(area.parentElement?.children ?? [])
		.filter(function (element): element is HTMLElement { return element instanceof HTMLElement && element !== area; })
		.map(function (element) { return { element, inert: element.inert }; });
	const sync = function () {
		const active = expanded || document.fullscreenElement === area;
		button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
		button.setAttribute('aria-pressed', String(active));
	};
	const setExpanded = function (active: boolean) {
		expanded = active;
		area.classList.toggle('is-expanded', active);
		document.documentElement.classList.toggle('play-expanded', active);
		for (const sibling of siblings) sibling.element.inert = active || sibling.inert;
		sync();
	};
	const toggle = async function () {
		button.disabled = true;
		status.textContent = '';
		try {
			if (expanded) {
				setExpanded(false);
			} else if (document.fullscreenElement === area) {
				await document.exitFullscreen();
			} else {
				try {
					if (!document.fullscreenEnabled || typeof area.requestFullscreen !== 'function') {
						setExpanded(true);
					} else {
						await area.requestFullscreen();
						if (disposed && document.fullscreenElement === area) await document.exitFullscreen();
					}
				} catch {
					// Mobile browsers and embedded pages may reject native fullscreen.
					if (!disposed) setExpanded(true);
				}
			}
		} catch {
			status.textContent = 'Could not exit fullscreen. Use your browser’s fullscreen control to exit.';
		} finally {
			if (!disposed) { button.disabled = false; sync(); }
		}
	};
	const onEscape = function (event: KeyboardEvent) {
		if (event.key === 'Escape' && expanded) {
			setExpanded(false);
			button.focus({ preventScroll: true });
		}
	};
	const observer = new ResizeObserver(resize);
	observer.observe(game);
	button.hidden = false;
	button.addEventListener('click', toggle);
	document.addEventListener('fullscreenchange', sync);
	document.addEventListener('keydown', onEscape);
	return function () {
		disposed = true;
		observer.disconnect();
		button.removeEventListener('click', toggle);
		document.removeEventListener('fullscreenchange', sync);
		document.removeEventListener('keydown', onEscape);
		setExpanded(false);
		button.hidden = true;
		if (document.fullscreenElement === area) void document.exitFullscreen().catch(console.error);
	};
};
