import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listStaticProviderImportPresets } from '@/lib/provider-import-preset';

describe('provider import preset catalog metadata', () => {
	it('keeps localized catalog copy and an official platform link for every preset', () => {
		const rows = listStaticProviderImportPresets();

		assert.ok(rows.length > 0);
		for (const row of rows) {
			assert.ok(row.catalog?.i18n.zh.name.trim(), row.name);
			assert.ok(row.catalog?.i18n.zh.description.trim(), row.name);
			assert.ok(row.catalog?.i18n.en.name.trim(), row.name);
			assert.ok(row.catalog?.i18n.en.description.trim(), row.name);
			assert.match(row.catalog?.links?.platform ?? '', /^https:\/\//, row.name);
			if (row.catalog?.links?.api_keys) {
				assert.match(row.catalog.links.api_keys, /^https:\/\//, row.name);
			}
		}
	});
});
