# Contributing to LLM Traces

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js >= 22.6 (required for `--experimental-strip-types`)
- npm >= 10
- Docker and Docker Compose v2 (for the local stack: `docker compose up` builds the plugin and starts Grafana, Tempo and sample traces)

## Development Setup

```bash
git clone https://github.com/agoda-com/llm-traces.git
cd llm-traces
npm install
```

## Building

```bash
# Production build into dist/ (includes source maps)
npm run build

# Rebuild on every change
npm run dev
```

## Running Tests

```bash
# All unit tests
npm test

# Lint and typecheck
npm run typecheck
npm run lint
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Ensure all checks pass: `npm run typecheck && npm run lint && npm test`
5. Commit with a clear message
6. Open a pull request

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new logic (unit tests in `tests/`)
- Ensure the pre-commit hook passes (typecheck + lint + unit tests)
- Update the CHANGELOG if applicable

## Code Style

- TypeScript with strict mode disabled (legacy — we're working on enabling it)
- ESLint enforces bug-catching rules (react-hooks exhaustive-deps, no-unreachable, etc.)
- No Prettier — formatting is not enforced beyond ESLint rules

## Releasing

Pushing a `v*` tag runs CI and, if it passes, publishes the plugin zip with `.sha1` and `.sha256` checksums.
The release signs the plugin only when the repository variable `SIGN_PLUGIN` is set to `true` (using the `GRAFANA_ACCESS_POLICY_TOKEN` secret); a failed signing step fails the release.
Otherwise the unsigned zip is published.

## Reporting Issues

Use [GitHub Issues](https://github.com/agoda-com/llm-traces/issues) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
