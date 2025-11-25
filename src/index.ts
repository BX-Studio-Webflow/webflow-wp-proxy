/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `pnpm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `pnpm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `pnpm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const CDN_PREFIX = '/_wfcdn';
const CDN_ORIGIN = 'https://cdn.prod.website-files.com';

// Common asset file extensions
const ASSET_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.json', '.map'];

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const target = env.WEBFLOW_URL;

		// Check if path ends with asset extension
		const isAssetPath = ASSET_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));

		if (isAssetPath) {
			// Try to proxy through CDN first
			const originPath = path.startsWith(CDN_PREFIX) ? path.replace(CDN_PREFIX, '') : path;
			const assetURL = new URL(`${originPath}${url.search}`, CDN_ORIGIN);
			const assetResponse = await fetch(assetURL, {
				method: 'GET',
				redirect: 'follow',
				cf: {
					cacheEverything: true,
					cacheTtl: 31_536_000,
				},
			});

			// Verify it's actually an asset by content-type
			const contentType = assetResponse.headers.get('content-type') || '';
			const isAssetType = contentType.includes('javascript') ||
				contentType.includes('css') ||
				contentType.includes('image/') ||
				contentType.includes('font/') ||
				contentType.includes('application/font') ||
				contentType.includes('application/json') ||
				contentType.includes('application/octet-stream');

			if (isAssetType) {
				const assetHeaders = new Headers(assetResponse.headers);
				assetHeaders.set('x-proxy-origin', 'webflow-cdn');
				assetHeaders.set('cache-control', 'public, max-age=31536000, immutable');
				assetHeaders.delete('content-length');

				return new Response(assetResponse.body, {
					status: assetResponse.status,
					headers: assetHeaders,
				});
			}
		}

		// Build the new proxied URL
		const newURL = `${path}${url.search}`;

		console.log({ newURL, target, env: { OTHER_URL: env.OTHER_URL, WEBFLOW_URL: env.WEBFLOW_URL } });

		const targetURL = new URL(newURL, target);

		// Clone headers, strip hop-by-hop headers
		const newHeaders = new Headers(request.headers);
		newHeaders.set('host', targetURL.hostname);

		const response = await fetch(targetURL, {
			method: request.method,
			headers: newHeaders,
			body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
			redirect: 'follow',
			cf: {
				cacheEverything: true,
				cacheTtl: 31_536_000, // 1 year
			},
		});

		// Ensure correct CORS, security & caching
		const resHeaders = new Headers(response.headers);
		resHeaders.set('x-proxy-origin', 'webflow');
		resHeaders.set('cache-control', 'public, max-age=31536000, immutable');

		if (resHeaders.get('content-type')?.includes('text/html')) {
			console.log('rewriting HTML');
			const originalHTML = await response.text();
			const rewrittenHTML = originalHTML.replaceAll(CDN_ORIGIN, CDN_PREFIX);
			resHeaders.delete('content-length');

			return new Response(rewrittenHTML, {
				status: response.status,
				headers: resHeaders,
			});
		}

		return new Response(response.body, {
			status: response.status,
			headers: resHeaders,
		});
	},
} satisfies ExportedHandler<Env>;
