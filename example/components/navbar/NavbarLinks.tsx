import { isNavbarDropdown, NavbarElement } from '../../utils/types';
import { NavbarDropdown } from './NavbarDropdown';
import { NavbarLink } from './NavbarLink';

type NavbarLinksProps = {
	navbarData: NavbarElement[];
};

export const NavbarLinks = ({ navbarData }: NavbarLinksProps) => (
	<nav
		style={{
			alignItems: 'center',
			display: 'flex',
			gap: '15px',
			justifyContent: 'center'
		}}
	>
		{navbarData.map((element) => {
			if (isNavbarDropdown(element)) {
				return (
					<NavbarDropdown
						key={element.label}
						label={element.label}
						href={element.href}
						links={element.links}
					/>
				);
			}

			return (
				<NavbarLink
					key={element.label}
					icon={element.icon}
					href={element.href}
					label={element.label}
				/>
			);
		})}
	</nav>
);
