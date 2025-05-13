import { isNormalizedProviderOption, ProviderOption } from 'citra';
import { Dispatch, SetStateAction } from 'react';
import { providerData } from '../../utils/providerData';

type ProviderDropdownProps = {
	setCurrentProvider: Dispatch<
		SetStateAction<Lowercase<ProviderOption> | undefined>
	>;
};

const normalizedProviderOptions = Object.keys(providerData).filter((provider) =>
	isNormalizedProviderOption(provider)
);

export const ProviderDropdown = ({
	setCurrentProvider
}: ProviderDropdownProps) => (
	<select
		defaultValue={-1}
		onChange={(event) => {
			const index = parseInt(event.target.value);

			if (index < 0) {
				setCurrentProvider(undefined);
			} else {
				setCurrentProvider(normalizedProviderOptions[index]);
			}
		}}
		style={{
			border: '1px solid #747775',
			borderRadius: '4px',
			fontSize: '14px',
			textAlign: 'center',
			marginBottom: '10px',
			padding: '10px',
			width: '100%'
		}}
	>
		<option
			value={-1}
			style={{
				fontWeight: 'bold'
			}}
		>
			Select provider
		</option>
		{normalizedProviderOptions.map((provider, index) => (
			<option
				key={provider}
				value={index}
				style={{
					textAlign: 'left'
				}}
			>
				{providerData[provider].name}
			</option>
		))}
	</select>
);
