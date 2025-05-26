import { ProviderOption, providerOptions } from 'citra';
import { Dispatch, SetStateAction } from 'react';
import { providerData } from '../../utils/providerData';

type ProviderDropdownProps = {
	setCurrentProvider: Dispatch<
		SetStateAction<Lowercase<ProviderOption> | undefined>
	>;
};

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
				setCurrentProvider(providerOptions[index]);
			}
		}}
		style={{
			border: '1px solid #747775',
			borderRadius: '4px',
			fontSize: '14px',
			marginBottom: '10px',
			padding: '10px',
			textAlign: 'center',
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
		{providerOptions.map((provider, index) => (
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
