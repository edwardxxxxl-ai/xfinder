# Technical Decisions

## Why Arc Instead Of Official API

The project intentionally reuses the user's existing Arc login session instead of requiring official X API credentials.

Reasons:

- Faster to get working
- No API key approval flow
- Better fit for a local personal workflow
- Lower setup friction for content research use cases

Tradeoff:

- The workflow is more brittle because it depends on browser behavior and X web endpoints.

## Why Markdown Output

Markdown is the default export format because it is:

- Human-readable
- Easy to paste into notes, docs, and AI tools
- Easy to convert into other formats later
- Useful as a durable content asset

## Why Local Web App

A local single-page app keeps the workflow simple:

- Easy input and preview
- No deployment required
- No need to store user credentials on a server

## Why AppleScript

Arc can be controlled through AppleScript on macOS, which makes it possible to:

- Navigate the active tab
- Inject page-side JavaScript
- Reuse the already authenticated browser context

## Known Fragility

The system may break if:

- X changes internal endpoints
- Arc changes AppleScript support
- Arc blocks script injection
- The active tab restore logic no longer behaves the same way
