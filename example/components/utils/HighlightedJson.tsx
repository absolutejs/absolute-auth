import { primaryColor } from '../../styles/styles';
import { JsonLine } from './JsonLine';

type HighlightedJsonProps = {
	data: unknown;
};

export const HighlightedJson = ({ data }: HighlightedJsonProps) => {
	const jsonString = JSON.stringify(data ?? {}, null, 2);
	const jsonLines = jsonString
		.split('\n')
		.slice(1, -1)
		.map((line) => line.replace(/^ {2}/, ''));

	return (
		<pre
			style={{
				border: `2px solid ${primaryColor}`,
				borderRadius: '4px',
				fontFamily: 'monospace',
				height: '250px',
				margin: '0 0 8px',
				overflow: 'auto',
				padding: '16px',
				whiteSpace: 'pre-wrap'
			}}
		>
			<code>
				{jsonLines.map((line, lineIndex) => (
					<JsonLine
						key={lineIndex}
						line={line}
						needsNewline={lineIndex < jsonLines.length - 1}
					/>
				))}
			</code>
		</pre>
	);
};
