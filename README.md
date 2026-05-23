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

### Example app

A full, runnable demo lives in the AbsoluteJS examples repo under
[`examples/auth`](https://github.com/absolutejs/examples/tree/main/auth). It
shows `@absolutejs/auth` across all six AbsoluteJS frontends (React, Vue,
Svelte, Angular, HTML, HTMX) — login, identity linking/merging, and connector
grants — against one shared Elysia server.

## Authentication System

### Features

- **Authorization**: Handles the authorization process by generating the authorization URL and redirecting the user to the authentication provider.
- **Callback Handling**: Handles the callback process by validating the authorization code, decoding the ID token, and creating or retrieving the user.
- **Token Refresh**: Handles the token refresh process by refreshing the access token using the refresh token.
- **Token Revocation**: Handles the token revocation process by revoking the access token.
- **Session Management**: Manages user sessions, including creating, retrieving, and removing sessions.

### Configuration Options

- **Providers**: Configure multiple authentication providers such as Google, GitHub, and more.
- **Routes**: Customize the routes for authorization, callback, signout, status, refresh, and revoke.
- **Event Handlers**: Define custom event handlers for authorization, callback, status, refresh, signout, and revoke events.
- **User Management**: Implement custom functions for creating and retrieving users.

## Note

This project uses Bun and is built for Elysia.
