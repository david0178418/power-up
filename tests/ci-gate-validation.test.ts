import { expect, test } from 'bun:test';

test('temporary required-check failure for issue 5', function () {
	expect(true).toBe(false);
});
