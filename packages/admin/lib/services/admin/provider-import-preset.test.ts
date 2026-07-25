import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	inferStaticProviderIconKey,
	inferStaticProviderVendorKey,
	listStaticProviderImportPresets,
} from '@/lib/provider-import-preset';

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

	it('infers an imported Provider vendor without storing a database column', () => {
		const rows = listStaticProviderImportPresets();
		const deepseek = rows.find((row) => row.name === 'DeepSeek');
		assert.ok(deepseek);

		assert.equal(inferStaticProviderVendorKey({ name: deepseek.name }), 'deepseek');
		assert.equal(inferStaticProviderVendorKey({ name: `${deepseek.name} (2)` }), 'deepseek');
		assert.equal(
			inferStaticProviderVendorKey({
				name: 'Renamed production upstream',
				endpoints: deepseek.endpoints,
			}),
			'deepseek'
		);
		assert.equal(
			inferStaticProviderVendorKey({
				name: 'Private upstream',
				endpoints: {
					openai: { endpoints: { chat: 'https://example.com/v1/chat/completions' } },
				},
			}),
			'other'
		);
	});

	it('prefers a product icon over the parent vendor logo without storing a database column', () => {
		const rows = listStaticProviderImportPresets();
		const mimo = rows.find((row) => row.name === 'Xiaomi MiMo');
		assert.ok(mimo);

		assert.equal(mimo.vendor_key, 'xiaomi');
		assert.equal(mimo.icon_key, 'xiaomimimo');
		assert.equal(inferStaticProviderIconKey({ name: mimo.name }), 'xiaomimimo');
		assert.equal(
			inferStaticProviderIconKey({
				name: 'Renamed MiMo upstream',
				endpoints: mimo.endpoints,
				vendor_key: mimo.vendor_key,
			}),
			'xiaomimimo'
		);
		assert.equal(inferStaticProviderIconKey({ name: 'Private upstream', vendor_key: 'openai' }), 'openai');
	});
});
