import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateImagesEditsContentType } from './images';

describe('validateImagesEditsContentType', () => {
	it('accepts multipart/form-data with boundary', () => {
		assert.equal(
			validateImagesEditsContentType('multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk'),
			null
		);
	});

	it('rejects application/json (the axios FormData footgun)', () => {
		const err = validateImagesEditsContentType('application/json');
		assert.match(err ?? '', /Unsupported Content-Type/i);
		assert.match(err ?? '', /multipart\/form-data/);
		assert.match(err ?? '', /application\/json/);
		assert.doesNotMatch(err ?? '', /Missing model/i);
	});

	it('rejects missing Content-Type', () => {
		assert.match(validateImagesEditsContentType(null) ?? '', /\(missing\)/);
		assert.match(validateImagesEditsContentType('') ?? '', /\(missing\)/);
	});

	it('rejects application/x-www-form-urlencoded for edits (files require multipart)', () => {
		const err = validateImagesEditsContentType('application/x-www-form-urlencoded');
		assert.match(err ?? '', /Unsupported Content-Type/i);
	});
});
