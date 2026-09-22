// Vitest runs outside the React Server Components bundler; the real
// `server-only` package throws on import there. Tests import server modules
// directly, so this stub replaces it.
export {};
