# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development server**: `bun run dev` or `npm run dev` - Start Vite development server with HMR
- **Build**: `bun run build` or `npm run build` - TypeScript compilation followed by Vite build
- **Lint**: `bun run lint` or `npm run lint` - Run ESLint on the codebase
- **Preview**: `bun run preview` or `npm run preview` - Preview production build locally

## Architecture Overview

This is a React + TypeScript + Vite application focused on CRDT (Collaborative Real-time Document Technology) experimentation with Monaco Editor integration. The project uses Yjs for CRDT functionality and collaborative editing capabilities.

### Key Technologies

- **Frontend**: React 19, TypeScript, Vite with rolldown-vite fork
- **Editor**: Monaco Editor via `@monaco-editor/react`
- **CRDT**: Yjs ecosystem including `y-monaco`, `y-indexeddb`, `y-websocket`, `y-protocols`
- **Styling**: Tailwind CSS (via utility functions in `src/lib/utils.ts`)

### Project Structure

- `src/components/monaco-editor.tsx` - Custom Monaco Editor wrapper with auto-resize, height management, and imperative API
- `src/lib/utils.ts` - Utility functions including Tailwind class merging and SSR detection
- Default React + Vite structure with TypeScript configuration

### Monaco Editor Component

The custom Monaco Editor component supports:
- Auto-resizing based on content height with configurable min/max bounds
- Imperative API via ref for programmatic control
- SQL syntax highlighting by default
- Comprehensive editor options with sensible defaults
- Proper cleanup and memory management

### Development Notes

- Uses Bun as package manager (note `bun.lock` file)
- Vite configuration uses rolldown fork (`rolldown-vite@7.1.12`) for potentially better performance
- ESLint configured with TypeScript, React hooks, and React refresh rules
- No test setup currently configured