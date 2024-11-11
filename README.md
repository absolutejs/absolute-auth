# Absolute Auth

## Overview

Absolute Auth is a TypeScript-based authentication system that provides a comprehensive solution for handling user authentication in web applications. It supports multiple authentication providers and offers features such as authorization, callback handling, token refresh, token revocation, and session management.

## Installation

### Prerequisites

- [Elysia](https://elysiajs.com/) 

### Steps to Install Dependencies

1. Clone the repository:
   ```bash
   git clone https://github.com/alexkahndev/absolute-auth.git
   cd absolute-auth
   ```

2. Install the dependencies:
   ```bash
   bun install
   ```

## Usage

### Running the Example Server

Start the example server:
   ```bash
   bun dev
   ```

3. Open your browser and navigate to `http://localhost:3000` to test the authentication flow.

## Authentication System

### Features

- **Authorization**: Handles the authorization process by generating the authorization URL and redirecting the user to the authentication provider.
- **Callback Handling**: Handles the callback process by validating the authorization code, decoding the ID token, and creating or retrieving the user.
- **Token Refresh**: Handles the token refresh process by refreshing the access token using the refresh token.
- **Token Revocation**: Handles the token revocation process by revoking the access token.
- **Session Management**: Manages user sessions, including creating, retrieving, and removing sessions.

### Configuration Options

- **Providers**: Configure multiple authentication providers such as Google, GitHub, and more.
- **Routes**: Customize the routes for authorization, callback, logout, status, refresh, and revoke.
- **Event Handlers**: Define custom event handlers for authorization, callback, status, refresh, logout, and revoke events.
- **User Management**: Implement custom functions for creating and retrieving users.

### Example Components and Utilities in the `example` Directory

- `components/Example.tsx`: A React component that demonstrates the usage of the authentication system, including login, logout, and protected routes.
- `components/Navbar.tsx`: A React component that provides a navigation bar with authentication-related links and actions.
- `server.ts`: The main server file that sets up the example server, handles routes, and integrates the authentication system.

## Note

This project uses Bun and is built for Elysia.
