import type { Dispatch, SetStateAction } from 'react';
import { buttonStyle } from '../utils/styles';
import { Modal } from './Modal';
import { AuthOptions } from './AuthOptions';
import type { User } from '../dbSchema';

type NavbarProps = {
	userIdentity: User | null;
	setUserIdentity: Dispatch<SetStateAction<User | null>>;
	modalOpen: boolean;
	setModalOpen: Dispatch<SetStateAction<boolean>>;
};

const navLinks = [
	{ href: '/page1', label: 'Page 1' },
	{ href: '/page2', label: 'Page 2' },
	{ href: '/protected', label: 'Protected' }
];

export const Navbar = ({
	userIdentity,

	setUserIdentity,
	modalOpen,
	setModalOpen
}: NavbarProps) => {
	const handleLogOut = async () => {
		const response = await fetch('/logout', { method: 'POST' });
		if (response.ok) {
			setUserIdentity(null);
		} else {
			console.error('Logout failed');
		}
	};

	return (
		<header
			style={{
				position: 'relative',
				backgroundColor: '#0C1015',
				padding: '10px 20px',
				color: '#fff',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between'
			}}
		>
			<a
				style={{
					fontSize: '1.5rem',
					fontWeight: 'bold',
					textDecoration: 'none',
					color: '#fff'
				}}
				href="/"
			>
				Absolute Auth
			</a>

			<nav style={{ display: 'flex', alignItems: 'center' }}>
				{navLinks.map(({ href, label }, index) => (
					<a
						key={index}
						href={href}
						style={{
							textDecoration: 'none',
							fontSize: '1rem',
							textWrap: 'nowrap',
							fontWeight: 'bold',
							marginRight: '20px',
							padding: '5px 10px',
							borderRadius: '5px',
							color: '#fff'
						}}
					>
						{label}
					</a>
				))}
				{userIdentity ? (
					<>
						<button
							style={buttonStyle({
								backgroundColor: '#f3f3f3',
								color: '#333'
							})}
							onClick={handleLogOut}
						>
							Log Out
						</button>
						<img
							style={{
								width: '40px',
								height: '40px',
								borderRadius: '50%',
								marginLeft: '20px'
							}}
							src={
								userIdentity?.picture ??
								'https://via.placeholder.com/150'
							}
							alt="profile"
						/>
					</>
				) : (
					<>
						<button
							style={buttonStyle({
								backgroundColor: '#f3f3f3',
								color: '#333'
							})}
							onClick={() => setModalOpen(true)}
						>
							Log In
						</button>

						<button
							style={buttonStyle({
								backgroundColor: '#f3f3f3',
								color: '#333'
							})}
							onClick={() => setModalOpen(true)}
						>
							Sign Up
						</button>
					</>
				)}
				{modalOpen && (
					<Modal
						isOpen={modalOpen}
						onClose={() => setModalOpen(false)}
					>
						<AuthOptions />
					</Modal>
				)}
			</nav>
		</header>
	);
};
