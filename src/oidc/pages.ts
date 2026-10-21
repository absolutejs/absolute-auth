/** Server-rendered OAuth screens. Rendering never grants access or changes redirects. */
export type OAuthPageBrand = {
	name: string;
	/** Same-origin path. External assets are deliberately excluded from auth screens. */
	logoPath?: string;
};
export type OAuthPageAction = { label: string; href: string };
export type OAuthConsentPageOptions = {
	brand: OAuthPageBrand;
	clientName: string;
	accountLabel?: string;
	permissions: string[];
	administrator?: boolean;
	explanation?: string;
	/** Same-origin POST endpoint; the application must enforce CSRF and authorization. */
	actionPath: string;
	fields: Record<string, string>;
	decisionField?: string;
	approveValue?: string;
	denyValue?: string;
	/** Device flow: require the user to compare this code with their requesting app. */
	userCode?: string;
};
export type OAuthStatusPageOptions = {
	brand: OAuthPageBrand;
	state:
		| 'handoff'
		| 'approved'
		| 'connected'
		| 'denied'
		| 'expired'
		| 'error';
	clientName?: string;
	title?: string;
	detail?: string;
	action?: OAuthPageAction;
};
const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
const localPath = (value: string) => {
	if (
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\\s\p{Cc}]/u.test(value)
	)
		throw new Error('OAuth page links must be same-origin paths');

	return escapeHtml(value);
};
const styles = `
:root { color-scheme: light dark; --bg:#eff3f8; --card:#ffffff; --ink:#152238; --muted:#506079; --border:#d8e1ed; --accent:#245bd6; --button:#fff; }
@media(prefers-color-scheme:dark) { :root { --bg:#09111e; --card:#101e30; --ink:#edf2fa; --muted:#b2bfd1; --border:#2b3c55; --accent:#e4d38b; --button:#111b2a; } }
* { box-sizing:border-box; } body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px; background:radial-gradient(ellipse at top, color-mix(in srgb,var(--accent) 12%,var(--bg)),var(--bg) 70%); color:var(--ink); font:16px/1.6 system-ui,sans-serif; }
main { width:100%; max-width:480px; border:1px solid var(--border); border-radius:24px; padding:clamp(24px,6vw,40px); background:var(--card); box-shadow:0 24px 70px #0002; overflow-wrap:anywhere; }
.brand { display:flex; align-items:center; gap:12px; font-weight:700; margin-bottom:28px; } .brand img { width:40px; height:40px; object-fit:contain; } .mark { display:grid; place-items:center; width:40px; height:40px; border:1px solid var(--border); border-radius:12px; color:var(--accent); }
h1 { font-size:1.65rem; line-height:1.25; letter-spacing:-.03em; margin:0 0 16px; } p { color:var(--muted); margin:0 0 20px; } ul { padding-left:24px; margin:24px 0; } li { margin:10px 0; } .badge { font-size:.8rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; margin-bottom:12px; } .code { display:block; font:700 1.6rem/1.5 ui-monospace,monospace; letter-spacing:.12em; text-align:center; padding:14px; border:1px solid var(--border); border-radius:12px; margin-bottom:16px; }
button,.action { display:block; width:100%; padding:13px 18px; border:1px solid transparent; border-radius:12px; background:var(--accent); color:var(--button); font:600 1rem/1.5 system-ui,sans-serif; cursor:pointer; text-align:center; text-decoration:none; } button.secondary { margin-top:10px; border-color:var(--border); background:transparent; color:var(--ink); } :focus-visible { outline:3px solid var(--accent); outline-offset:4px; } footer { margin-top:24px; color:var(--muted); font-size:.8rem; } .handoff { font-size:.9rem; }
`;
const page = (
	brand: OAuthPageBrand,
	title: string,
	content: string
) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ${escapeHtml(brand.name)}</title><style>${styles}</style></head><body><main>
<div class="brand">${brand.logoPath ? `<img src="${localPath(brand.logoPath)}" alt="">` : '<span class="mark" aria-hidden="true">↗</span>'}${escapeHtml(brand.name)}</div>
${content}<footer>Secure connection · ${escapeHtml(brand.name)}</footer></main></body></html>`;
const hiddenFields = (fields: Record<string, string>) =>
	Object.entries(fields)
		.map(
			([name, value]) =>
				`<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
		)
		.join('');
