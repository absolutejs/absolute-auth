# Drop-in UI Components

The most common reason developers stay on Clerk / Auth0 isn't the auth
itself — it's the polished `<UserButton />` and `<SignIn />` components
that go with them. This page is the answer to *"but I'd lose Clerk's
`<UserButton />`."*

`@absolutejs/auth` ships three headless components (React) + the recipe
to build the same in Vue / Svelte / Solid using the existing
composables. Every component is restyleable via a `classNames` prop;
every internal element carries a `data-abs-auth="…"` attribute the
consumer can target from CSS without touching the source.

## React

The components are real React functional components in
`@absolutejs/auth/react`:

```tsx
import { authClient } from './shared/authClient'; // your createAuthClient instance
import { SignIn, SignUp, UserButton } from '@absolutejs/auth/react';

// Sign-in page
<SignIn
  client={authClient}
  providers={['google', 'github']}  // optional OAuth buttons above the form
  onSuccess={(result) => {
    if (result.status === 'mfa_required') router.push('/mfa');
    else router.push('/dashboard');
  }}
  onError={(error) => console.error(error.message)}
  classNames={{
    container: 'flex flex-col gap-4 max-w-sm',
    button: 'rounded-md bg-violet-600 text-white py-2',
    input: 'border-slate-200 border rounded px-3 py-2',
    // …all classNames are optional
  }}
/>

// Sign-up page (always email/password; OAuth registration uses /authorize directly)
<SignUp
  client={authClient}
  onSuccess={(result) => {
    if (result.status === 'verification_required') router.push('/verify-email');
    else router.push('/dashboard');
  }}
/>

// Top navigation user button
<UserButton
  client={authClient}
  user={user}  // your AuthUser-shaped record (you keep the session state)
  items={[
    { label: 'Settings', href: '/settings' },
    { label: 'API keys', href: '/settings/api' },
  ]}
  onSignOut={() => router.push('/')}
/>
```

### `data-abs-auth` attributes — restyle without classNames

If you don't want to thread classNames through every render call, set
your CSS based on the data attribute selector:

```css
[data-abs-auth='sign-in'] { display: flex; flex-direction: column; gap: 1rem; }
[data-abs-auth='submit']:disabled { opacity: 0.5; cursor: not-allowed; }
[data-abs-auth='oauth-grid'] { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
[data-abs-auth='menu'] { position: absolute; right: 0; top: 100%; }
```

## Vue 3 — copy-paste recipes

Vue SFCs have their own compile step that's outside this package's
build scope, so we ship the composables (`useSignIn`, `useSignUp`,
`useSignOut`) and you drop a ~30-line SFC into your project:

```vue
<!-- src/components/auth/SignIn.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useSignIn } from '@absolutejs/auth/vue';
import type { AuthClient } from '@absolutejs/auth/client';

const props = defineProps<{ client: AuthClient }>();
const emit = defineEmits<{ success: [unknown]; error: [Error] }>();

const email = ref('');
const password = ref('');
const { error, isPending, mutate } = useSignIn(props.client);

const onSubmit = async () => {
  const result = await mutate({ email: email.value, password: password.value });
  if (result.error !== null) emit('error', result.error);
  else if (result.data !== null) emit('success', result.data);
};
</script>

<template>
  <form @submit.prevent="onSubmit" data-abs-auth="sign-in">
    <label data-abs-auth="email-field">
      <span>Email</span>
      <input v-model="email" type="email" autocomplete="username webauthn" required />
    </label>
    <label data-abs-auth="password-field">
      <span>Password</span>
      <input v-model="password" type="password" autocomplete="current-password" minlength="12" required />
    </label>
    <p v-if="$error" role="alert" data-abs-auth="error">{{ $error.message }}</p>
    <button type="submit" :disabled="isPending" data-abs-auth="submit">
      {{ isPending ? 'Signing in…' : 'Sign in' }}
    </button>
  </form>
</template>
```

`SignUp.vue` and `UserButton.vue` follow the same shape — swap
`useSignIn` for `useSignUp` / `useSignOut`.

## Svelte 5 (runes) — copy-paste recipe

```svelte
<!-- src/lib/components/SignIn.svelte -->
<script lang="ts">
  import { useSignIn } from '@absolutejs/auth/svelte';
  import type { AuthClient } from '@absolutejs/auth/client';

  let { client, onSuccess, onError }: {
    client: AuthClient;
    onSuccess?: (result: unknown) => void;
    onError?: (error: Error) => void;
  } = $props();

  let email = $state('');
  let password = $state('');
  const { error, isPending, mutate } = useSignIn(client);

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const result = await mutate({ email, password });
    if (result.error !== null) onError?.(result.error);
    else if (result.data !== null) onSuccess?.(result.data);
  };
</script>

<form onsubmit={onSubmit} data-abs-auth="sign-in">
  <label data-abs-auth="email-field">
    <span>Email</span>
    <input bind:value={email} type="email" autocomplete="username webauthn" required />
  </label>
  <label data-abs-auth="password-field">
    <span>Password</span>
    <input bind:value={password} type="password" autocomplete="current-password" minlength="12" required />
  </label>
  {#if $error}
    <p role="alert" data-abs-auth="error">{$error.message}</p>
  {/if}
  <button type="submit" disabled={$isPending} data-abs-auth="submit">
    {$isPending ? 'Signing in…' : 'Sign in'}
  </button>
</form>
```

## Solid — copy-paste recipe

```tsx
// src/components/auth/SignIn.tsx
import { createSignal, type Component } from 'solid-js';
import { useSignIn } from '@absolutejs/auth/solid';
import type { AuthClient } from '@absolutejs/auth/client';

export const SignIn: Component<{
  client: AuthClient;
  onSuccess?: (result: unknown) => void;
  onError?: (error: Error) => void;
}> = (props) => {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const { error, isPending, mutate } = useSignIn(props.client);

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const result = await mutate({ email: email(), password: password() });
    if (result.error !== null) props.onError?.(result.error);
    else if (result.data !== null) props.onSuccess?.(result.data);
  };

  return (
    <form onSubmit={onSubmit} data-abs-auth="sign-in">
      <label data-abs-auth="email-field">
        <span>Email</span>
        <input value={email()} onInput={(e) => setEmail(e.currentTarget.value)}
               type="email" autocomplete="username webauthn" required />
      </label>
      <label data-abs-auth="password-field">
        <span>Password</span>
        <input value={password()} onInput={(e) => setPassword(e.currentTarget.value)}
               type="password" autocomplete="current-password" minlength={12} required />
      </label>
      {error() && (
        <p role="alert" data-abs-auth="error">{error()!.message}</p>
      )}
      <button type="submit" disabled={isPending()} data-abs-auth="submit">
        {isPending() ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
};
```

## Why we don't ship Vue/Svelte/Solid SFCs in the package

Each non-React framework needs its own SFC compiler bundled into the
build pipeline (`@vitejs/plugin-vue`, `@sveltejs/vite-plugin-svelte`,
`solid-vite`). Adopting four parallel build paths in a single package
inflates the install footprint by 30–60 MB and creates a maintenance
matrix that the React-only approach doesn't have.

The composables (`useSignIn`, `useSignUp`, etc.) are framework-native
and shipped in `@absolutejs/auth/{vue,svelte,solid}`. Wiring a
20-30-line SFC over them is faster than configuring our build to ship
them precompiled — and gives you full control of the markup.

If you'd like SFC-native components added to the package despite the
build cost, open an issue.
