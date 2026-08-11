import next from 'eslint-config-next';

/** @type {import('eslint').Linter.Config[]} */
const config = [
	...next,
	{
		ignores: [
			'.open-next/**',
			'.wrangler/**',
			'cloudflare-env.d.ts',
			'scripts/**',
		],
	},
	{
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@cloud-api/proxy', '@cloud-api/proxy/*', '@cloud-api/proxy-services', '@cloud-api/proxy-services/*'],
							message:
								'Admin must not import @cloud-api/proxy. Use @cloud-api/tool-engines for Tool engine clients.',
						},
						{
							group: ['**/packages/proxy/**', '../proxy/**', '../../proxy/**'],
							message:
								'Admin must not reach into packages/proxy. Shared Tool engines live in @cloud-api/tool-engines.',
						},
					],
				},
			],
		},
	},
];

export default config;
