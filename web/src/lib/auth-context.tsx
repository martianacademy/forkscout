// web/src/lib/auth-context.tsx — Clerk-based auth context
// Wraps Clerk's useAuth/useUser hooks into a simple interface.
// Replaces the old token-based auth that read from ?token= URL param.

"use client";

import { useAuth as useClerkAuth, useUser } from "@clerk/nextjs";

/**
 * Returns the current authenticated user info from Clerk.
 * Components can call this to check auth state and get the userId.
 */
export function useAuth() {
    const { isSignedIn, userId, isLoaded } = useClerkAuth();
    const { user } = useUser();

    return {
        /** Whether Clerk has finished loading */
        isLoaded,
        /** Whether the user is authenticated */
        isAuthenticated: !!isSignedIn,
        /** Clerk user ID (e.g. "user_2abc123") — used as session key for per-user history */
        userId: userId ?? "",
        /** Display name for the UI */
        displayName: user?.firstName ?? user?.username ?? "User",
        /** User's profile image URL */
        imageUrl: user?.imageUrl ?? "",
    };
}
