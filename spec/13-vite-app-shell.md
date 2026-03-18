# Spec 13: Vite App Shell — index.html, main.tsx, App.tsx

> GitHub Issue: #36
> Dependencies: None (independent of API)
> Status: ready for TDD

## Intent

Create the minimal Vite entry point that mounts React and renders a layout scaffold. This is the browser entry point — all UI components hang off of it.

## Scope

### In Scope
- HTML entry point (`index.html`)
- React mount (`src/main.tsx`)
- App layout component (`src/App.tsx`)
- Basic CSS layout (`src/App.css`)
- Scan trigger UI (path input + button)
- Application state scaffolding

### Out of Scope
- API integration (hooks come in spec #14)
- Component wiring (comes in spec #15)
- Responsive/mobile design
- Theme switching
- Authentication UI

## Files

### `index.html` (project root)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mappa Mundi</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

### `src/main.tsx`

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### `src/App.tsx`

Layout structure:
```
┌─────────────────────────────────────┐
│ Header: "Mappa Mundi" + scan input  │
├──────────────────────┬──────────────┤
│                      │              │
│     Map Area         │   Sidebar    │
│   (placeholder)      │ (placeholder)│
│                      │              │
└──────────────────────┴──────────────┘
```

**Header:**
- App title: "Mappa Mundi"
- Project path input (text field)
- "Scan" button
- Status indicator (idle / scanning / ready / error)

**Main area:**
- Placeholder div with class `map-container`
- Shows "Scan a project to begin" when no data
- Will receive MapRenderer in spec #15

**Sidebar:**
- Placeholder div with class `sidebar`
- ~280px fixed width
- Will receive LayerPicker + detail panel in spec #15

**State:**
- `projectPath: string` — bound to input
- `status: 'idle' | 'scanning' | 'ready' | 'error'` — shown in UI
- `errorMessage: string | null` — shown when status is 'error'
- Scan button: for now, sets status to 'scanning' (actual API call deferred to hooks)

### `src/App.css`

```css
/* Full viewport layout */
/* Header: fixed height, flex row, items centered */
/* Content: flex row, map-container grows, sidebar fixed width */
/* Minimal clean styling — light background, subtle borders */
```

- Use CSS custom properties for colors (easy to theme later)
- No CSS framework — plain CSS with flexbox/grid
- Clean, minimal aesthetic

## Test Strategy

### Component tests (`src/App.test.tsx`)
- Renders header with app title
- Renders project path input field
- Renders scan button
- Scan button is disabled when input is empty
- Shows "Scan a project to begin" placeholder in map area
- Shows sidebar placeholder
- Entering path and clicking Scan updates status to 'scanning'

## Acceptance Criteria
- `npm run dev` opens browser to a page showing the full layout
- Header, map area, and sidebar are visually distinct
- Text input accepts a project path
- Scan button is interactive (disabled when empty, clickable when filled)
- No console errors or warnings (except React dev mode noise)
- Page title is "Mappa Mundi"
