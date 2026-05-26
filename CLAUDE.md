# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Development**: `npm run dev` - Runs the server directly with tsx for development
- **Production**: `npm start` - Runs the built server from `dist/index.js`
- **Install**: `npm install` - Install dependencies

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides Clicky analytics API integration. The architecture follows a modular pattern:

### Core Components

- **`src/index.ts`**: Main MCP server class (`ClickyMCPServer`) that sets up the MCP server with stdio transport, loads the site registry, injects the `site` param into every tool's schema at list time, and routes each call to the correct per-site client
- **`src/clicky-client.ts`**: HTTP client wrapper (`ClickyClient`) for the Clicky API with built-in validation and error handling. One instance per configured site.
- **`src/site-registry.ts`**: `SiteRegistry` — loads multi-site config from `CLICKY_SITES` (with legacy single-site fallback), exposes per-alias `ClickyClient` lookup, default-alias resolution, and a `describe()` method for the `list_sites` tool
- **`src/tools/`**: Individual tool implementations, each exporting a tool definition and handler function. Handlers receive a `ClickyClient` and don't know about site routing — the server picks the right client before dispatching.

### Tool Pattern

Each tool follows a consistent pattern:
- Exports a `Tool` object with JSON schema validation
- Exports an async handler function that takes validated args and a `ClickyClient` instance
- Returns MCP-formatted responses with proper error handling

### Key Configuration

- **Site credentials**: Multi-site recommended; single-site supported for back-compat.
  - **Multi-site (preferred)**: `CLICKY_SITES` — JSON map of alias → `{ site_id, site_key }`. Optionally `CLICKY_DEFAULT_SITE=<alias>` to pick the default (otherwise: alias literally named `default`, else first alias in map).
  - **Single-site (legacy)**: `CLICKY_SITE_ID` + `CLICKY_SITE_KEY` — registered internally under alias `default`.
  - Both forms can also be supplied via a `.env` file (only loaded when neither form is already set in `process.env`).
- **Per-call routing**: every analytics tool's schema includes an optional `site` param. The server strips it before dispatching to the handler. `list_sites` returns alias + site_id (no keys).
- **API constraints**: 31-day maximum date range, 1000 item limit enforced by client
- **Date format**: All dates use YYYY-MM-DD format with regex validation

### Available Tools

1. **`get_total_visitors`**: Fetches visitor counts for date ranges
2. **`get_domain_visitors`**: Filters visitors by referrer domain
3. **`get_top_pages`**: Returns most popular pages with optional limit

### Error Handling

The client includes comprehensive error handling for:
- Date range validation (>31 days, invalid ranges)
- API rate limits and network errors
- Invalid parameters with descriptive messages