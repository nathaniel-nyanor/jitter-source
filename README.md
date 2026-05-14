# Motion Editor

Motion Editor is an open-source, browser-based motion design app built with Laravel, Inertia, React, and Tailwind CSS. The current MVP focuses on editable motion projects with a DOM/SVG canvas, layer controls, timeline preview, animation presets, and JSON save/load/export.

## Current MVP

- Authenticated project dashboard
- Project create, duplicate, delete, save, and JSON export
- Full-screen editor with canvas, layer list, inspector, and timeline
- Text, rectangle, and ellipse layers
- Layer drag, transform editing, ordering, hide, and lock controls
- Animation preview with scrub/play controls
- Fade, slide, and pop presets

## Not Included Yet

- AI generation
- MP4, WebM, GIF, or Lottie export
- Realtime collaboration
- Figma import
- Advanced effects or masking

## Local Setup

```bash
composer install
npm install
cp .env.example .env
php artisan key:generate
php artisan migrate
npm run build
php artisan serve
```

Visit `/projects` after registering or logging in.

For development, run:

```bash
composer run dev
```

## Verification

```bash
php artisan test --compact
npm run lint:check
npm run types:check
npm run build
```

## License

MIT
