import type { Dispatch, SetStateAction } from 'react';
import type { User } from '../db/schema';
import { buttonStyle } from '../utils/styles';
import { AuthOptions } from './AuthOptions';
import { Modal } from './Modal';

type NavbarProps = {
	user: User | undefined;
	modalOpen: boolean;
	handleLogOut: () => Promise<void>;
	setModalOpen: Dispatch<SetStateAction<boolean>>;
};

const navLinks = [
	{ href: '/page1', label: 'Page 1' },
	{ href: '/page2', label: 'Page 2' },
	{ href: '/protected', label: 'Protected' }
];

export const Navbar = ({
	user,
	handleLogOut,
	modalOpen,
	setModalOpen
}: NavbarProps) => (
	<header
		style={{
			alignItems: 'center',
			backgroundColor: '#0C1015',
			color: '#fff',
			display: 'flex',
			justifyContent: 'space-between',
			padding: '10px 20px',
			position: 'relative'
		}}
	>
		<a
			style={{
				color: '#fff',
				fontSize: '1.5rem',
				fontWeight: 'bold',
				textDecoration: 'none'
			}}
			href="/"
		>
			Absolute Auth
		</a>

		<nav style={{ alignItems: 'center', display: 'flex' }}>
			{navLinks.map(({ href, label }, index) => (
				<a
					key={index}
					href={href}
					style={{
						borderRadius: '5px',
						color: '#fff',
						fontSize: '1rem',
						fontWeight: 'bold',
						marginRight: '20px',
						padding: '5px 10px',
						textDecoration: 'none',
						textWrap: 'nowrap'
					}}
				>
					{label}
				</a>
			))}
			{user ? (
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
							borderRadius: '50%',
							height: '40px',
							marginLeft: '20px',
							width: '40px'
						}}
						src={user?.picture ?? 'https://via.placeholder.com/150'}
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
			{modalOpen ? (
				<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
					<AuthOptions />
				</Modal>
			) : null}
		</nav>
	</header>
);