/** Render only after resolving the registered client and requested permissions on the server. */
export const renderOAuthConsentPage = (options: OAuthConsentPageOptions) => {
	const title = `Connect ${options.clientName}`;
	const decision = options.decisionField ?? 'decision';
	if (Object.hasOwn(options.fields, decision))
		throw new Error(
			'Decision field must not also be supplied as a hidden field'
		);
	const code = options.userCode
		? `<p>Only approve if you started this connection and this code matches the one in your app.</p><code class="code">${escapeHtml(options.userCode)}</code>`
		: '';

	return page(
		options.brand,
		title,
		`${options.administrator ? '<div class="badge">Administrator access</div>' : ''}<h1>${escapeHtml(title)}</h1><p>${options.accountLabel ? `Connecting as ${escapeHtml(options.accountLabel)}` : `Give this app access to your ${escapeHtml(options.brand.name)} account.`}</p>${code}<ul>${options.permissions.map((permission) => `<li>${escapeHtml(permission)}</li>`).join('')}</ul>${options.explanation ? `<p>${escapeHtml(options.explanation)}</p>` : ''}<p class="handoff">After approving, return to ${escapeHtml(options.clientName)} to finish connecting. Its completion screen may look different from ${escapeHtml(options.brand.name)}.</p><form method="post" action="${localPath(options.actionPath)}">${hiddenFields(options.fields)}<button type="submit" name="${escapeHtml(decision)}" value="${escapeHtml(options.approveValue ?? 'approve')}">Approve connection</button><button class="secondary" type="submit" name="${escapeHtml(decision)}" value="${escapeHtml(options.denyValue ?? 'deny')}">Cancel</button></form>`
	);
};
const statusCopy = (
	state: OAuthStatusPageOptions['state'],
	clientName: string
) => {
	switch (state) {
		case 'handoff':
			return {
				detail: `Continue in ${clientName} to finish connecting. If its login window expired, start a new connection from that app.`,
				title: 'Return to your app'
			};
		case 'approved':
			return {
				detail: `Return to ${clientName}. It can now finish connecting. You can close this window.`,
				title: 'Connection approved'
			};
		case 'connected':
			return {
				detail: `Return to ${clientName} to continue. You can close this window.`,
				title: 'You’re connected'
			};
		case 'denied':
			return {
				detail: 'This request was not approved. To try again, start a new connection from your app.',
				title: 'Connection canceled'
			};
		case 'expired':
			return {
				detail: 'This connection request has expired. Return to your app and connect again to get a fresh link.',
				title: 'Start a new connection'
			};
		default:
		case 'error':
			return {
				detail: 'Return to your app and start a new connection. If it still fails, contact support.',
				title: 'Connection could not finish'
			};
	}
};
const HTTP_OK = 200;
/** Private, script-free HTML response for authorization screens. */
export const oauthPageResponse = (html: string, status = HTTP_OK) =>
	new Response(html, {
		headers: {
			'cache-control': 'no-store',
			'content-security-policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
			'content-type': 'text/html; charset=utf-8',
			'referrer-policy': 'no-referrer',
			'x-content-type-options': 'nosniff'
		},
		status
	});
/** Use connected only after a successful token exchange/verified connection; a grant alone is approved. */
export const renderOAuthStatusPage = (options: OAuthStatusPageOptions) => {
	const copy = statusCopy(options.state, options.clientName ?? 'your app');
	const title = options.title ?? copy.title;

	return page(
		options.brand,
		title,
		`<div class="badge">${escapeHtml(options.brand.name)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(options.detail ?? copy.detail)}</p>${options.action ? `<a class="action" href="${localPath(options.action.href)}">${escapeHtml(options.action.label)}</a>` : ''}`
	);
};
