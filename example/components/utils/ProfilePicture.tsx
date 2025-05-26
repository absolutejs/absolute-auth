type ProfilePictureProps = {
	userImage: string | null | undefined;
	backupImage: string;
	width?: string;
	height?: string;
};

export const ProfilePicture = ({
	userImage,
	backupImage,
	width = '2rem',
	height = '2rem'
}: ProfilePictureProps) => (
	<img
		src={userImage ?? backupImage}
		alt="Profile"
		style={{
			borderRadius: '50%',
			height: height,
			objectFit: 'cover',
			width: width
		}}
	/>
);
