type JsonLineProps = {
	line: string;
	needsNewline: boolean;
};

export const JsonLine = ({ line, needsNewline }: JsonLineProps) => {
	const elements = [];
	let lastIndex = 0;
	const tokenPattern =
		/("(?:\\u[0-9A-Fa-f]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[[\]{},])/g;

	for (const match of line.matchAll(tokenPattern)) {
		const [token] = match;
		const index = match.index ?? 0;
		if (lastIndex < index) elements.push(line.slice(lastIndex, index));
		let style;
		if (/^".*":$/.test(token)) style = { color: '#922' };
		else if (/^"/.test(token)) style = { color: '#070' };
		else if (/^(true|false)$/.test(token)) style = { color: '#00c' };
		else if (token === 'null') style = { color: '#777' };
		else if (/^-?\d/.test(token)) style = { color: '#00f' };
		elements.push(<span style={style}>{token}</span>);
		lastIndex = index + token.length;
	}
	if (lastIndex < line.length) elements.push(line.slice(lastIndex));

	return (
		<span>
			{elements}
			{needsNewline === true && '\n'}
		</span>
	);
};
